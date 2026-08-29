use std::{
    fs,
    io::{BufReader, BufWriter},
    process::{Child, ChildStdin, ChildStdout, Command as ProcessCommand, Stdio},
};

use reference_protocol::{
    ClientFrame, Command, CommandResult, PROTOCOL_VERSION, ProtocolError, ResourceProfile,
    ServerFrame, read_frame, write_frame,
};
use uuid::Uuid;

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

    fn send(&mut self, request_id: &str, command: Command) {
        write_frame(
            &mut self.input,
            &ClientFrame {
                protocol_version: PROTOCOL_VERSION,
                request_id: request_id.into(),
                command,
            },
        )
        .unwrap();
    }

    fn result(&mut self, request_id: &str) -> CommandResult {
        loop {
            match read_frame::<ServerFrame>(&mut self.output)
                .unwrap()
                .unwrap()
            {
                ServerFrame::Response {
                    request_id: actual,
                    result,
                    ..
                } if actual == request_id => return *result,
                ServerFrame::Error {
                    request_id: actual,
                    error,
                    ..
                } if actual == request_id => panic!("{}: {}", error.code, error.message),
                _ => {}
            }
        }
    }

    fn error(&mut self, request_id: &str) -> ProtocolError {
        loop {
            match read_frame::<ServerFrame>(&mut self.output)
                .unwrap()
                .unwrap()
            {
                ServerFrame::Error {
                    request_id: actual,
                    error,
                    ..
                } if actual == request_id => return error,
                ServerFrame::Response {
                    request_id: actual,
                    result,
                    ..
                } if actual == request_id => panic!("unexpected success: {result:?}"),
                _ => {}
            }
        }
    }
}

#[test]
fn bind_scan_and_named_resources_return_typed_path_free_errors() {
    let directory =
        std::env::temp_dir().join(format!("reference-v1-root-errors-{}", Uuid::new_v4()));
    let root = directory.join("Authorized Root");
    fs::create_dir_all(&root).unwrap();
    let library = directory.join("Errors.pitchlibrary");
    let mut core = CoreProcess::start();
    core.send(
        "create",
        Command::CreateLibrary {
            path: library.to_string_lossy().into_owned(),
            name: "Error matrix".into(),
        },
    );
    let CommandResult::SessionOpened(opened) = core.result("create") else {
        panic!("wrong create response")
    };
    let unknown_root = Uuid::new_v4().to_string();
    let wrong_session = Uuid::new_v4().to_string();

    for (request_id, command) in [
        (
            "bind-wrong-session",
            Command::BindRoot {
                session_id: wrong_session.clone(),
                root_id: unknown_root.clone(),
                authorized_path: root.to_string_lossy().into_owned(),
            },
        ),
        (
            "scan-wrong-session",
            Command::ScanRoot {
                session_id: wrong_session,
                root_id: unknown_root.clone(),
            },
        ),
    ] {
        core.send(request_id, command);
        assert_public_error(core.error(request_id), "SessionClosed");
    }

    for (request_id, command) in [
        (
            "bind-unknown-root",
            Command::BindRoot {
                session_id: opened.session_id.clone(),
                root_id: unknown_root.clone(),
                authorized_path: root.to_string_lossy().into_owned(),
            },
        ),
        (
            "scan-unknown-root",
            Command::ScanRoot {
                session_id: opened.session_id.clone(),
                root_id: unknown_root,
            },
        ),
        (
            "bind-path-shaped-id",
            Command::BindRoot {
                session_id: opened.session_id.clone(),
                root_id: "/private/renderer-controlled-root".into(),
                authorized_path: root.to_string_lossy().into_owned(),
            },
        ),
        (
            "scan-path-shaped-id",
            Command::ScanRoot {
                session_id: opened.session_id.clone(),
                root_id: "/private/renderer-controlled-root".into(),
            },
        ),
    ] {
        core.send(request_id, command);
        assert_public_error(core.error(request_id), "RootNotFound");
    }

    core.send(
        "resolve-raw-path",
        Command::ResolveLocation {
            session_id: opened.session_id.clone(),
            location_id: "/private/renderer-controlled-source.png".into(),
        },
    );
    assert_public_error(core.error("resolve-raw-path"), "RawPathResourceDenied");
    core.send(
        "authorize-raw-path",
        Command::AuthorizeResource {
            session_id: opened.session_id.clone(),
            asset_id: "/private/renderer-controlled-source.png".into(),
            profile: ResourceProfile::Preview,
        },
    );
    assert_public_error(core.error("authorize-raw-path"), "RawPathResourceDenied");

    core.send(
        "close",
        Command::CloseLibrary {
            session_id: opened.session_id,
        },
    );
    assert!(matches!(
        core.result("close"),
        CommandResult::LibraryClosed { .. }
    ));
    core.send("shutdown", Command::Shutdown);
    assert!(matches!(core.result("shutdown"), CommandResult::Shutdown));
    assert!(core.child.wait().unwrap().success());
    fs::remove_dir_all(directory).unwrap();
}

fn assert_public_error(error: ProtocolError, expected_code: &str) {
    assert_eq!(error.code, expected_code);
    assert!(!error.retryable);
    assert!(!error.message.contains('/'));
    assert!(!error.message.contains('\\'));
    assert!(!error.message.contains("private"));
    assert!(!error.message.contains("renderer-controlled"));
}
