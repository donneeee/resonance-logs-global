use crate::live::chat_feed;
use crate::live::event_logger::{EventLoggerEntry, now_ms};
use crate::packets::game_connections::{GameConnectionFilter, Verdict};
use crate::packets::npcap::NpcapCapture;
use crate::packets::opcodes::{FragmentType, Pkt};
use crate::packets::packet_process::{process_packet, try_send_capture_event};
use crate::packets::parser::ParsedNotifyFragment;
use crate::packets::reassembler::Reassembler;
use crate::packets::utils::{Server, TCPReassembler, TcpInsertResult, tcp_sequence_before};
use bytes::Bytes;
use etherparse::NetSlice::Ipv4;
use etherparse::SlicedPacket;
use etherparse::TransportSlice::Tcp;
use log::{debug, error, info, warn};
use once_cell::sync::OnceCell;
#[cfg(debug_assertions)]
use serde::Serialize;
#[cfg(debug_assertions)]
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
#[cfg(debug_assertions)]
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::watch;

// Global sender for restart signal
static RESTART_SENDER: OnceCell<watch::Sender<bool>> = OnceCell::new();

#[cfg(debug_assertions)]
static CAPTURE_CENSUS_ENABLED: OnceLock<std::sync::atomic::AtomicBool> = OnceLock::new();

#[cfg(debug_assertions)]
fn capture_census_flag() -> &'static std::sync::atomic::AtomicBool {
    CAPTURE_CENSUS_ENABLED.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}

pub fn set_capture_census_enabled(enabled: bool) {
    #[cfg(debug_assertions)]
    {
        capture_census_flag().store(enabled, Ordering::Relaxed);
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = enabled;
    }
}

#[cfg_attr(not(debug_assertions), allow(dead_code))]
fn capture_census_enabled() -> bool {
    #[cfg(debug_assertions)]
    {
        capture_census_flag().load(Ordering::Relaxed)
    }

    #[cfg(not(debug_assertions))]
    {
        false
    }
}

pub fn is_capture_census_enabled() -> bool {
    capture_census_enabled()
}

#[cfg(debug_assertions)]
fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            let value = value.trim();
            value == "1"
                || value.eq_ignore_ascii_case("true")
                || value.eq_ignore_ascii_case("yes")
                || value.eq_ignore_ascii_case("on")
        })
        .unwrap_or(false)
}

#[cfg(debug_assertions)]
fn capture_payload_probes_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();

    *ENABLED.get_or_init(|| env_flag_enabled("RESONANCE_ENABLE_CAPTURE_PAYLOAD_PROBES"))
}

const MAX_BACKTRACK_BYTES: u32 = 2 * 1024 * 1024; // 2 MiB safety window before considering a reset
const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(90);
const CAPTURE_CHANNEL_CAP: usize = 4096;

// Common libpcap datalink constants we care about.
const DLT_NULL: i32 = 0;
const DLT_EN10MB: i32 = 1;
const DLT_RAW: i32 = 12;
const DLT_LOOP: i32 = 108;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PacketFormat {
    RawIp,
    Ethernet,
    Unsupported,
}

#[derive(Debug)]
pub enum CaptureEvent {
    Packet(Pkt, Bytes),
    Notify(ParsedNotifyFragment),
    AuxiliaryEntries(Vec<EventLoggerEntry>),
}

struct NonSceneStreamState {
    tcp_reassembler: TCPReassembler,
    reassembler: Reassembler,
    last_seen: Instant,
}

impl NonSceneStreamState {
    fn new() -> Self {
        Self {
            tcp_reassembler: TCPReassembler::new(),
            reassembler: Reassembler::new(),
            last_seen: Instant::now(),
        }
    }
}

const NON_SCENE_STREAM_LIMIT: usize = 32;
const WORLD_NTF_SERVICE_ID: u64 = 0x0000000063335342;
const CHIT_CHAT_NTF_SERVICE_ID: u64 = 164931432;
const GRPC_TEAM_NTF_SERVICE_ID: u64 = 0x00000000399fca69;
const NOTIFY_NEWEST_CHIT_CHAT_MSGS_METHOD_ID: u32 = 0x1;
const SYNC_CONTAINER_DIRTY_DATA_METHOD_ID: u32 = 0x16;
const ITEM_CANDIDATE_METHOD_ID: u32 = 0x39;

#[cfg(debug_assertions)]
#[derive(Default)]
struct CaptureCensusRuntime {
    seen_connections: HashSet<String>,
    fragment_counts: HashMap<String, usize>,
    stream_limit_logged: HashSet<String>,
    probe_fingerprints: HashMap<String, u64>,
    probe_counts: HashMap<String, usize>,
}

#[cfg(debug_assertions)]
fn should_emit_diagnostic_fragment_count(count: usize) -> bool {
    matches!(count, 1 | 2 | 3 | 5 | 10 | 25 | 50 | 100)
}

fn should_probe_candidate_payload(service_id: u64, method_id: u32) -> bool {
    service_id == WORLD_NTF_SERVICE_ID
        && matches!(
            method_id,
            SYNC_CONTAINER_DIRTY_DATA_METHOD_ID | ITEM_CANDIDATE_METHOD_ID
        )
}

#[cfg(debug_assertions)]
fn push_payload_probe_entry(
    entries: &mut Vec<EventLoggerEntry>,
    runtime: &mut CaptureCensusRuntime,
    endpoint: &str,
    service_id: u64,
    method_id: u32,
    compressed: bool,
    payload: &[u8],
) {
    if !capture_payload_probes_enabled() {
        return;
    }

    if !should_probe_candidate_payload(service_id, method_id) {
        return;
    }

    let mut hasher = DefaultHasher::new();
    endpoint.hash(&mut hasher);
    service_id.hash(&mut hasher);
    method_id.hash(&mut hasher);
    payload.hash(&mut hasher);
    let fingerprint = hasher.finish();

    let key = format!("{}|{}|{}", endpoint, service_id, method_id);
    if runtime
        .probe_fingerprints
        .get(&key)
        .copied()
        .is_some_and(|existing| existing == fingerprint)
    {
        return;
    }
    runtime.probe_fingerprints.insert(key.clone(), fingerprint);
    let probe_count = {
        let slot = runtime.probe_counts.entry(key).or_insert(0);
        *slot += 1;
        *slot
    };

    let service_name = service_name_for_census(service_id);
    let method_name = method_name_for_census(service_id, method_id);
    let method_label = method_name
        .as_ref()
        .map(|name| format!("{} (0x{:X})", name, method_id))
        .unwrap_or_else(|| format!("0x{:X}", method_id));

    let printable_strings = extract_printable_ascii_runs(payload, 4, 12);
    let protobuf_hints = collect_protobuf_hints(payload, 48);
    let payload_hex = bytes_to_hex(payload);
    let payload_hex_preview = hex_preview(payload, 128);

    let mut summary_parts = vec![format!("candidate payload {}B", payload.len())];
    if !printable_strings.is_empty() {
        summary_parts.push(format!(
            "strings={}",
            printable_strings
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join(" | ")
        ));
    }
    if !protobuf_hints.strings.is_empty() {
        summary_parts.push(format!(
            "protoStrings={}",
            protobuf_hints
                .strings
                .iter()
                .take(2)
                .map(|item| item.text.clone())
                .collect::<Vec<_>>()
                .join(" | ")
        ));
    }
    if !protobuf_hints.varints.is_empty() {
        summary_parts.push(format!("varints={}", protobuf_hints.varints.len()));
    }
    let summary = summary_parts.join(" · ");

    entries.push(EventLoggerEntry {
        ts_ms: now_ms(),
        category: "capture_census".into(),
        action: "payload_probe".into(),
        uid: None,
        target_uid: None,
        source_uid: None,
        source_label: Some(endpoint.to_string()),
        target_label: Some(method_label.clone()),
        name_hint: Some(format!("{} / {} [probe]", service_name, method_label)),
        summary: Some(summary),
        stacks: Some(probe_count.min(i32::MAX as usize) as i32),
        duration_ms: None,
        remaining_ms: None,
        value: Some(payload.len().to_string()),
        raw: serde_json::json!({
            "endpoint": endpoint,
            "serviceId": service_id,
            "serviceIdHex": format!("0x{:016X}", service_id),
            "serviceName": service_name,
            "methodId": method_id,
            "methodIdHex": format!("0x{:X}", method_id),
            "methodName": method_name,
            "compressed": compressed,
            "payloadLength": payload.len(),
            "probeCount": probe_count,
            "fingerprintHex": format!("0x{:016X}", fingerprint),
            "printableStrings": printable_strings,
            "protobufHints": {
                "strings": protobuf_hints.strings,
                "varints": protobuf_hints.varints,
                "byteFields": protobuf_hints.byte_fields,
                "truncated": protobuf_hints.truncated,
            },
            "payloadHexPreview": payload_hex_preview,
            "payloadHex": payload_hex,
        })
        .to_string(),
    });
}

#[cfg(debug_assertions)]
#[derive(Debug, Serialize)]
struct ProbeStringHint {
    path: String,
    text: String,
}

#[cfg(debug_assertions)]
#[derive(Debug, Serialize)]
struct ProbeVarintHint {
    path: String,
    value: u64,
}

#[cfg(debug_assertions)]
#[derive(Debug, Serialize)]
struct ProbeByteFieldHint {
    path: String,
    len: usize,
    hex_preview: String,
}

#[cfg(debug_assertions)]
#[derive(Default)]
struct PayloadProbeHints {
    strings: Vec<ProbeStringHint>,
    varints: Vec<ProbeVarintHint>,
    byte_fields: Vec<ProbeByteFieldHint>,
    truncated: bool,
}

#[cfg(debug_assertions)]
fn collect_protobuf_hints(payload: &[u8], max_hints: usize) -> PayloadProbeHints {
    let mut hints = PayloadProbeHints::default();
    collect_protobuf_hints_inner(payload, "msg", 0, max_hints, &mut hints);
    hints
}

#[cfg(debug_assertions)]
fn collect_protobuf_hints_inner(
    bytes: &[u8],
    path: &str,
    depth: usize,
    max_hints: usize,
    hints: &mut PayloadProbeHints,
) {
    if depth > 3 || hints.truncated {
        return;
    }

    let mut offset = 0usize;
    while offset < bytes.len() {
        if hints.strings.len() + hints.varints.len() + hints.byte_fields.len() >= max_hints {
            hints.truncated = true;
            return;
        }

        let Some(key) = probe_read_varint(bytes, &mut offset) else {
            return;
        };
        let field_number = key >> 3;
        let wire_type = (key & 0x07) as u8;
        let field_path = format!("{}.{}", path, field_number);

        match wire_type {
            0 => {
                let Some(value) = probe_read_varint(bytes, &mut offset) else {
                    return;
                };
                hints.varints.push(ProbeVarintHint {
                    path: field_path,
                    value,
                });
            }
            1 => {
                if offset + 8 > bytes.len() {
                    return;
                }
                let value = u64::from_le_bytes(bytes[offset..offset + 8].try_into().ok().unwrap());
                offset += 8;
                hints.varints.push(ProbeVarintHint {
                    path: field_path,
                    value,
                });
            }
            2 => {
                let Some(data) = probe_read_len_delimited(bytes, &mut offset) else {
                    return;
                };
                if let Some(text) = try_decode_probe_text(data) {
                    hints.strings.push(ProbeStringHint {
                        path: field_path,
                        text,
                    });
                } else if depth < 3 && looks_like_embedded_message(data) {
                    collect_protobuf_hints_inner(data, &field_path, depth + 1, max_hints, hints);
                } else {
                    hints.byte_fields.push(ProbeByteFieldHint {
                        path: field_path,
                        len: data.len(),
                        hex_preview: hex_preview(data, 48),
                    });
                }
            }
            5 => {
                if offset + 4 > bytes.len() {
                    return;
                }
                let value =
                    u32::from_le_bytes(bytes[offset..offset + 4].try_into().ok().unwrap()) as u64;
                offset += 4;
                hints.varints.push(ProbeVarintHint {
                    path: field_path,
                    value,
                });
            }
            _ => return,
        }
    }
}

#[cfg(debug_assertions)]
fn probe_read_varint(bytes: &[u8], offset: &mut usize) -> Option<u64> {
    let mut shift = 0u32;
    let mut value = 0u64;
    while *offset < bytes.len() && shift <= 63 {
        let byte = bytes[*offset];
        *offset += 1;
        value |= u64::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
        shift += 7;
    }
    None
}

#[cfg(debug_assertions)]
fn probe_read_len_delimited<'a>(bytes: &'a [u8], offset: &mut usize) -> Option<&'a [u8]> {
    let len = probe_read_varint(bytes, offset)? as usize;
    let end = offset.checked_add(len)?;
    let slice = bytes.get(*offset..end)?;
    *offset = end;
    Some(slice)
}

#[cfg(debug_assertions)]
fn try_decode_probe_text(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes)
        .ok()?
        .trim_matches(char::from(0))
        .trim();
    if text.is_empty() {
        return None;
    }
    let printable = text.chars().filter(|ch| !ch.is_control()).count();
    let total = text.chars().count();
    if total == 0 || printable * 10 < total * 8 {
        return None;
    }
    if !text.chars().any(|ch| ch.is_alphanumeric()) {
        return None;
    }
    Some(text.chars().take(120).collect())
}

#[cfg(debug_assertions)]
fn looks_like_embedded_message(bytes: &[u8]) -> bool {
    let mut offset = 0usize;
    let Some(key) = probe_read_varint(bytes, &mut offset) else {
        return false;
    };
    let wire_type = (key & 0x07) as u8;
    match wire_type {
        0 => probe_read_varint(bytes, &mut offset).is_some(),
        1 => offset + 8 <= bytes.len(),
        2 => probe_read_len_delimited(bytes, &mut offset).is_some(),
        5 => offset + 4 <= bytes.len(),
        _ => false,
    }
}

#[cfg(debug_assertions)]
fn extract_printable_ascii_runs(bytes: &[u8], min_len: usize, max_results: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut start = None;
    for (index, byte) in bytes.iter().copied().enumerate() {
        let printable = matches!(byte, 0x20..=0x7E);
        if printable {
            start.get_or_insert(index);
        } else if let Some(run_start) = start.take() {
            if index.saturating_sub(run_start) >= min_len {
                let value = String::from_utf8_lossy(&bytes[run_start..index])
                    .trim()
                    .to_string();
                if !value.is_empty() {
                    out.push(value);
                    if out.len() >= max_results {
                        return out;
                    }
                }
            }
        }
    }
    if let Some(run_start) = start {
        if bytes.len().saturating_sub(run_start) >= min_len {
            let value = String::from_utf8_lossy(&bytes[run_start..])
                .trim()
                .to_string();
            if !value.is_empty() {
                out.push(value);
            }
        }
    }
    out
}

#[cfg(debug_assertions)]
fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{:02X}", byte);
    }
    out
}

#[cfg(debug_assertions)]
fn hex_preview(bytes: &[u8], limit: usize) -> String {
    let take = bytes.len().min(limit);
    let mut out = String::new();
    for (index, byte) in bytes.iter().copied().take(take).enumerate() {
        if index > 0 {
            out.push(' ');
        }
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{:02X}", byte);
    }
    if bytes.len() > take {
        out.push_str(" …");
    }
    out
}

fn service_name_for_census(service_id: u64) -> &'static str {
    match service_id {
        WORLD_NTF_SERVICE_ID => "WorldNtf",
        CHIT_CHAT_NTF_SERVICE_ID => "ChitChatNtf",
        GRPC_TEAM_NTF_SERVICE_ID => "GrpcTeamNtf",
        _ => "UnknownService",
    }
}

fn method_name_for_census(service_id: u64, method_id: u32) -> Option<String> {
    if service_id == WORLD_NTF_SERVICE_ID {
        return Pkt::try_from(method_id)
            .ok()
            .map(|pkt| format!("{:?}", pkt));
    }
    if service_id == CHIT_CHAT_NTF_SERVICE_ID && method_id == NOTIFY_NEWEST_CHIT_CHAT_MSGS_METHOD_ID
    {
        return Some("NotifyNewestChitChatMsgs".into());
    }
    if service_id == GRPC_TEAM_NTF_SERVICE_ID && method_id == 0x2 {
        return Some("NoticeUpdateTeamMemberInfo".into());
    }
    None
}

#[cfg(debug_assertions)]
fn enqueue_capture_connection_seen(
    endpoint: &str,
    known_server: Option<Server>,
) -> EventLoggerEntry {
    EventLoggerEntry {
        ts_ms: now_ms(),
        category: "capture_census".into(),
        action: "connection_seen".into(),
        uid: None,
        target_uid: None,
        source_uid: None,
        source_label: Some(endpoint.to_string()),
        target_label: known_server.map(|server| format!("scene={server}")),
        name_hint: Some(endpoint.to_string()),
        summary: Some("incoming endpoint first seen".into()),
        stacks: None,
        duration_ms: None,
        remaining_ms: None,
        value: None,
        raw: serde_json::json!({
            "endpoint": endpoint,
            "knownSceneServer": known_server.map(|server| server.to_string()),
        })
        .to_string(),
    }
}

#[cfg(debug_assertions)]
fn enqueue_capture_stream_limit(endpoint: &str) -> EventLoggerEntry {
    EventLoggerEntry {
        ts_ms: now_ms(),
        category: "capture_census".into(),
        action: "stream_limit".into(),
        uid: None,
        target_uid: None,
        source_uid: None,
        source_label: Some(endpoint.to_string()),
        target_label: None,
        name_hint: Some(endpoint.to_string()),
        summary: Some("diagnostic stream limit reached; skipping endpoint reassembly".into()),
        stacks: None,
        duration_ms: None,
        remaining_ms: None,
        value: Some(NON_SCENE_STREAM_LIMIT.to_string()),
        raw: serde_json::json!({
            "endpoint": endpoint,
            "streamLimit": NON_SCENE_STREAM_LIMIT,
        })
        .to_string(),
    }
}

#[cfg(debug_assertions)]
fn push_capture_fragment_entry(
    entries: &mut Vec<EventLoggerEntry>,
    endpoint: &str,
    fragment_type: FragmentType,
    service_id: u64,
    method_id: u32,
    packet_type_id: u16,
    compressed: bool,
    payload_len: usize,
    count: usize,
) {
    let service_name = service_name_for_census(service_id);
    let method_name = method_name_for_census(service_id, method_id);
    let action = if count == 1 {
        "fragment_seen"
    } else {
        "fragment_active"
    };
    let method_label = method_name
        .as_ref()
        .map(|name| format!("{} (0x{:X})", name, method_id))
        .unwrap_or_else(|| format!("0x{:X}", method_id));
    entries.push(EventLoggerEntry {
        ts_ms: now_ms(),
        category: "capture_census".into(),
        action: action.into(),
        uid: None,
        target_uid: None,
        source_uid: None,
        source_label: Some(endpoint.to_string()),
        target_label: Some(method_label.clone()),
        name_hint: Some(format!("{} / {}", service_name, method_label)),
        summary: Some(format!(
            "endpoint={} service={} method={} fragment={:?} count={} payload={}B",
            endpoint, service_name, method_label, fragment_type, count, payload_len
        )),
        stacks: Some(count.min(i32::MAX as usize) as i32),
        duration_ms: None,
        remaining_ms: None,
        value: Some(count.to_string()),
        raw: serde_json::json!({
            "endpoint": endpoint,
            "fragmentType": format!("{:?}", fragment_type),
            "serviceId": service_id,
            "serviceIdHex": format!("0x{:016X}", service_id),
            "serviceName": service_name,
            "methodId": method_id,
            "methodIdHex": format!("0x{:X}", method_id),
            "methodName": method_name,
            "packetTypeId": packet_type_id,
            "packetTypeIdHex": format!("0x{:X}", packet_type_id),
            "compressed": compressed,
            "payloadLength": payload_len,
            "count": count,
        })
        .to_string(),
    });
}

#[cfg(debug_assertions)]
fn collect_capture_census_entries_from_frame(
    frame: &Bytes,
    endpoint: &str,
    known_server: Option<Server>,
    runtime: &mut CaptureCensusRuntime,
    out: &mut Vec<EventLoggerEntry>,
) {
    if runtime.seen_connections.insert(endpoint.to_string()) {
        out.push(enqueue_capture_connection_seen(endpoint, known_server));
    }

    let mut offset = 0usize;
    let buf = frame.as_ref();

    while offset + 6 <= buf.len() {
        let size_bytes = match buf.get(offset..offset + 4) {
            Some(v) => v,
            None => break,
        };
        let packet_size = match size_bytes.try_into() {
            Ok(bytes) => u32::from_be_bytes(bytes) as usize,
            Err(_) => break,
        };
        if packet_size < 6 {
            break;
        }
        let end = match offset.checked_add(packet_size) {
            Some(v) => v,
            None => break,
        };
        if end > buf.len() {
            break;
        }

        let packet_type = match buf[offset + 4..offset + 6].try_into() {
            Ok(bytes) => u16::from_be_bytes(bytes),
            Err(_) => break,
        };
        let is_zstd_compressed = (packet_type & 0x8000) != 0;
        let msg_type_id = packet_type & 0x7fff;
        let payload_start = offset + 6;
        let payload_end = end;

        match FragmentType::from(msg_type_id) {
            FragmentType::Notify
            | FragmentType::Call
            | FragmentType::Return
            | FragmentType::Echo => {
                let fragment_type = FragmentType::from(msg_type_id);
                if let Some((service_id, method_id, payload)) =
                    parse_service_payload(frame, payload_start, payload_end, is_zstd_compressed)
                {
                    let key = format!(
                        "{}|{:?}|{}|{}",
                        endpoint, fragment_type, service_id, method_id
                    );
                    let count = {
                        let slot = runtime.fragment_counts.entry(key).or_insert(0);
                        *slot += 1;
                        *slot
                    };
                    if should_emit_diagnostic_fragment_count(count) {
                        push_capture_fragment_entry(
                            out,
                            endpoint,
                            fragment_type,
                            service_id,
                            method_id,
                            msg_type_id,
                            is_zstd_compressed,
                            payload.len(),
                            count,
                        );
                    }
                    push_payload_probe_entry(
                        out,
                        runtime,
                        endpoint,
                        service_id,
                        method_id,
                        is_zstd_compressed,
                        payload.as_ref(),
                    );
                }
            }
            FragmentType::FrameDown => {
                if payload_end.saturating_sub(payload_start) >= 4 {
                    let nested_start = payload_start + 4;
                    let nested_packet = &buf[nested_start..payload_end];
                    if is_zstd_compressed {
                        if let Ok(decompressed) = zstd::decode_all(nested_packet) {
                            let nested_bytes = Bytes::from(decompressed);
                            collect_capture_census_entries_from_frame(
                                &nested_bytes,
                                endpoint,
                                known_server,
                                runtime,
                                out,
                            );
                        }
                    } else {
                        let nested_bytes = frame.slice(nested_start..payload_end);
                        collect_capture_census_entries_from_frame(
                            &nested_bytes,
                            endpoint,
                            known_server,
                            runtime,
                            out,
                        );
                    }
                }
            }
            _ => {}
        }

        offset = end;
    }
}

fn parse_service_payload(
    frame: &Bytes,
    payload_start: usize,
    payload_end: usize,
    compressed: bool,
) -> Option<(u64, u32, Bytes)> {
    let payload = frame.get(payload_start..payload_end)?;
    if payload.len() < 16 {
        return None;
    }

    let service_id = u64::from_be_bytes(payload[0..8].try_into().ok()?);
    let _stub_id = u32::from_be_bytes(payload[8..12].try_into().ok()?);
    let method_id = u32::from_be_bytes(payload[12..16].try_into().ok()?);

    let payload = if compressed {
        match zstd::decode_all(&payload[16..]) {
            Ok(decoded) => Bytes::from(decoded),
            Err(_) => return None,
        }
    } else {
        frame.slice(payload_start + 16..payload_end)
    };

    Some((service_id, method_id, payload))
}

fn collect_chat_logger_entries_from_frame(
    frame: &Bytes,
    ts_ms: i64,
    out: &mut Vec<EventLoggerEntry>,
) {
    let mut offset = 0usize;
    let buf = frame.as_ref();

    while offset + 6 <= buf.len() {
        let size_bytes = match buf.get(offset..offset + 4) {
            Some(v) => v,
            None => break,
        };
        let packet_size = match size_bytes.try_into() {
            Ok(bytes) => u32::from_be_bytes(bytes) as usize,
            Err(_) => break,
        };
        if packet_size < 6 {
            break;
        }
        let end = match offset.checked_add(packet_size) {
            Some(v) => v,
            None => break,
        };
        if end > buf.len() {
            break;
        }

        let packet_type = match buf[offset + 4..offset + 6].try_into() {
            Ok(bytes) => u16::from_be_bytes(bytes),
            Err(_) => break,
        };
        let is_zstd_compressed = (packet_type & 0x8000) != 0;
        let msg_type_id = packet_type & 0x7fff;
        let payload_start = offset + 6;
        let payload_end = end;

        match FragmentType::from(msg_type_id) {
            FragmentType::Notify => {
                if let Some((service_id, method_id, payload)) =
                    parse_service_payload(frame, payload_start, payload_end, is_zstd_compressed)
                {
                    if service_id == CHIT_CHAT_NTF_SERVICE_ID
                        && method_id == NOTIFY_NEWEST_CHIT_CHAT_MSGS_METHOD_ID
                    {
                        out.extend(chat_feed::build_conversation_logger_entries(
                            ts_ms,
                            payload.as_ref(),
                        ));
                    }
                }
            }
            FragmentType::FrameDown => {
                if payload_end.saturating_sub(payload_start) < 4 {
                    offset = end;
                    continue;
                }

                let nested_start = payload_start + 4;
                let nested_packet = &buf[nested_start..payload_end];
                if is_zstd_compressed {
                    if let Ok(decompressed) = zstd::decode_all(nested_packet) {
                        let nested_bytes = Bytes::from(decompressed);
                        collect_chat_logger_entries_from_frame(&nested_bytes, ts_ms, out);
                    }
                } else {
                    let nested_bytes = frame.slice(nested_start..payload_end);
                    collect_chat_logger_entries_from_frame(&nested_bytes, ts_ms, out);
                }
            }
            _ => {}
        }

        offset = end;
    }
}

fn process_non_scene_chat_packet(
    endpoint: &str,
    tcp_packet: &etherparse::TcpSlice<'_>,
    payload: &[u8],
    streams: &mut HashMap<String, NonSceneStreamState>,
    packet_sender: &tokio::sync::mpsc::Sender<CaptureEvent>,
    queue_depth: &AtomicUsize,
    dropped_total: &AtomicUsize,
    #[cfg(debug_assertions)] census_runtime: &mut CaptureCensusRuntime,
    known_server: Option<Server>,
) {
    if !streams.contains_key(endpoint) {
        if streams.len() >= NON_SCENE_STREAM_LIMIT {
            #[cfg(debug_assertions)]
            if capture_census_enabled()
                && census_runtime
                    .stream_limit_logged
                    .insert(endpoint.to_string())
            {
                try_send_capture_event(
                    packet_sender,
                    queue_depth,
                    dropped_total,
                    CaptureEvent::AuxiliaryEntries(vec![enqueue_capture_stream_limit(endpoint)]),
                );
            }
            return;
        }
        streams.insert(endpoint.to_string(), NonSceneStreamState::new());
    }

    let Some(state) = streams.get_mut(endpoint) else {
        return;
    };
    state.last_seen = Instant::now();

    let sequence_number = tcp_packet.sequence_number();
    let mut defer_reset = false;

    if tcp_packet.syn() {
        state
            .tcp_reassembler
            .reset(Some(sequence_number.wrapping_add(1)));
        state.reassembler = Reassembler::new();
        if payload.is_empty() {
            return;
        }
    }

    if tcp_packet.fin() || tcp_packet.rst() {
        defer_reset = true;
    }

    if payload.is_empty() {
        if defer_reset {
            state.tcp_reassembler.reset(None);
            state.reassembler = Reassembler::new();
        }
        return;
    }

    if let Some(expected) = state.tcp_reassembler.next_sequence() {
        if tcp_sequence_before(sequence_number, expected) {
            let backwards = expected.wrapping_sub(sequence_number);
            if backwards > MAX_BACKTRACK_BYTES {
                state.tcp_reassembler.reset(Some(sequence_number));
                state.reassembler = Reassembler::new();
            }
        }
    }

    match state
        .tcp_reassembler
        .insert_segment(sequence_number, payload)
    {
        TcpInsertResult::Contiguous(buffer) => {
            state.reassembler.feed_owned(buffer);
        }
        TcpInsertResult::SkippedGap {
            from,
            to,
            reason,
            data,
        } => {
            debug!(
                target: "app::capture",
                "TCP gap skipped for {endpoint}: from={from} to={to} reason={reason:?}; clearing frame reassembler"
            );
            state.reassembler.take_remaining();
            if !data.is_empty() {
                state.reassembler.feed_owned(data);
            }
        }
        TcpInsertResult::Gap | TcpInsertResult::NoData => {}
    }

    while let Some(packet) = state.reassembler.try_next() {
        let ts_ms = now_ms();
        let mut entries = Vec::new();
        #[cfg(debug_assertions)]
        if capture_census_enabled() {
            collect_capture_census_entries_from_frame(
                &packet,
                endpoint,
                known_server,
                census_runtime,
                &mut entries,
            );
        }
        collect_chat_logger_entries_from_frame(&packet, ts_ms, &mut entries);
        if !entries.is_empty() {
            try_send_capture_event(
                packet_sender,
                queue_depth,
                dropped_total,
                CaptureEvent::AuxiliaryEntries(entries),
            );
        }
    }

    if defer_reset {
        state.tcp_reassembler.reset(None);
        state.reassembler = Reassembler::new();
    }
}

struct NpcapSource {
    capture: NpcapCapture,
}

impl NpcapSource {
    fn new(device: &str) -> Result<Self, String> {
        let capture = NpcapCapture::new(device)?;
        info!(target: "app::capture", "Npcap handle opened device={}", device);
        Ok(Self { capture })
    }

    fn packet_format_for_datalink(&self) -> PacketFormat {
        match self.capture.datalink() {
            DLT_EN10MB => PacketFormat::Ethernet,
            DLT_RAW | DLT_NULL | DLT_LOOP => PacketFormat::RawIp,
            other => {
                log_unsupported_datalink(other);
                PacketFormat::Unsupported
            }
        }
    }

    fn normalize_packet_slice<'a>(&self, data: &'a [u8]) -> Option<&'a [u8]> {
        match self.capture.datalink() {
            DLT_EN10MB | DLT_RAW => Some(data),
            DLT_NULL | DLT_LOOP => {
                if data.len() <= 4 {
                    return None;
                }
                let family = u32::from_ne_bytes([data[0], data[1], data[2], data[3]]);
                match family {
                    2 => Some(&data[4..]), // AF_INET on Windows
                    23 | 24 => None,       // IPv6 families, ignored for now
                    other => {
                        log_unsupported_loopback_family(other, self.capture.datalink());
                        None
                    }
                }
            }
            other => {
                log_unsupported_datalink(other);
                None
            }
        }
    }

    #[allow(dead_code)]
    fn next_packet(&mut self) -> Result<Option<Vec<u8>>, String> {
        match self.capture.next_packet()? {
            Some(data) => Ok(self
                .normalize_packet_slice(&data)
                .map(|slice| slice.to_vec())),
            None => Ok(None),
        }
    }

    fn packet_format(&self) -> PacketFormat {
        self.packet_format_for_datalink()
    }

    fn pump<F: FnMut(PacketFormat, &[u8])>(&mut self, on_packet: &mut F) -> Result<i32, String> {
        let packet_format = self.packet_format();
        self.capture.dispatch_batch(-1, &mut |raw_packet: &[u8]| {
            let Some(packet) = self.normalize_packet_slice(raw_packet) else {
                return;
            };
            on_packet(packet_format, packet);
        })
    }
}

fn log_unsupported_loopback_family(family: u32, datalink: i32) {
    static LOGGED_FAMILY: OnceLock<u32> = OnceLock::new();
    if LOGGED_FAMILY.set(family).is_ok() {
        warn!(
            "Unsupported DLT_NULL/LOOP family {} (datalink {}), dropping packets",
            family, datalink
        );
    }
}

fn log_unsupported_datalink(datalink: i32) {
    static LOGGED_DLT: OnceLock<i32> = OnceLock::new();
    if LOGGED_DLT.set(datalink).is_ok() {
        warn!(
            "Unsupported Npcap datalink type {}, dropping packets",
            datalink
        );
    }
}

pub fn start_capture(
    npcap_device: String,
) -> (tokio::sync::mpsc::Receiver<CaptureEvent>, Arc<AtomicUsize>) {
    let (packet_sender, packet_receiver) =
        tokio::sync::mpsc::channel::<CaptureEvent>(CAPTURE_CHANNEL_CAP);
    let queue_depth = Arc::new(AtomicUsize::new(0));
    let capture_queue_depth = Arc::clone(&queue_depth);
    let dropped_total = Arc::new(AtomicUsize::new(0));
    let capture_dropped_total = Arc::clone(&dropped_total);
    let (restart_sender, mut restart_receiver) = watch::channel(false);
    RESTART_SENDER.set(restart_sender.clone()).ok();

    if npcap_device.trim().is_empty() {
        error!(target: "app::capture", "capture_start_failed method=Npcap err=empty_device");
        return (packet_receiver, queue_depth);
    }

    info!(target: "app::capture", "capture_start method=Npcap device={}", npcap_device);

    // Use std::thread::spawn to avoid blocking the async runtime with pcap recv.
    std::thread::spawn(move || {
        let capture_span = tracing::info_span!(
            target: "app::capture",
            "capture_thread",
            method = "Npcap",
            device = %npcap_device
        );
        let _capture_guard = capture_span.enter();
        loop {
            read_packets(
                &packet_sender,
                &capture_queue_depth,
                &capture_dropped_total,
                &mut restart_receiver,
                &npcap_device,
            );

            // Check if this was a requested restart or a crash/exit
            if !*restart_receiver.borrow() {
                warn!("Packet capture exited unexpectedly. Restarting in 1s...");
                std::thread::sleep(std::time::Duration::from_secs(1));
                continue;
            }

            // Wait for restart signal if it was requested
            while !*restart_receiver.borrow() {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            // Reset signal to false before next loop
            let _ = restart_sender.send(false);
        }
        // info!("oopsies {}", line!());
    });
    (packet_receiver, queue_depth)
}

#[allow(clippy::too_many_lines)]
fn read_packets(
    packet_sender: &tokio::sync::mpsc::Sender<CaptureEvent>,
    queue_depth: &AtomicUsize,
    dropped_total: &AtomicUsize,
    restart_receiver: &mut watch::Receiver<bool>,
    npcap_device: &str,
) {
    let read_span = tracing::info_span!(
        target: "app::capture",
        "capture_read_loop",
        method = "Npcap",
        device = %npcap_device
    );
    let _read_guard = read_span.enter();

    let mut source = match NpcapSource::new(npcap_device) {
        Ok(s) => s,
        Err(e) => {
            error!(
                target: "app::capture",
                "capture_source_init_failed method=Npcap device={} err={}",
                npcap_device,
                e
            );
            return;
        }
    };

    let mut known_servers: HashSet<Server> = HashSet::new();
    let mut scene_streams: HashMap<Server, NonSceneStreamState> = HashMap::new();
    let mut non_scene_streams: HashMap<String, NonSceneStreamState> = HashMap::new();
    let mut game_connections = GameConnectionFilter::new();
    let mut cleanup_last_run = Instant::now();
    #[cfg(debug_assertions)]
    let mut capture_census_runtime = CaptureCensusRuntime::default();

    loop {
        let mut needs_cleanup = false;
        let dispatch_result = source.pump(&mut |packet_format, packet_data| {
            let network_slices = match packet_format {
                PacketFormat::RawIp => SlicedPacket::from_ip(packet_data),
                PacketFormat::Ethernet => SlicedPacket::from_ethernet(packet_data),
                PacketFormat::Unsupported => return,
            };
            let Ok(network_slices) = network_slices else {
                return;
            };
            let Some(Ipv4(ip_packet)) = network_slices.net else {
                return;
            };
            let Some(Tcp(tcp_packet)) = network_slices.transport else {
                return;
            };
            let curr_server = Server::new(
                ip_packet.header().source(),
                tcp_packet.to_header().source_port,
                ip_packet.header().destination(),
                tcp_packet.to_header().destination_port,
            );

            let session_known = known_servers.contains(&curr_server);
            let process_verdict = game_connections.classify(curr_server);
            if !session_known
                && !matches!(process_verdict, Verdict::Game)
                && game_connections.has_known_game_endpoint()
            {
                return;
            }

            if session_known {
                let stream = scene_streams
                    .entry(curr_server)
                    .or_insert_with(NonSceneStreamState::new);
                stream.last_seen = Instant::now();
                process_scene_stream_packet(
                    curr_server,
                    &tcp_packet,
                    stream,
                    packet_sender,
                    queue_depth,
                    dropped_total,
                    &mut game_connections,
                    #[cfg(debug_assertions)]
                    &mut capture_census_runtime,
                );
                if cleanup_last_run.elapsed() >= Duration::from_secs(30) {
                    needs_cleanup = true;
                }
                return;
            }

            let tcp_payload = tcp_packet.payload();
            // 1. Try to identify game server via small packets.
            if tcp_payload.len() >= 10 && tcp_payload[4] == 0 {
                const FRAG_LENGTH_SIZE: usize = 4;
                const SIGNATURE: [u8; 6] = [0x00, 0x63, 0x33, 0x53, 0x42, 0x00];
                const MAX_FRAG_ITERATIONS: usize = 2000; // Circuit breaker

                let mut i = 0usize;
                let mut offset = 10usize;
                while tcp_payload.len().saturating_sub(offset) >= FRAG_LENGTH_SIZE {
                    i += 1;
                    if i >= MAX_FRAG_ITERATIONS {
                        error!(
                            "TCP fragment processing stuck after {i} iterations - forcing recovery. \
                            remaining={}, line={}",
                            tcp_payload.len().saturating_sub(offset),
                            line!()
                        );
                        break;
                    }
                    if i % 1000 == 0 {
                        warn!(
                            "High iteration count in fragment processing: iteration={i}, remaining={}, line={}",
                            tcp_payload.len().saturating_sub(offset),
                            line!()
                        );
                    }

                    let len_bytes = &tcp_payload[offset..offset + FRAG_LENGTH_SIZE];
                    let tcp_frag_payload_len =
                        u32::from_be_bytes([len_bytes[0], len_bytes[1], len_bytes[2], len_bytes[3]])
                            .saturating_sub(FRAG_LENGTH_SIZE as u32) as usize;
                    offset += FRAG_LENGTH_SIZE;

                    if tcp_payload.len().saturating_sub(offset) < tcp_frag_payload_len {
                        break;
                    }

                    let tcp_frag = &tcp_payload[offset..offset + tcp_frag_payload_len];
                    offset += tcp_frag_payload_len;

                    if tcp_frag.len() >= 5 + SIGNATURE.len()
                        && tcp_frag[5..5 + SIGNATURE.len()] == SIGNATURE
                    {
                        register_scene_stream(
                            &mut known_servers,
                            &mut scene_streams,
                            curr_server,
                            &tcp_packet,
                            tcp_payload.len(),
                            "address-change-signature",
                        );
                        break;
                    }
                }
            }
            // 2. Payload length is 98 = Login packets?
            if tcp_payload.len() == 98 {
                const SIGNATURE_1: [u8; 10] =
                    [0x00, 0x00, 0x00, 0x62, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01];
                const SIGNATURE_2: [u8; 6] = [0x00, 0x00, 0x00, 0x00, 0x0a, 0x4e];
                if tcp_payload.len() >= 20
                    && tcp_payload[0..10] == SIGNATURE_1
                    && tcp_payload[14..20] == SIGNATURE_2
                {
                    register_scene_stream(
                        &mut known_servers,
                        &mut scene_streams,
                        curr_server,
                        &tcp_packet,
                        tcp_payload.len(),
                        "login-return-signature",
                    );
                }
            }
            if !known_servers.is_empty() {
                process_non_scene_chat_packet(
                    &curr_server.to_string(),
                    &tcp_packet,
                    tcp_payload,
                    &mut non_scene_streams,
                    packet_sender,
                    queue_depth,
                    dropped_total,
                    #[cfg(debug_assertions)]
                    &mut capture_census_runtime,
                    known_servers.iter().next().copied(),
                );
            }
            if cleanup_last_run.elapsed() >= Duration::from_secs(30) {
                needs_cleanup = true;
            }
        });

        match dispatch_result {
            Ok(0) => {
                std::thread::sleep(Duration::from_millis(1));
            }
            Ok(_) => {}
            Err(e) => {
                error!(target: "app::capture", "capture_error err={}", e);
                break;
            }
        }

        if needs_cleanup {
            cleanup_last_run = Instant::now();
            let before_scene = scene_streams.len();
            scene_streams.retain(|server, stream| {
                let keep = stream.last_seen.elapsed() < SESSION_IDLE_TIMEOUT;
                if !keep {
                    known_servers.remove(server);
                    game_connections.forget_flow(*server);
                }
                keep
            });
            let removed_scene = before_scene.saturating_sub(scene_streams.len());

            let before_non_scene = non_scene_streams.len();
            non_scene_streams.retain(|_, stream| stream.last_seen.elapsed() < SESSION_IDLE_TIMEOUT);
            let removed_non_scene = before_non_scene.saturating_sub(non_scene_streams.len());

            if removed_scene > 0 || removed_non_scene > 0 {
                info!(
                    target: "app::capture",
                    "Removed idle TCP streams scene={} non_scene={}",
                    removed_scene,
                    removed_non_scene
                );
            }
        }

        if *restart_receiver.borrow() {
            break;
        }
    } // todo: if it errors, it breaks out of the loop but will it ever error?
    // info!("{}", line!());
}

fn register_scene_stream(
    known_servers: &mut HashSet<Server>,
    scene_streams: &mut HashMap<Server, NonSceneStreamState>,
    curr_server: Server,
    tcp_packet: &etherparse::TcpSlice<'_>,
    payload_len: usize,
    reason: &str,
) {
    if !known_servers.insert(curr_server) {
        return;
    }

    info!(
        target: "app::capture",
        "Registered scene TCP stream ({reason}): {curr_server}"
    );
    let payload_len = u32::try_from(payload_len).unwrap_or(u32::MAX);
    let seq_end = tcp_packet.sequence_number().wrapping_add(payload_len);
    let stream = scene_streams
        .entry(curr_server)
        .or_insert_with(NonSceneStreamState::new);
    reset_stream(
        &mut stream.tcp_reassembler,
        &mut stream.reassembler,
        Some(seq_end),
    );
}

fn process_scene_stream_packet(
    curr_server: Server,
    tcp_packet: &etherparse::TcpSlice<'_>,
    stream: &mut NonSceneStreamState,
    packet_sender: &tokio::sync::mpsc::Sender<CaptureEvent>,
    queue_depth: &AtomicUsize,
    dropped_total: &AtomicUsize,
    game_connections: &mut GameConnectionFilter,
    #[cfg(debug_assertions)] capture_census_runtime: &mut CaptureCensusRuntime,
) {
    let sequence_number = tcp_packet.sequence_number();
    let payload = tcp_packet.payload();
    let payload_len = payload.len();

    if tcp_packet.syn() {
        info!(
            target: "app::capture",
            "SYN observed for {curr_server}; resetting TCP reassembler state"
        );
        reset_stream(
            &mut stream.tcp_reassembler,
            &mut stream.reassembler,
            Some(sequence_number.wrapping_add(1)),
        );
        if payload_len == 0 {
            return;
        }
    }

    let mut defer_reset = false;
    if tcp_packet.fin() || tcp_packet.rst() {
        defer_reset = true;
        game_connections.forget_flow(curr_server);
    }

    if payload_len == 0 {
        if defer_reset {
            reset_stream(&mut stream.tcp_reassembler, &mut stream.reassembler, None);
        }
        return;
    }

    if let Some(expected) = stream.tcp_reassembler.next_sequence() {
        if tcp_sequence_before(sequence_number, expected) {
            let backwards = expected.wrapping_sub(sequence_number);
            if backwards > MAX_BACKTRACK_BYTES {
                warn!(
                    target: "app::capture",
                    "Sequence regression detected for {curr_server}: expected {expected}, \
                    got {sequence_number} (backwards {backwards} bytes). Resetting stream"
                );
                reset_stream(
                    &mut stream.tcp_reassembler,
                    &mut stream.reassembler,
                    Some(sequence_number),
                );
            }
        }
    }

    match stream
        .tcp_reassembler
        .insert_segment(sequence_number, payload)
    {
        TcpInsertResult::Contiguous(buffer) => {
            stream.reassembler.feed_owned(buffer);
        }
        TcpInsertResult::SkippedGap {
            from,
            to,
            reason,
            data,
        } => {
            debug!(
                target: "app::capture",
                "TCP gap skipped for {curr_server}: from={from} to={to} reason={reason:?}; clearing frame reassembler"
            );
            stream.reassembler.take_remaining();
            if !data.is_empty() {
                stream.reassembler.feed_owned(data);
            }
        }
        TcpInsertResult::Gap | TcpInsertResult::NoData => {}
    }

    while let Some(packet) = stream.reassembler.try_next() {
        #[cfg(debug_assertions)]
        if capture_census_enabled() {
            let mut entries = Vec::new();
            collect_capture_census_entries_from_frame(
                &packet,
                &curr_server.to_string(),
                Some(curr_server),
                capture_census_runtime,
                &mut entries,
            );
            if !entries.is_empty() {
                try_send_capture_event(
                    packet_sender,
                    queue_depth,
                    dropped_total,
                    CaptureEvent::AuxiliaryEntries(entries),
                );
            }
        }
        process_packet(&packet, packet_sender, queue_depth, dropped_total);
    }

    if defer_reset {
        reset_stream(&mut stream.tcp_reassembler, &mut stream.reassembler, None);
    }
}

// Function to send restart signal from another thread/task
#[allow(dead_code)]
pub fn request_restart() {
    if let Some(sender) = RESTART_SENDER.get() {
        let _ = sender.send(true);
    }
}

fn reset_stream(
    tcp_reassembler: &mut TCPReassembler,
    reassembler: &mut Reassembler,
    next_seq: Option<u32>,
) {
    reassembler.take_remaining();
    tcp_reassembler.reset(next_seq);
}
