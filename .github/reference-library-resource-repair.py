from pathlib import Path

ROOT = Path.cwd()
SERVER = ROOT / "crates/reference-core/src/server.rs"
EVIDENCE = ROOT / "docs/evidence/DECISION_EVIDENCE_LOG.md"

text = SERVER.read_text()
old = '''        self.resource_inflight = self.resource_inflight.saturating_sub(1);
        if response.terminal_persisted {
            self.jobs.remove(&response.job_id);
        }
'''
new = '''        self.resource_inflight = self.resource_inflight.saturating_sub(1);
        // The worker is finished even when its terminal ledger write failed.
        // run_job_outcome already returned an error and emitted
        // CoreNeedsRestart; retaining this control would only leak the job map.
        debug_assert!(response.terminal_persisted || response.result.is_err());
        self.jobs.remove(&response.job_id);
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one async cleanup block, found {text.count(old)}")
text = text.replace(old, new)

needle = '''        assert!(!engine.jobs.contains_key(&job_id));
    }
}
'''
replacement = '''        assert!(!engine.jobs.contains_key(&job_id));
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
}
'''
if text.count(needle) != 1:
    raise SystemExit(f"expected one test module tail, found {text.count(needle)}")
SERVER.write_text(text.replace(needle, replacement))

heading = "## 2026-08-28 — Finished rendition controls release after persistence failure"
evidence = EVIDENCE.read_text()
if heading in evidence:
    raise SystemExit("rendition-control evidence entry already exists")
with EVIDENCE.open("a") as handle:
    handle.write(
        "\n\n" + heading + "\n\n"
        "**Hypothesis:** a completed resource worker whose terminal job-state write failed was removed from in-flight capacity but retained in the Core job map indefinitely.\n\n"
        "**Change:** release the completed in-memory resource control unconditionally after consuming its response. The persistence failure remains an error and already emits `CoreNeedsRestart`. Add a focused regression covering the failed-persistence path.\n\n"
        "**Fresh measurement:** the focused Core regression and repository boundary must pass before this repair is committed; the complete five-job workflow remains the integration gate.\n\n"
        "**Decision:** use one lifecycle invariant for scan and rendition workers: finished work never occupies live in-memory control state, while durable-state failures remain explicit restart conditions.\n"
    )
