pub mod canonical;
pub mod discovery;
pub mod editorial;
pub mod error;
pub mod manifest;
pub mod rendition;
pub mod schema;
pub mod server;
pub mod session;

use std::time::{SystemTime, UNIX_EPOCH};

pub const SCHEMA_VERSION: u32 = 3;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
