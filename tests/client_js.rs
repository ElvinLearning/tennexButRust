//! Runs the browser-side logic tests (reply parser, routing, brief, sim) with Node's built-in
//! test runner, so `cargo test` covers everything. Skipped if Node isn't installed.

use std::process::Command;

#[test]
fn client_logic_tests() {
    let dir = env!("CARGO_MANIFEST_DIR");
    let files: Vec<String> = std::fs::read_dir(format!("{dir}/tests/js"))
        .expect("tests/js")
        .filter_map(|e| e.ok())
        .map(|e| e.path().display().to_string())
        .filter(|p| p.ends_with(".test.mjs"))
        .collect();
    let out = match Command::new("node").arg("--test").args(&files).current_dir(dir).output() {
        Ok(o) => o,
        Err(_) => {
            eprintln!("node not found: skipping client JS tests");
            return;
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "client JS tests failed:\n{stdout}\n{}", String::from_utf8_lossy(&out.stderr));
}
