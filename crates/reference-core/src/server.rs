use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender, TryRecvError},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use reference_protocol::{
    CancellationState, Capabilities, CapabilityDetail, ClientFrame, Command, CommandResult, Event,
    HelloResult, PROTOCOL_VERSION, ServerFrame, read_frame, write_frame,
};

use crate::{discovery, error::CoreError, session::LibrarySession};

enum Input {
    Request(ClientFrame),
    Invalid(String),
    Eof,
}

struct JobControl {
    session_id: String,
    cancelled: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

pub struct CommandEngine {
    sessions: HashMap<String, LibrarySession>,
    jobs: HashMap<String, JobControl>,
    event_sender: Sender<Event>,
    event_receiver: Receiver<Event>,
    event_sequence: u64,
}

impl CommandEngine {
    pub fn new() -> Self {
        let (event_sender, event_receiver) = mpsc::channel();
        Self {
            sessions: HashMap::new(),
            jobs: HashMap::new(),
            event_sender,
            event_receiver,
            event_sequence: 0,
        }
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
                self.stop_jobs_for_session(&session_id);
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
                    },
                );
                self.queue_local_event(Event::RootStateChanged {
                    root_id: root_id.clone(),
                    state: "scanning".into(),
                });
                Ok(CommandResult::RootAdded { root_id, job_id })
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
                self.session(&session_id)?;
                let state = if let Some(job) = self.jobs.get(&job_id) {
                    if job.session_id != session_id {
                        CancellationState::UnknownJob
                    } else {
                        job.cancelled.store(true, Ordering::Relaxed);
                        CancellationState::CancellationRequested
                    }
                } else if self.session(&session_id)?.job_state(&job_id)?.is_some() {
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
                self.stop_all_jobs();
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
        self.event_sender.send(event).ok();
    }

    fn stop_jobs_for_session(&mut self, session_id: &str) {
        let job_ids = self
            .jobs
            .iter()
            .filter(|(_, job)| job.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for job_id in job_ids {
            if let Some(mut job) = self.jobs.remove(&job_id) {
                job.cancelled.store(true, Ordering::Relaxed);
                if let Some(handle) = job.handle.take() {
                    let _ = handle.join();
                }
            }
        }
    }

    fn stop_all_jobs(&mut self) {
        let session_ids = self
            .jobs
            .values()
            .map(|job| job.session_id.clone())
            .collect::<Vec<_>>();
        for session_id in session_ids {
            self.stop_jobs_for_session(&session_id);
        }
    }

    fn take_event(&mut self) -> Option<Event> {
        self.event_receiver.try_recv().ok()
    }

    fn next_event_frame(&mut self, event: Event) -> ServerFrame {
        self.event_sequence += 1;
        if let Event::JobUpdated { job_id, state } = &event
            && matches!(state.as_str(), "completed" | "failed" | "cancelled")
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
        while let Some(event) = engine.take_event() {
            write_frame(&mut writer, &engine.next_event_frame(event)).map_err(|e| e.to_string())?;
        }
        match input_receiver.try_recv() {
            Ok(Input::Request(request)) => {
                let request_id = request.request_id.clone();
                let is_shutdown = matches!(&request.command, Command::Shutdown);
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
                engine.stop_all_jobs();
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
