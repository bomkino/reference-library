from pathlib import Path

ROOT = Path.cwd()
SERVER = ROOT / "crates/reference-core/src/server.rs"
EVIDENCE = ROOT / "docs/evidence/DECISION_EVIDENCE_LOG.md"

text = SERVER.read_text()
old = '''        for job_id in &job_ids {
            if let Some(job) = self.jobs.get_mut(job_id)
                && job.kind == JobKind::Scan
                && let Some(handle) = job.handle.take()
            {
                let _ = handle.join();
            }
        }
'''
new = '''        for job_id in &job_ids {
            let Some(mut job) = self.jobs.remove(job_id) else {
                continue;
            };
            if job.kind == JobKind::Scan
                && let Some(handle) = job.handle.take()
            {
                let _ = handle.join();
            }
        }
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one session cleanup loop, found {text.count(old)}")
text = text.replace(old, new)

needle = '''        assert_eq!(engine.resource_inflight, 0);
        assert!(!engine.jobs.contains_key(&job_id));
    }
}
'''
replacement = '''        assert_eq!(engine.resource_inflight, 0);
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
'''
if text.count(needle) != 1:
    raise SystemExit(f"expected one test module tail, found {text.count(needle)}")
SERVER.write_text(text.replace(needle, replacement))

heading = "## 2026-08-28 — Session shutdown releases completed controls"
evidence = EVIDENCE.read_text()
if heading in evidence:
    raise SystemExit("session-cleanup evidence entry already exists")
with EVIDENCE.open("a") as handle:
    handle.write(
        "\n\n" + heading + "\n\n"
        "**Hypothesis:** `stop_jobs_for_session` waited for workers and joined scan threads but left their `JobControl` records resident. A dropped terminal event or failed terminal write could therefore consume future scan capacity after a Library closed.\n\n"
        "**Change:** after every worker for the session confirms completion, remove each scan and resource control; join the owned scan handle before dropping it. Add a regression containing both worker kinds.\n\n"
        "**Fresh measurement:** the focused shutdown regression, format gate and repository boundary must pass before commit; the complete five-job workflow remains the integration gate.\n\n"
        "**Decision:** successful session shutdown is now the final in-memory ownership boundary. Timed-out workers remain retained because the session and writer lock must stay alive until quiescence.\n"
    )
