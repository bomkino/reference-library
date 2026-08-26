//! Versioned, length-prefixed control protocol shared by both native shells.
//!
//! Media bytes do not use this channel. Only typed commands, bounded query
//! projections, resource descriptors and events are framed here.

use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_PAGE_SIZE: u32 = 250;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientFrame {
    pub protocol_version: u32,
    pub request_id: String,
    pub command: Command,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "method", content = "params", rename_all = "snake_case")]
pub enum Command {
    Hello {
        client_name: String,
        supported_versions: Vec<u32>,
    },
    CreateLibrary {
        path: String,
        name: String,
    },
    OpenLibrary {
        path: String,
    },
    CloseLibrary {
        session_id: String,
    },
    AddRoot {
        session_id: String,
        authorized_path: String,
        display_name: String,
    },
    QueryAssets {
        session_id: String,
        offset: u64,
        limit: u32,
        projection: AssetProjection,
    },
    AuthorizeResource {
        session_id: String,
        asset_id: String,
        profile: ResourceProfile,
    },
    ResolveLocation {
        session_id: String,
        location_id: String,
    },
    CanonicalDump {
        session_id: String,
    },
    GetCapabilities {
        session_id: Option<String>,
    },
    CancelJob {
        session_id: String,
        job_id: String,
    },
    #[serde(rename = "test_crash")]
    TestCrash,
    Shutdown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssetProjection {
    ContactSheetTiny,
    ContactSheetStandard,
    ContactSheetDetailed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceProfile {
    GridStandard,
    Preview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ServerFrame {
    Response {
        protocol_version: u32,
        request_id: String,
        result: CommandResult,
    },
    Error {
        protocol_version: u32,
        request_id: String,
        error: ProtocolError,
    },
    Event {
        protocol_version: u32,
        sequence: u64,
        event: Event,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "result", content = "value", rename_all = "snake_case")]
pub enum CommandResult {
    Hello(HelloResult),
    SessionOpened(SessionOpened),
    LibraryClosed {
        session_id: String,
    },
    RootAdded {
        root_id: String,
        job_id: String,
    },
    AssetPage(AssetPage),
    ResourceAuthorized(ResourceDescriptor),
    LocationResolved(NativeLocation),
    CanonicalDump {
        dump: Value,
    },
    Capabilities(Capabilities),
    JobCancellation {
        job_id: String,
        state: CancellationState,
    },
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HelloResult {
    pub protocol_version: u32,
    pub core_version: String,
    pub max_page_size: u32,
    pub features: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpened {
    pub session_id: String,
    pub library_id: String,
    pub schema_version: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetPage {
    pub offset: u64,
    pub limit: u32,
    pub total: u64,
    pub items: Vec<AssetSummary>,
    pub next_offset: Option<u64>,
    pub library_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetSummary {
    pub asset_id: String,
    pub location_id: String,
    pub display_name: String,
    pub media_family: String,
    pub availability: String,
    pub review_state: String,
}

/// Privileged core-to-shell descriptor. Native paths must never be forwarded
/// through the workspace bridge or encoded in renderer URLs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDescriptor {
    pub resource_token: String,
    pub session_id: String,
    pub asset_id: String,
    pub location_id: String,
    pub profile: ResourceProfile,
    pub mime_type: String,
    pub content_length: u64,
    pub native_path_for_handler: String,
}

/// Privileged core-to-shell result used only by named native reveal/open code.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeLocation {
    pub location_id: String,
    pub native_path_for_shell: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub choose_root: bool,
    pub reveal_location: bool,
    pub opaque_asset_resources: bool,
    pub source_mutation: bool,
    pub detail: Vec<CapabilityDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDetail {
    pub name: String,
    pub state: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CancellationState {
    CancellationRequested,
    AlreadyTerminal,
    UnknownJob,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "event", content = "value", rename_all = "snake_case")]
pub enum Event {
    RootStateChanged {
        root_id: String,
        state: String,
    },
    ScanProgressChanged {
        root_id: String,
        job_id: String,
        observed_count: u64,
        terminal: bool,
    },
    AssetsInserted {
        root_id: String,
        asset_ids: Vec<String>,
        library_revision: u64,
    },
    JobUpdated {
        job_id: String,
        state: String,
    },
    CoreNeedsRestart {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl ProtocolError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
        }
    }
}

#[derive(Debug, Error)]
pub enum FrameError {
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("frame length {actual} exceeds {maximum} byte limit")]
    FrameTooLarge { actual: usize, maximum: usize },
    #[error("invalid JSON frame: {0}")]
    InvalidJson(#[from] serde_json::Error),
}

pub fn read_frame<T: for<'de> Deserialize<'de>>(
    reader: &mut impl Read,
) -> Result<Option<T>, FrameError> {
    let mut header = [0_u8; 4];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let length = u32::from_be_bytes(header) as usize;
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::FrameTooLarge {
            actual: length,
            maximum: MAX_FRAME_BYTES,
        });
    }
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(serde_json::from_slice(&payload)?))
}

pub fn write_frame<T: Serialize>(writer: &mut impl Write, value: &T) -> Result<(), FrameError> {
    let payload = serde_json::to_vec(value)?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err(FrameError::FrameTooLarge {
            actual: payload.len(),
            maximum: MAX_FRAME_BYTES,
        });
    }
    writer.write_all(&(payload.len() as u32).to_be_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_request_round_trips_through_frame() {
        let request = ClientFrame {
            protocol_version: PROTOCOL_VERSION,
            request_id: "request-1".into(),
            command: Command::QueryAssets {
                session_id: "session-1".into(),
                offset: 250,
                limit: 100,
                projection: AssetProjection::ContactSheetStandard,
            },
        };
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &request).unwrap();
        let decoded: ClientFrame = read_frame(&mut bytes.as_slice()).unwrap().unwrap();
        assert_eq!(decoded, request);
    }

    #[test]
    fn oversized_frame_is_rejected_before_allocation() {
        let mut bytes = ((MAX_FRAME_BYTES as u32) + 1).to_be_bytes().to_vec();
        bytes.extend_from_slice(b"{}");
        let error = read_frame::<ClientFrame>(&mut bytes.as_slice()).unwrap_err();
        assert!(matches!(error, FrameError::FrameTooLarge { .. }));
    }
}
