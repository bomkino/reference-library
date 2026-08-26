use std::{
    fs,
    io::{BufReader, BufWriter},
    process::{Child, ChildStdin, ChildStdout, Command as ProcessCommand, Stdio},
};

use reference_protocol::{
    AssetProjection, ClientFrame, Command, CommandResult, Event, PROTOCOL_VERSION, ServerFrame,
    read_frame, write_frame,
};
use uuid::Uuid;

const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x7b, 0x40, 0xe8,
    0xdd, 0x00, 0x00, 0x00, 0x0f, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xac, 0x90, 0x3b, 0xc1,
    0xc0, 0xc0, 0x00, 0x00, 0x06, 0x94, 0x01, 0x60, 0x2d, 0x11, 0x76, 0xec, 0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

struct CoreProcess {
    child: Child,
    input: BufWriter<ChildStdin>,
    output: BufReader<ChildStdout>,
}

impl CoreProcess {
    fn start() -> Self {
        let mut child = ProcessCommand::new(env!("CARGO_BIN_EXE_reference-core"))
            .env("PITCHDOG_ENABLE_TEST_COMMANDS", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let input = BufWriter::new(child.stdin.take().unwrap());
        let output = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            input,
            output,
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

    fn response(&mut self, request_id: &str) -> CommandResult {
        loop {
            match read_frame::<ServerFrame>(&mut self.output)
                .unwrap()
                .unwrap()
            {
                ServerFrame::Response {
                    request_id: actual,
                    result,
                    ..
                } if actual == request_id => return result,
                ServerFrame::Error {
                    request_id: actual,
                    error,
                    ..
                } if actual == request_id => panic!("core error {}: {}", error.code, error.message),
                ServerFrame::Event { .. }
                | ServerFrame::Response { .. }
                | ServerFrame::Error { .. } => {}
            }
        }
    }

    fn wait_for_completed_job(&mut self, job_id: &str) {
        loop {
            let frame = read_frame::<ServerFrame>(&mut self.output)
                .unwrap()
                .expect("core exited before terminal job event");
            if matches!(
                frame,
                ServerFrame::Event {
                    event: Event::JobUpdated { job_id: id, state },
                    ..
                } if id == job_id && state == "completed"
            ) {
                return;
            }
        }
    }
}

#[test]
fn framed_core_survives_supervised_restart_without_false_completion() {
    let directory = std::env::temp_dir().join(format!("pitchdog-core-{}", Uuid::new_v4()));
    let root = directory.join("Root");
    fs::create_dir_all(&root).unwrap();
    for index in 0..70 {
        fs::write(root.join(format!("still-{index:03}.png")), PNG).unwrap();
    }
    let library = directory.join("Protocol.pitchlibrary");

    let mut core = CoreProcess::start();
    core.send(
        "hello",
        Command::Hello {
            client_name: "host-neutral-supervisor-test".into(),
            supported_versions: vec![PROTOCOL_VERSION],
        },
    );
    assert!(matches!(core.response("hello"), CommandResult::Hello(_)));
    core.send(
        "create",
        Command::CreateLibrary {
            path: library.to_string_lossy().into_owned(),
            name: "Protocol".into(),
        },
    );
    let CommandResult::SessionOpened(opened) = core.response("create") else {
        panic!("wrong create response")
    };
    core.send(
        "add-root",
        Command::AddRoot {
            session_id: opened.session_id.clone(),
            authorized_path: root.to_string_lossy().into_owned(),
            display_name: "Root".into(),
        },
    );
    let CommandResult::RootAdded { job_id, .. } = core.response("add-root") else {
        panic!("wrong add-root response")
    };
    core.wait_for_completed_job(&job_id);
    core.send(
        "query",
        Command::QueryAssets {
            session_id: opened.session_id.clone(),
            offset: 0,
            limit: 25,
            projection: AssetProjection::ContactSheetStandard,
        },
    );
    let CommandResult::AssetPage(page) = core.response("query") else {
        panic!("wrong query response")
    };
    assert_eq!(page.total, 70);
    assert_eq!(page.items.len(), 25);
    core.send(
        "dump-before",
        Command::CanonicalDump {
            session_id: opened.session_id,
        },
    );
    let CommandResult::CanonicalDump { dump: before } = core.response("dump-before") else {
        panic!("wrong dump response")
    };

    core.send("crash", Command::TestCrash);
    assert!(
        read_frame::<ServerFrame>(&mut core.output)
            .unwrap()
            .is_none()
    );
    assert_eq!(core.child.wait().unwrap().code(), Some(91));

    let mut restarted = CoreProcess::start();
    restarted.send(
        "open-after-restart",
        Command::OpenLibrary {
            path: library.to_string_lossy().into_owned(),
        },
    );
    let CommandResult::SessionOpened(reopened) = restarted.response("open-after-restart") else {
        panic!("wrong reopen response")
    };
    restarted.send(
        "dump-after",
        Command::CanonicalDump {
            session_id: reopened.session_id.clone(),
        },
    );
    let CommandResult::CanonicalDump { dump: after } = restarted.response("dump-after") else {
        panic!("wrong dump response")
    };
    assert_eq!(after, before);
    restarted.send(
        "close",
        Command::CloseLibrary {
            session_id: reopened.session_id,
        },
    );
    assert!(matches!(
        restarted.response("close"),
        CommandResult::LibraryClosed { .. }
    ));
    restarted.send("shutdown", Command::Shutdown);
    assert!(matches!(
        restarted.response("shutdown"),
        CommandResult::Shutdown
    ));
    assert!(restarted.child.wait().unwrap().success());

    fs::remove_dir_all(&directory).unwrap();
}
