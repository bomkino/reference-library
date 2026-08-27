use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender, SyncSender, TryRecvError},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use reference_protocol::{
    CancellationState, Capabilities, CapabilityDetail, ClientFrame, Command, CommandResult, Event,
    HelloResult, PROTOCOL_VERSION, ServerFrame, read_frame, write_frame,
};

use crate::{
    discovery::{self, EventSink},
    error::CoreError,
    session::LibrarySession,
};

const RENDITION_WORKERS: usize = 2;
const MAX_RENDITION_WORK: usize = 10;
const WORKER_STOP_TIMEOUT: Duration = Duration::from_secs(35);

type Completion = Arc<(Mutex<bool>, Condvar)>;

enum Input {
    Request(ClientFrame),
    Invalid(String),
    Eof,
}

struct JobControl {
    session_id: String,
    cancelled: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    kind: JobKind,
    completion: Option<Completion>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum JobKind {
    Scan,
    Resource,
}

struct ResourceWork {
    request_id: String,
    plan: crate::rendition::ResourcePlan,
    cancelled: Arc<AtomicBool>,
    completion: Completion,
}

struct AsyncResponse {
    request_id: String,
    job_id: String,
    result: Result<reference_protocol::ResourceDescriptor, CoreError>,
    terminal_persisted: bool,
}

pub struct CommandEngine {
    sessions: HashMap<String, LibrarySession>,
    jobs: HashMap<String, JobControl>,
    event_sender: SyncSender<Event>,
    event_receiver: Receiver<Event>,
    event_sequence: u64,
    resource_sender: SyncSender<ResourceWork>,
    async_receiver: Receiver<AsyncResponse>,
    resource_inflight: usize,
}

impl CommandEngine {
    pub fn new() -> Self {
        let (event_sender, event_receiver) = mpsc::sync_channel(1_024);
        let (resource_sender, resource_receiver) =
            mpsc::sync_channel::<ResourceWork>(MAX_RENDITION_WORK - RENDITION_WORKERS);
        let resource_receiver = Arc::new(Mutex::new(resource_receiver));
        let (async_sender, async_receiver) = mpsc::channel();
        for _ in 0..RENDITION_WORKERS {
            let receiver = Arc::clone(&resource_receiver);
            let sender = async_sender.clone();
            let events = event_sender.clone();
            thread::spawn(move || {
                loop {
                    let work = {
                        let Ok(receiver) = receiver.lock() else {
                            return;
                        };
                        match receiver.recv() {
                            Ok(work) => work,
                            Err(_) => return,
                        }
                    };
                    let job_id = work.plan.job_id.clone().unwrap_or_default();
                    let completion = Arc::clone(&work.completion);
                    let outcome = crate::rendition::run_job_outcome(
                        work.plan,
                        work.cancelled,
                        events.clone(),
                    );
                    let (completed, wake) = &*completion;
                    if let Ok(mut completed) = completed.lock() {
                        *completed = true;
                        wake.notify_all();
                    }
                    if sender
                        .send(AsyncResponse {
                            request_id: work.request_id,
                            job_id,
                            result: outcome.result,
                            terminal_persisted: outcome.terminal_persisted,
                        })
                        .is_err()
                    {
                        return;
                    }
                }
            });
        }
        Self {
            sessions: HashMap::new(),
            jobs: HashMap::new(),
            event_sender,
            event_receiver,
            event_sequence: 0,
            resource_sender,
            async_receiver,
            resource_inflight: 0,
        }
    }

    fn start_resource_authorization(
        &mut self,
        request_id: String,
        session_id: String,
        asset_id: String,
        profile: reference_protocol::ResourceProfile,
    ) -> Result<(), CoreError> {
        if self.resource_inflight >= MAX_RENDITION_WORK {
            return Err(CoreError::RenditionQueueFull);
        }
        let (job_id, plan) = self
            .session(&session_id)?
            .start_resource_authorization(&asset_id, profile)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        let started = Event::ResourceAuthorizationStarted {
            request_id: request_id.clone(),
            job_id: job_id.clone(),
            asset_id,
            profile,
        };
        if self.event_sender.try_send(started).is_err() {
            let error = CoreError::RenditionQueueFull;
            self.session(&session_id)?
                .fail_resource_job(&job_id, &error)?;
            return Err(error);
        }
        let completion = Arc::new((Mutex::new(false), Condvar::new()));
        let work = ResourceWork {
            request_id,
            plan,
            cancelled: Arc::clone(&cancelled),
            completion: Arc::clone(&completion),
        };
        if self.resource_sender.try_send(work).is_err() {
            let error = CoreError::RenditionQueueFull;
            self.session(&session_id)?
                .fail_resource_job(&job_id, &error)?;
            return Err(error);
        }
        self.jobs.insert(
            job_id,
            JobControl {
                session_id,
                cancelled,
                handle: None,
                kind: JobKind::Resource,
                completion: Some(completion),
            },
        );
        self.resource_inflight += 1;
        Ok(())
    }

    fn execute(&mut self, request: ClientFrame) -> Result<CommandResult, CoreError> {
        if request.protocol_version != PROTOCOL_VERSION {
            return Err(CoreError::ProtocolVersionUnsupported(
                request.protocol_version,
            ));
        }
        match request.command {
            Command::Hello {
                client_name: _,
                supported_versions,
            } => {
                if !supported_versions.contains(&PROTOCOL_VERSION) {
                    return Err(CoreError::ProtocolVersionUnsupported(
                        supported_versions.first().copied().unwrap_or_default(),
                    ));
                }
                Ok(CommandResult::Hello(HelloResult {
                    protocol_version: PROTOCOL_VERSION,
                    core_version: env!("CARGO_PKG_VERSION").into(),
                    max_page_size: reference_protocol::MAX_PAGE_SIZE,
                    features: vec![
                        "package-v1".into(),
                        "progressive-common-stills".into(),
                        "external-rename-reconciliation".into(),
                        "opaque-resources".into(),
                        "canonical-dump-v1".into(),
                        "canonical-proof-v1".into(),
                    ],
                }))
            }
            Command::CreateLibrary { path, name } => {
                let session = LibrarySession::create(PathBuf::from(path), name)?;
                let opened = session.opened();
                self.sessions.insert(opened.session_id.clone(), session);
                Ok(CommandResult::SessionOpened(opened))
            }
            Command::OpenLibrary { path } => {
                let session = LibrarySession::open(PathBuf::from(path))?;
                let opened = session.opened();
                self.sessions.insert(opened.session_id.clone(), session);
                Ok(CommandResult::SessionOpened(opened))
            }
            Command::CloseLibrary { session_id } => {
                self.stop_jobs_for_session(&session_id)?;
                let mut session = self
                    .sessions
                    .remove(&session_id)
                    .ok_or(CoreError::SessionClosed)?;
                session.close()?;
                Ok(CommandResult::LibraryClosed { session_id })
            }
            Command::AddRoot {
                session_id,
                authorized_path,
                display_name,
            } => {
                if self
                    .jobs
                    .values()
                    .filter(|job| job.kind == JobKind::Scan)
                    .count()
                    >= 2
                {
                    return Err(CoreError::RootScanCapacityReached);
                }
                let session = self.session(&session_id)?;
                let plan = session.add_root(authorized_path, display_name)?;
                let root_id = plan.root_id.clone();
                let job_id = plan.job_id.clone();
                let cancelled = Arc::new(AtomicBool::new(false));
                let worker_cancelled = Arc::clone(&cancelled);
                let sender = self.event_sender.clone();
                let handle =
                    thread::spawn(move || discovery::scan_root(plan, worker_cancelled, sender));
                self.jobs.insert(
                    job_id.clone(),
                    JobControl {
                        session_id,
                        cancelled,
                        handle: Some(handle),
                        kind: JobKind::Scan,
                        completion: None,
                    },
                );
                self.queue_local_event(Event::RootStateChanged {
                    root_id: root_id.clone(),
                    state: "scanning".into(),
                });
                Ok(CommandResult::RootAdded { root_id, job_id })
            }
            Command::ListRoots { session_id } => Ok(CommandResult::Roots {
                items: self.session(&session_id)?.query_roots()?,
            }),
            Command::BindRoot {
                session_id,
                root_id,
                authorized_path,
            } => Ok(CommandResult::RootBound {
                root: self
                    .session(&session_id)?
                    .reauthorize_root(&root_id, authorized_path)?,
            }),
            Command::ScanRoot {
                session_id,
                root_id,
            } => {
                if self
                    .jobs
                    .values()
                    .filter(|job| job.kind == JobKind::Scan)
                    .count()
                    >= 2
                {
                    return Err(CoreError::RootScanCapacityReached);
                }
                let plan = self.session(&session_id)?.rescan_root(&root_id)?;
                let job_id = plan.job_id.clone();
                let cancelled = Arc::new(AtomicBool::new(false));
                let worker_cancelled = Arc::clone(&cancelled);
                let sender = self.event_sender.clone();
                let handle =
                    thread::spawn(move || discovery::scan_root(plan, worker_cancelled, sender));
                self.jobs.insert(
                    job_id.clone(),
                    JobControl {
                        session_id,
                        cancelled,
                        handle: Some(handle),
                        kind: JobKind::Scan,
                        completion: None,
                    },
                );
                self.queue_local_event(Event::RootStateChanged {
                    root_id: root_id.clone(),
                    state: "scanning".into(),
                });
                Ok(CommandResult::RootScanStarted { root_id, job_id })
            }
            Command::QueryAssets {
                session_id,
                offset,
                limit,
                projection,
            } => Ok(CommandResult::AssetPage(
                self.session(&session_id)?
                    .query_assets(offset, limit, projection)?,
            )),
            Command::QueryAssetIndex {
                session_id,
                offset,
                limit,
                projection,
                query,
            } => Ok(CommandResult::AssetPage(
                self.session(&session_id)?
                    .query_asset_index(offset, limit, projection, &query)?,
            )),
            Command::GetAsset {
                session_id,
                asset_id,
            } => Ok(CommandResult::Asset(
                self.session(&session_id)?.get_asset(&asset_id)?,
            )),
            Command::UpdateAsset {
                session_id,
                asset_id,
                expected_revision,
                patch,
            } => {
                let (asset, library_revision) =
                    self.session(&session_id)?
                        .update_asset(&asset_id, expected_revision, patch)?;
                self.queue_local_event(Event::AssetUpdated {
                    asset_id: asset.asset_id.clone(),
                    revision: asset.revision,
                    library_revision,
                });
                Ok(CommandResult::AssetUpdated {
                    asset,
                    library_revision,
                })
            }
            Command::UpdateAssetReview {
                session_id,
                asset_id,
                expected_revision,
                review_state,
            } => {
                let (asset, library_revision) = self.session(&session_id)?.update_asset_review(
                    &asset_id,
                    expected_revision,
                    review_state,
                )?;
                self.queue_local_event(Event::AssetUpdated {
                    asset_id: asset.asset_id.clone(),
                    revision: asset.revision,
                    library_revision,
                });
                Ok(CommandResult::AssetUpdated {
                    asset,
                    library_revision,
                })
            }
            Command::UpdateAssetTitle {
                session_id,
                asset_id,
                expected_revision,
                title,
            } => {
                let (asset, library_revision) = self.session(&session_id)?.update_asset_title(
                    &asset_id,
                    expected_revision,
                    title.as_deref(),
                )?;
                self.queue_local_event(Event::AssetUpdated {
                    asset_id: asset.asset_id.clone(),
                    revision: asset.revision,
                    library_revision,
                });
                Ok(CommandResult::AssetUpdated {
                    asset,
                    library_revision,
                })
            }
            Command::UpdateAssetNote {
                session_id,
                asset_id,
                expected_revision,
                note,
            } => {
                let (asset, library_revision) = self.session(&session_id)?.update_asset_note(
                    &asset_id,
                    expected_revision,
                    note.as_deref(),
                )?;
                self.queue_local_event(Event::AssetUpdated {
                    asset_id: asset.asset_id.clone(),
                    revision: asset.revision,
                    library_revision,
                });
                Ok(CommandResult::AssetUpdated {
                    asset,
                    library_revision,
                })
            }
            Command::QueryJobs {
                session_id,
                offset,
                limit,
                query,
            } => Ok(CommandResult::JobPage(
                self.session(&session_id)?
                    .query_jobs(offset, limit, &query)?,
            )),
            Command::ListCollections { session_id } => Ok(CommandResult::Collections {
                items: self.session(&session_id)?.list_collections()?,
            }),
            Command::CreateCollection { session_id, name } => {
                let (collection, library_revision) =
                    self.session(&session_id)?.create_collection(&name)?;
                self.queue_local_event(Event::CollectionsChanged {
                    collection_id: collection.collection_id.clone(),
                    library_revision,
                });
                Ok(CommandResult::CollectionUpdated {
                    collection,
                    library_revision,
                })
            }
            Command::RenameCollection {
                session_id,
                collection_id,
                expected_revision,
                name,
            } => {
                let (collection, library_revision) = self.session(&session_id)?.rename_collection(
                    &collection_id,
                    expected_revision,
                    &name,
                )?;
                self.queue_local_event(Event::CollectionsChanged {
                    collection_id: collection.collection_id.clone(),
                    library_revision,
                });
                Ok(CommandResult::CollectionUpdated {
                    collection,
                    library_revision,
                })
            }
            Command::DeleteCollection {
                session_id,
                collection_id,
            } => {
                let library_revision = self
                    .session(&session_id)?
                    .delete_collection(&collection_id)?;
                self.queue_local_event(Event::CollectionsChanged {
                    collection_id: collection_id.clone(),
                    library_revision,
                });
                Ok(CommandResult::CollectionDeleted {
                    collection_id,
                    library_revision,
                })
            }
            Command::SetCollectionMembership {
                session_id,
                collection_id,
                asset_ids,
                member,
            } => {
                let (affected, library_revision) = self
                    .session(&session_id)?
                    .set_collection_membership(&collection_id, &asset_ids, member)?;
                self.queue_local_event(Event::CollectionsChanged {
                    collection_id: collection_id.clone(),
                    library_revision,
                });
                Ok(CommandResult::CollectionMembershipUpdated {
                    collection_id,
                    affected,
                    library_revision,
                })
            }
            Command::AuthorizeResource {
                session_id,
                asset_id,
                profile,
            } => Ok(CommandResult::ResourceAuthorized(
                self.session(&session_id)?
                    .authorize_resource(&asset_id, profile)?,
            )),
            Command::ResolveLocation {
                session_id,
                location_id,
            } => Ok(CommandResult::LocationResolved(
                self.session(&session_id)?.resolve_location(&location_id)?,
            )),
            Command::CanonicalDump { session_id } => Ok(CommandResult::CanonicalDump {
                dump: self.session(&session_id)?.canonical_dump()?,
            }),
            Command::CanonicalDigest { session_id } => Ok(CommandResult::CanonicalDigest(
                self.session(&session_id)?.canonical_digest()?,
            )),
            Command::CanonicalPage {
                session_id,
                snapshot_digest,
                entity,
                cursor,
                limit,
            } => Ok(CommandResult::CanonicalPage(
                self.session(&session_id)?.canonical_page(
                    &snapshot_digest,
                    entity,
                    cursor.as_deref(),
                    limit,
                )?,
            )),
            Command::GetCapabilities { session_id } => {
                if let Some(session_id) = session_id {
                    self.session(&session_id)?;
                }
                Ok(CommandResult::Capabilities(Capabilities {
                    choose_root: true,
                    reveal_location: true,
                    opaque_asset_resources: true,
                    source_mutation: false,
                    detail: vec![
                        CapabilityDetail {
                            name: "common-stills".into(),
                            state: "required_parity".into(),
                            reason: None,
                        },
                        CapabilityDetail {
                            name: "source-mutation".into(),
                            state: "intentionally_absent".into(),
                            reason: Some("outside T02".into()),
                        },
                    ],
                }))
            }
            Command::CancelJob { session_id, job_id } => {
                let persisted_state = self.session(&session_id)?.job_state(&job_id)?;
                let state = if matches!(
                    persisted_state.as_deref(),
                    Some("completed" | "failed" | "cancelled")
                ) {
                    CancellationState::AlreadyTerminal
                } else if let Some(job) = self.jobs.get(&job_id) {
                    if job.session_id != session_id {
                        CancellationState::UnknownJob
                    } else {
                        job.cancelled.store(true, Ordering::Relaxed);
                        CancellationState::CancellationRequested
                    }
                } else if persisted_state.is_some() {
                    CancellationState::AlreadyTerminal
                } else {
                    CancellationState::UnknownJob
                };
                Ok(CommandResult::JobCancellation { job_id, state })
            }
            Command::TestCrash => {
                if std::env::var_os("PITCHDOG_ENABLE_TEST_COMMANDS").is_none() {
                    return Err(CoreError::TestCommandDisabled);
                }
                std::process::exit(91);
            }
            Command::Shutdown => {
                self.stop_all_jobs()?;
                for (_, mut session) in self.sessions.drain() {
                    session.close()?;
                }
                Ok(CommandResult::Shutdown)
            }
        }
    }

    fn session(&self, session_id: &str) -> Result<&LibrarySession, CoreError> {
        self.sessions
            .get(session_id)
            .ok_or(CoreError::SessionClosed)
    }

    fn queue_local_event(&self, event: Event) {
        self.event_sender.emit(event);
    }

    fn stop_jobs_for_session(&mut self, session_id: &str) -> Result<(), CoreError> {
        let job_ids = self
            .jobs
            .iter()
            .filter(|(_, job)| job.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for job_id in &job_ids {
            if let Some(job) = self.jobs.get(job_id) {
                job.cancelled.store(true, Ordering::Relaxed);
            }
        }
        for job_id in &job_ids {
            if let Some(job) = self.jobs.get_mut(job_id)
                && job.kind == JobKind::Scan
                && let Some(handle) = job.handle.take()
            {
                let _ = handle.join();
            }
        }
        let deadline = Instant::now() + WORKER_STOP_TIMEOUT;
        for job_id in &job_ids {
            let Some(completion) = self
                .jobs
                .get(job_id)
                .and_then(|job| job.completion.as_ref())
            else {
                continue;
            };
            let (completed, wake) = &**completion;
            let mut completed = completed
                .lock()
                .map_err(|_| CoreError::RenditionCacheFailure)?;
            while !*completed {
                let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                    return Err(CoreError::RenditionTimedOut);
                };
                let (next, timeout) = wake
                    .wait_timeout(completed, remaining)
                    .map_err(|_| CoreError::RenditionCacheFailure)?;
                completed = next;
                if timeout.timed_out() && !*completed {
                    return Err(CoreError::RenditionTimedOut);
                }
            }
        }
        Ok(())
    }

    fn stop_all_jobs(&mut self) -> Result<(), CoreError> {
        let session_ids = self
            .jobs
            .values()
            .map(|job| job.session_id.clone())
            .collect::<Vec<_>>();
        for session_id in session_ids {
            self.stop_jobs_for_session(&session_id)?;
        }
        Ok(())
    }

    fn take_event(&mut self) -> Option<Event> {
        self.event_receiver.try_recv().ok()
    }

    fn take_async_response(&mut self) -> Option<ServerFrame> {
        let response = self.async_receiver.try_recv().ok()?;
        self.resource_inflight = self.resource_inflight.saturating_sub(1);
        if response.terminal_persisted {
            self.jobs.remove(&response.job_id);
        }
        Some(match response.result {
            Ok(descriptor) => ServerFrame::Response {
                protocol_version: PROTOCOL_VERSION,
                request_id: response.request_id,
                result: CommandResult::ResourceAuthorized(descriptor),
            },
            Err(error) => ServerFrame::Error {
                protocol_version: PROTOCOL_VERSION,
                request_id: response.request_id,
                error: error.to_protocol_error(),
            },
        })
    }

    fn next_event_frame(&mut self, event: Event) -> ServerFrame {
        self.event_sequence += 1;
        if let Event::JobUpdated { job_id, state } = &event
            && matches!(state.as_str(), "completed" | "failed" | "cancelled")
            && self
                .jobs
                .get(job_id)
                .is_some_and(|job| job.kind == JobKind::Scan)
            && let Some(mut job) = self.jobs.remove(job_id)
            && let Some(handle) = job.handle.take()
        {
            let _ = handle.join();
        }
        ServerFrame::Event {
            protocol_version: PROTOCOL_VERSION,
            sequence: self.event_sequence,
            event,
        }
    }
}

impl Default for CommandEngine {
    fn default() -> Self {
        Self::new()
    }
}

pub fn run_server(
    reader: impl Read + Send + 'static,
    mut writer: impl Write,
) -> Result<(), String> {
    let (input_sender, input_receiver) = mpsc::channel();
    thread::spawn(move || read_input(reader, input_sender));
    let mut engine = CommandEngine::new();
    let mut shutdown = false;
    while !shutdown {
        while let Some(response) = engine.take_async_response() {
            write_frame(&mut writer, &response).map_err(|e| e.to_string())?;
        }
        while let Some(event) = engine.take_event() {
            write_frame(&mut writer, &engine.next_event_frame(event)).map_err(|e| e.to_string())?;
        }
        match input_receiver.try_recv() {
            Ok(Input::Request(request)) => {
                let request_id = request.request_id.clone();
                let is_shutdown = matches!(&request.command, Command::Shutdown);
                if let Command::AuthorizeResource {
                    session_id,
                    asset_id,
                    profile,
                } = &request.command
                {
                    if let Err(error) = engine.start_resource_authorization(
                        request_id.clone(),
                        session_id.clone(),
                        asset_id.clone(),
                        *profile,
                    ) {
                        write_frame(
                            &mut writer,
                            &ServerFrame::Error {
                                protocol_version: PROTOCOL_VERSION,
                                request_id,
                                error: error.to_protocol_error(),
                            },
                        )
                        .map_err(|e| e.to_string())?;
                    }
                    continue;
                }
                let frame = match engine.execute(request) {
                    Ok(result) => ServerFrame::Response {
                        protocol_version: PROTOCOL_VERSION,
                        request_id,
                        result,
                    },
                    Err(error) => ServerFrame::Error {
                        protocol_version: PROTOCOL_VERSION,
                        request_id,
                        error: error.to_protocol_error(),
                    },
                };
                write_frame(&mut writer, &frame).map_err(|e| e.to_string())?;
                shutdown = is_shutdown;
            }
            Ok(Input::Invalid(message)) => {
                let frame = ServerFrame::Error {
                    protocol_version: PROTOCOL_VERSION,
                    request_id: "invalid-frame".into(),
                    error: reference_protocol::ProtocolError::new(
                        "ProtocolFrameInvalid",
                        message,
                        false,
                    ),
                };
                write_frame(&mut writer, &frame).map_err(|e| e.to_string())?;
            }
            Ok(Input::Eof) => {
                let _ = engine.stop_all_jobs();
                break;
            }
            Err(TryRecvError::Empty) => thread::sleep(Duration::from_millis(4)),
            Err(TryRecvError::Disconnected) => break,
        }
    }
    Ok(())
}

fn read_input(mut reader: impl Read, sender: Sender<Input>) {
    loop {
        match read_frame::<ClientFrame>(&mut reader) {
            Ok(Some(request)) => {
                if sender.send(Input::Request(request)).is_err() {
                    return;
                }
            }
            Ok(None) => {
                sender.send(Input::Eof).ok();
                return;
            }
            Err(error) => {
                sender.send(Input::Invalid(error.to_string())).ok();
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_explicitly_exclude_source_mutation() {
        let mut engine = CommandEngine::new();
        let result = engine
            .execute(ClientFrame {
                protocol_version: PROTOCOL_VERSION,
                request_id: "capabilities".into(),
                command: Command::GetCapabilities { session_id: None },
            })
            .unwrap();
        let CommandResult::Capabilities(capabilities) = result else {
            panic!("wrong response")
        };
        assert!(!capabilities.source_mutation);
        assert!(capabilities.opaque_asset_resources);
    }
}
