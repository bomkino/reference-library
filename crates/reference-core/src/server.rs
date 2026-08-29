use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use reference_protocol::{
    CancellationState, Capabilities, CapabilityDetail, ClientFrame, Command, CommandResult, Event,
    FrameError, HelloResult, MAX_REQUEST_ID_BYTES, PROTOCOL_VERSION, ServerFrame, read_frame,
    write_frame,
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
    handle: Option<JoinHandle<bool>>,
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
    session_id: String,
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
                    let session_id = work.plan.session_id.clone();
                    let completion = Arc::clone(&work.completion);
                    let outcome = crate::rendition::run_job_outcome(
                        work.plan,
                        work.cancelled,
                        events.clone(),
                    );
                    let response_sent = sender
                        .send(AsyncResponse {
                            request_id: work.request_id,
                            job_id,
                            session_id,
                            result: outcome.result,
                            terminal_persisted: outcome.terminal_persisted,
                        })
                        .is_ok();
                    let (completed, wake) = &*completion;
                    if let Ok(mut completed) = completed.lock() {
                        *completed = true;
                        wake.notify_all();
                    }
                    if !response_sent {
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
        self.reap_finished_scans();
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
                let completion = Arc::new((Mutex::new(false), Condvar::new()));
                let worker_completion = Arc::clone(&completion);
                let handle = thread::spawn(move || {
                    let persisted =
                        discovery::scan_root(plan, worker_cancelled, sender).terminal_persisted;
                    let (completed, wake) = &*worker_completion;
                    if let Ok(mut completed) = completed.lock() {
                        *completed = true;
                        wake.notify_all();
                    }
                    persisted
                });
                self.jobs.insert(
                    job_id.clone(),
                    JobControl {
                        session_id,
                        cancelled,
                        handle: Some(handle),
                        kind: JobKind::Scan,
                        completion: Some(completion),
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
                let completion = Arc::new((Mutex::new(false), Condvar::new()));
                let worker_completion = Arc::clone(&completion);
                let handle = thread::spawn(move || {
                    let persisted =
                        discovery::scan_root(plan, worker_cancelled, sender).terminal_persisted;
                    let (completed, wake) = &*worker_completion;
                    if let Ok(mut completed) = completed.lock() {
                        *completed = true;
                        wake.notify_all();
                    }
                    persisted
                });
                self.jobs.insert(
                    job_id.clone(),
                    JobControl {
                        session_id,
                        cancelled,
                        handle: Some(handle),
                        kind: JobKind::Scan,
                        completion: Some(completion),
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
                expected_library_revision,
            } => Ok(CommandResult::AssetPage(
                self.session(&session_id)?.query_asset_index_at_revision(
                    offset,
                    limit,
                    projection,
                    &query,
                    expected_library_revision,
                )?,
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

    fn reap_finished_scans(&mut self) {
        let finished = self
            .jobs
            .iter()
            .filter(|(_, job)| {
                job.kind == JobKind::Scan
                    && job.handle.as_ref().is_some_and(JoinHandle::is_finished)
            })
            .map(|(job_id, _)| job_id.clone())
            .collect::<Vec<_>>();
        for job_id in finished {
            let Some(mut job) = self.jobs.remove(&job_id) else {
                continue;
            };
            // A finished worker must release its in-memory capacity even when
            // writing the terminal ledger state failed. scan_root already
            // emitted CoreNeedsRestart; retaining a consumed JoinHandle would
            // make the slot impossible to reap in this process.
            if let Some(handle) = job.handle.take() {
                let _ = handle.join();
            }
        }
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
        for job_id in &job_ids {
            let Some(mut job) = self.jobs.remove(job_id) else {
                continue;
            };
            if job.kind == JobKind::Scan
                && let Some(handle) = job.handle.take()
            {
                let _ = handle.join();
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
        // The worker is finished even when its terminal ledger write failed.
        // run_job_outcome already returned an error and emitted
        // CoreNeedsRestart; retaining this control would only leak the job map.
        debug_assert!(response.terminal_persisted || response.result.is_err());
        self.jobs.remove(&response.job_id);
        let result = if self.sessions.contains_key(&response.session_id) {
            response.result
        } else {
            Err(CoreError::RenditionCancelled)
        };
        Some(match result {
            Ok(descriptor) => ServerFrame::Response {
                protocol_version: PROTOCOL_VERSION,
                request_id: response.request_id,
                result: Box::new(CommandResult::ResourceAuthorized(descriptor)),
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
    let (input_sender, input_receiver) = mpsc::sync_channel(64);
    thread::spawn(move || read_input(reader, input_sender));
    let mut engine = CommandEngine::new();
    let mut shutdown = false;
    while !shutdown {
        while let Some(event) = engine.take_event() {
            write_server_frame(&mut writer, &engine.next_event_frame(event))?;
        }
        while let Some(response) = engine.take_async_response() {
            write_server_frame(&mut writer, &response)?;
        }
        match input_receiver.try_recv() {
            Ok(Input::Request(request)) => {
                if !valid_request_id(&request.request_id) {
                    write_server_frame(
                        &mut writer,
                        &ServerFrame::Error {
                            protocol_version: PROTOCOL_VERSION,
                            request_id: "invalid-request-id".into(),
                            error: reference_protocol::ProtocolError::new(
                                "ProtocolFrameInvalid",
                                "requestId must be a short printable identifier",
                                false,
                            ),
                        },
                    )?;
                    continue;
                }
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
                        write_server_frame(
                            &mut writer,
                            &ServerFrame::Error {
                                protocol_version: PROTOCOL_VERSION,
                                request_id,
                                error: error.to_protocol_error(),
                            },
                        )?;
                    }
                    continue;
                }
                let frame = match engine.execute(request) {
                    Ok(result) => ServerFrame::Response {
                        protocol_version: PROTOCOL_VERSION,
                        request_id,
                        result: Box::new(result),
                    },
                    Err(error) => ServerFrame::Error {
                        protocol_version: PROTOCOL_VERSION,
                        request_id,
                        error: error.to_protocol_error(),
                    },
                };
                let shutdown_succeeded = is_shutdown
                    && matches!(
                        &frame,
                        ServerFrame::Response { result, .. }
                            if matches!(result.as_ref(), CommandResult::Shutdown)
                    );
                write_server_frame(&mut writer, &frame)?;
                shutdown = shutdown_succeeded;
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
                write_server_frame(&mut writer, &frame)?;
            }
            Ok(Input::Eof) => {
                if engine.stop_all_jobs().is_ok() {
                    break;
                }
                // Retain every session and its writer lock until background
                // writers are quiescent. A supervising shell can still
                // terminate the helper process if a hostile decoder exceeds
                // the bounded cooperative deadline.
                thread::sleep(Duration::from_millis(4));
            }
            Err(TryRecvError::Empty) => thread::sleep(Duration::from_millis(4)),
            Err(TryRecvError::Disconnected) => {
                if engine.stop_all_jobs().is_ok() {
                    break;
                }
                thread::sleep(Duration::from_millis(4));
            }
        }
    }
    Ok(())
}

fn write_server_frame(writer: &mut impl Write, frame: &ServerFrame) -> Result<(), String> {
    match write_frame(writer, frame) {
        Ok(()) => Ok(()),
        Err(FrameError::FrameTooLarge { .. }) => {
            let request_id = match frame {
                ServerFrame::Response { request_id, .. }
                | ServerFrame::Error { request_id, .. } => request_id.clone(),
                ServerFrame::Event { .. } => "oversized-event".into(),
            };
            let fallback = ServerFrame::Error {
                protocol_version: PROTOCOL_VERSION,
                request_id,
                error: reference_protocol::ProtocolError::new(
                    "ProtocolResultTooLarge",
                    "Core result exceeded the bounded protocol frame",
                    false,
                ),
            };
            write_frame(writer, &fallback).map_err(|error| error.to_string())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn read_input(mut reader: impl Read, sender: SyncSender<Input>) {
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

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_ids_use_a_non_escaping_bounded_alphabet() {
        assert!(valid_request_id("request-1:page_2.0"));
        assert!(valid_request_id(&"r".repeat(MAX_REQUEST_ID_BYTES)));
        assert!(!valid_request_id(&"\\".repeat(MAX_REQUEST_ID_BYTES)));
        assert!(!valid_request_id("quoted\"id"));
    }

    #[test]
    fn oversized_result_becomes_a_bounded_nonfatal_protocol_error() {
        let oversized = ServerFrame::Response {
            protocol_version: PROTOCOL_VERSION,
            request_id: "large-result".into(),
            result: Box::new(CommandResult::CanonicalDump {
                dump: serde_json::json!({"value": "x".repeat(reference_protocol::MAX_FRAME_BYTES)}),
            }),
        };
        let following = ServerFrame::Response {
            protocol_version: PROTOCOL_VERSION,
            request_id: "following".into(),
            result: Box::new(CommandResult::Shutdown),
        };
        let mut encoded = Vec::new();
        write_server_frame(&mut encoded, &oversized).unwrap();
        write_server_frame(&mut encoded, &following).unwrap();
        let mut reader = std::io::Cursor::new(encoded);
        let first = read_frame::<ServerFrame>(&mut reader).unwrap().unwrap();
        let second = read_frame::<ServerFrame>(&mut reader).unwrap().unwrap();
        assert!(matches!(
            first,
            ServerFrame::Error { request_id, error, .. }
                if request_id == "large-result" && error.code == "ProtocolResultTooLarge"
        ));
        assert!(matches!(
            second,
            ServerFrame::Response { request_id, result, .. }
                if request_id == "following" && matches!(result.as_ref(), CommandResult::Shutdown)
        ));
    }

    #[test]
    fn filesystem_failures_do_not_expose_host_paths() {
        let secret = PathBuf::from("/private/secret/customer/Project.pitchlibrary");
        for error in [
            CoreError::DestinationExists(secret.clone()),
            CoreError::InvalidPackageExtension(secret.clone()),
            CoreError::Io(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                secret.display().to_string(),
            )),
        ] {
            let public = error.to_protocol_error();
            assert!(!public.message.contains("/private"));
            assert!(!public.message.contains("customer"));
        }
    }

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

    #[test]
    fn finished_scan_control_is_reaped_after_terminal_persistence_failure() {
        let mut engine = CommandEngine::new();
        let job_id = "finished-scan".to_owned();
        engine.jobs.insert(
            job_id.clone(),
            JobControl {
                session_id: "closed-session".into(),
                cancelled: Arc::new(AtomicBool::new(false)),
                handle: Some(thread::spawn(|| false)),
                kind: JobKind::Scan,
                completion: None,
            },
        );
        while !engine.jobs[&job_id].handle.as_ref().unwrap().is_finished() {
            thread::yield_now();
        }
        let result = engine
            .execute(ClientFrame {
                protocol_version: PROTOCOL_VERSION,
                request_id: "capabilities".into(),
                command: Command::GetCapabilities { session_id: None },
            })
            .unwrap();
        assert!(matches!(result, CommandResult::Capabilities(_)));
        assert!(!engine.jobs.contains_key(&job_id));
    }

    #[test]
    fn finished_resource_control_is_reaped_after_terminal_persistence_failure() {
        let mut engine = CommandEngine::new();
        let (async_sender, async_receiver) = mpsc::channel();
        engine.async_receiver = async_receiver;
        let job_id = "finished-resource".to_owned();
        engine.jobs.insert(
            job_id.clone(),
            JobControl {
                session_id: "closed-session".into(),
                cancelled: Arc::new(AtomicBool::new(false)),
                handle: None,
                kind: JobKind::Resource,
                completion: None,
            },
        );
        engine.resource_inflight = 1;
        async_sender
            .send(AsyncResponse {
                request_id: "resource".into(),
                job_id: job_id.clone(),
                session_id: "closed-session".into(),
                result: Err(CoreError::RenditionCacheFailure),
                terminal_persisted: false,
            })
            .unwrap();

        let response = engine.take_async_response().unwrap();
        assert!(matches!(
            response,
            ServerFrame::Error { request_id, error, .. }
                if request_id == "resource" && error.code == "RenditionCancelled"
        ));
        assert_eq!(engine.resource_inflight, 0);
        assert!(!engine.jobs.contains_key(&job_id));
    }

    #[test]
    fn stopping_session_releases_all_completed_job_controls() {
        let mut engine = CommandEngine::new();
        let session_id = "closing-session".to_owned();
        let scan_id = "completed-scan".to_owned();
        let resource_id = "completed-resource".to_owned();
        engine.jobs.insert(
            scan_id.clone(),
            JobControl {
                session_id: session_id.clone(),
                cancelled: Arc::new(AtomicBool::new(false)),
                handle: Some(thread::spawn(|| false)),
                kind: JobKind::Scan,
                completion: Some(Arc::new((Mutex::new(true), Condvar::new()))),
            },
        );
        engine.jobs.insert(
            resource_id.clone(),
            JobControl {
                session_id: session_id.clone(),
                cancelled: Arc::new(AtomicBool::new(false)),
                handle: None,
                kind: JobKind::Resource,
                completion: Some(Arc::new((Mutex::new(true), Condvar::new()))),
            },
        );

        engine.stop_jobs_for_session(&session_id).unwrap();

        assert!(!engine.jobs.contains_key(&scan_id));
        assert!(!engine.jobs.contains_key(&resource_id));
    }
}
