use std::{
    fs,
    io::{BufReader, BufWriter},
    process::{Child, ChildStdin, ChildStdout, Command as ProcessCommand, Stdio},
};

use reference_protocol::{
    AssetProjection, CancellationState, ClientFrame, Command, CommandResult, Event,
    PROTOCOL_VERSION, ResourceProfile, ServerFrame, read_frame, write_frame,
};
use uuid::Uuid;

const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
    2, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x7b, 0x40, 0xe8, 0xdd, 0, 0, 0, 0x0f, 0x49, 0x44, 0x41, 0x54,
    0x78, 0x9c, 0x63, 0xac, 0x90, 0x3b, 0xc1, 0xc0, 0xc0, 0, 0, 6, 0x94, 1, 0x60, 0x2d, 0x11, 0x76,
    0xec, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

struct CoreProcess {
    child: Child,
    input: BufWriter<ChildStdin>,
    output: BufReader<ChildStdout>,
}
impl CoreProcess {
    fn start() -> Self {
        let mut child = ProcessCommand::new(env!("CARGO_BIN_EXE_reference-core"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        Self {
            input: BufWriter::new(child.stdin.take().unwrap()),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
        }
    }
    fn send(&mut self, id: &str, command: Command) {
        write_frame(
            &mut self.input,
            &ClientFrame {
                protocol_version: PROTOCOL_VERSION,
                request_id: id.into(),
                command,
            },
        )
        .unwrap();
    }
    fn next(&mut self) -> ServerFrame {
        read_frame(&mut self.output).unwrap().unwrap()
    }
    fn response(&mut self, id: &str) -> CommandResult {
        loop {
            match self.next() {
                ServerFrame::Response {
                    request_id, result, ..
                } if request_id == id => return *result,
                ServerFrame::Error {
                    request_id, error, ..
                } if request_id == id => panic!("{}: {}", error.code, error.message),
                _ => {}
            }
        }
    }
}

#[test]
fn authorization_is_correlated_cancellable_and_does_not_block_dispatch() {
    let directory = std::env::temp_dir().join(format!("reference-v1-async-{}", Uuid::new_v4()));
    let root = directory.join("Root");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("large.png");
    fs::write(&source, PNG).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&source)
        .unwrap()
        .set_len(192 * 1024 * 1024)
        .unwrap();
    let library = directory.join("Project.pitchlibrary");
    let mut core = CoreProcess::start();
    core.send(
        "create",
        Command::CreateLibrary {
            path: library.to_string_lossy().into(),
            name: "Async".into(),
        },
    );
    let CommandResult::SessionOpened(opened) = core.response("create") else {
        panic!()
    };
    core.send(
        "add",
        Command::AddRoot {
            session_id: opened.session_id.clone(),
            authorized_path: root.to_string_lossy().into(),
            display_name: "Root".into(),
        },
    );
    let CommandResult::RootAdded {
        job_id: scan_job, ..
    } = core.response("add")
    else {
        panic!()
    };
    loop {
        if matches!(core.next(), ServerFrame::Event { event:Event::JobUpdated { job_id, state }, .. }
        if job_id==scan_job && state=="completed")
        {
            break;
        }
    }
    core.send(
        "query",
        Command::QueryAssets {
            session_id: opened.session_id.clone(),
            offset: 0,
            limit: 1,
            projection: AssetProjection::ContactSheetStandard,
        },
    );
    let CommandResult::AssetPage(page) = core.response("query") else {
        panic!()
    };
    let asset_id = page.items[0].asset_id.clone();
    core.send(
        "authorize",
        Command::AuthorizeResource {
            session_id: opened.session_id.clone(),
            asset_id: asset_id.clone(),
            profile: ResourceProfile::Preview,
        },
    );
    core.send(
        "capabilities",
        Command::GetCapabilities {
            session_id: Some(opened.session_id.clone()),
        },
    );
    let mut started_job = None;
    let mut capabilities_before_terminal = false;
    let mut cancelled_response = false;
    let mut authorization_cancelled = false;
    while !authorization_cancelled {
        match core.next() {
            ServerFrame::Event {
                event:
                    Event::ResourceAuthorizationStarted {
                        request_id,
                        job_id,
                        asset_id: started_asset,
                        profile,
                    },
                ..
            } if request_id == "authorize" => {
                assert_eq!(started_asset, asset_id);
                assert_eq!(profile, ResourceProfile::Preview);
                started_job = Some(job_id.clone());
                core.send(
                    "cancel",
                    Command::CancelJob {
                        session_id: opened.session_id.clone(),
                        job_id,
                    },
                );
            }
            ServerFrame::Response {
                request_id, result, ..
            } if request_id == "capabilities"
                && matches!(result.as_ref(), CommandResult::Capabilities(_)) =>
            {
                capabilities_before_terminal = true
            }
            ServerFrame::Response {
                request_id, result, ..
            } if request_id == "cancel" => {
                let CommandResult::JobCancellation { state, .. } = result.as_ref() else {
                    continue;
                };
                assert_eq!(*state, CancellationState::CancellationRequested);
                cancelled_response = true;
            }
            ServerFrame::Error {
                request_id, error, ..
            } if request_id == "authorize" => {
                assert_eq!(error.code, "RenditionCancelled");
                authorization_cancelled = true;
            }
            _ => {}
        }
    }
    assert!(started_job.is_some());
    assert!(capabilities_before_terminal);
    assert!(cancelled_response);

    for index in 0..11 {
        core.send(
            &format!("flood-{index}"),
            Command::AuthorizeResource {
                session_id: opened.session_id.clone(),
                asset_id: asset_id.clone(),
                profile: ResourceProfile::Preview,
            },
        );
    }
    let mut overload_seen = false;
    while !overload_seen {
        if let ServerFrame::Error {
            request_id, error, ..
        } = core.next()
            && request_id.starts_with("flood-")
            && error.code == "RenditionQueueFull"
        {
            assert!(error.retryable);
            overload_seen = true;
        }
    }
    core.send("shutdown", Command::Shutdown);
    assert!(matches!(core.response("shutdown"), CommandResult::Shutdown));
    assert!(core.child.wait().unwrap().success());
    let _ = fs::remove_dir_all(directory);
}
