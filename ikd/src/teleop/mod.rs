pub mod params;

use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::teleop::params::{
    TELEOP_ALLOWED_INSECURE_NATIVE_QUIC_ENV_VALUE, TELEOP_HTTP_DEFAULT_BIND,
    TELEOP_INITIAL_PACKET_COUNT, TELEOP_INITIAL_SERVER_SEQUENCE, TELEOP_MAX_COMMAND_KIND_CHARS,
    TELEOP_MAX_DATAGRAM_BYTES, TELEOP_MAX_PEER_ID_CHARS, TELEOP_MAX_SESSION_ID_CHARS,
    TELEOP_NATIVE_QUIC_DEFAULT_BIND, TELEOP_SEQUENCE_INCREMENT, TELEOP_UNIX_MILLIS_PER_SECOND,
    TELEOP_WEBTRANSPORT_DEFAULT_BIND, TELEOP_WEBTRANSPORT_DEFAULT_PATH,
};

#[derive(Debug, Clone)]
pub struct TeleopSidecarConfig {
    pub http_bind: SocketAddr,
    pub webtransport_bind: SocketAddr,
    pub native_quic_bind: SocketAddr,
    pub webtransport_path: String,
    pub enable_webtransport: bool,
    pub enable_native_quic: bool,
    pub allow_insecure_native_quic: bool,
    pub cert_pem: Option<PathBuf>,
    pub key_pem: Option<PathBuf>,
    pub native_client_ca_pem: Option<PathBuf>,
}

impl TeleopSidecarConfig {
    pub fn from_env() -> Result<Self, String> {
        let cert_pem = read_path("TELEOP_SIDECAR_CERT_PEM");
        let key_pem = read_path("TELEOP_SIDECAR_KEY_PEM");
        let native_client_ca_pem = read_path("TELEOP_SIDECAR_NATIVE_CLIENT_CA_PEM");
        let allow_insecure_native_quic = env::var("TELEOP_SIDECAR_ALLOW_INSECURE_NATIVE_QUIC")
            .ok()
            .is_some_and(|value| value.trim() == TELEOP_ALLOWED_INSECURE_NATIVE_QUIC_ENV_VALUE);

        Ok(Self {
            http_bind: read_socket_addr("TELEOP_SIDECAR_HTTP_BIND", TELEOP_HTTP_DEFAULT_BIND)?,
            webtransport_bind: read_socket_addr(
                "TELEOP_SIDECAR_WEBTRANSPORT_BIND",
                TELEOP_WEBTRANSPORT_DEFAULT_BIND,
            )?,
            native_quic_bind: read_socket_addr(
                "TELEOP_SIDECAR_NATIVE_QUIC_BIND",
                TELEOP_NATIVE_QUIC_DEFAULT_BIND,
            )?,
            webtransport_path: env::var("TELEOP_SIDECAR_WEBTRANSPORT_PATH")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| TELEOP_WEBTRANSPORT_DEFAULT_PATH.to_string()),
            enable_webtransport: read_bool("TELEOP_SIDECAR_ENABLE_WEBTRANSPORT", true),
            enable_native_quic: read_bool(
                "TELEOP_SIDECAR_ENABLE_NATIVE_QUIC",
                cert_pem.is_some() && key_pem.is_some() && native_client_ca_pem.is_some(),
            ),
            allow_insecure_native_quic,
            cert_pem,
            key_pem,
            native_client_ca_pem,
        })
    }

    pub fn certificate_mode(&self) -> CertificateMode {
        if self.cert_pem.is_some() && self.key_pem.is_some() {
            CertificateMode::ConfiguredPem
        } else {
            CertificateMode::SelfSignedDevelopment
        }
    }

    pub fn native_quic_security_mode(&self) -> NativeQuicSecurityMode {
        if self.native_client_ca_pem.is_some() {
            NativeQuicSecurityMode::MutualTls
        } else if self.allow_insecure_native_quic {
            NativeQuicSecurityMode::NoClientAuthDevelopment
        } else {
            NativeQuicSecurityMode::DisabledMissingClientCa
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CertificateMode {
    ConfiguredPem,
    SelfSignedDevelopment,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeQuicSecurityMode {
    MutualTls,
    NoClientAuthDevelopment,
    DisabledMissingClientCa,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TeleopPeerRole {
    Operator,
    Robot,
    Observer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TeleopControlPacket {
    pub session_id: String,
    pub peer_id: String,
    pub role: TeleopPeerRole,
    pub sequence: u64,
    pub monotonic_timestamp_ns: u64,
    pub command_kind: String,
    pub ack_requested: bool,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TeleopAckReason {
    Accepted,
    InvalidSession,
    InvalidPeer,
    InvalidCommandKind,
    MalformedPacket,
    ReplayRejected,
    PayloadTooLarge,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TeleopControlAck {
    pub session_id: String,
    pub peer_id: String,
    pub sequence: u64,
    pub server_sequence: u64,
    pub accepted: bool,
    pub reason: TeleopAckReason,
    pub server_received_unix_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TeleopStatsSnapshot {
    pub accepted_packets: u64,
    pub rejected_packets: u64,
    pub replay_rejected_packets: u64,
    pub webtransport_packets: u64,
    pub native_quic_packets: u64,
    pub last_reason: Option<TeleopAckReason>,
    pub last_session_id: Option<String>,
    pub last_peer_id: Option<String>,
    pub last_sequence: Option<u64>,
    pub last_server_sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeleopTransport {
    NativeQuic,
    WebTransport,
}

#[derive(Debug, Default)]
struct TeleopHubState {
    last_sequence_by_peer: HashMap<String, u64>,
    accepted_packets: u64,
    rejected_packets: u64,
    replay_rejected_packets: u64,
    webtransport_packets: u64,
    native_quic_packets: u64,
    last_reason: Option<TeleopAckReason>,
    last_session_id: Option<String>,
    last_peer_id: Option<String>,
    last_sequence: Option<u64>,
    last_server_sequence: u64,
}

#[derive(Debug, Clone, Default)]
pub struct TeleopHub {
    state: Arc<Mutex<TeleopHubState>>,
}

impl TeleopHub {
    pub fn new() -> Self {
        let state = TeleopHubState {
            last_server_sequence: TELEOP_INITIAL_SERVER_SEQUENCE,
            ..TeleopHubState::default()
        };
        Self {
            state: Arc::new(Mutex::new(state)),
        }
    }

    pub async fn record_packet(
        &self,
        transport: TeleopTransport,
        packet: TeleopControlPacket,
        encoded_len: usize,
    ) -> TeleopControlAck {
        let reason = validate_packet(&packet, encoded_len);
        let mut state = self.state.lock().await;

        match transport {
            TeleopTransport::NativeQuic => {
                state.native_quic_packets = state
                    .native_quic_packets
                    .saturating_add(TELEOP_SEQUENCE_INCREMENT);
            }
            TeleopTransport::WebTransport => {
                state.webtransport_packets = state
                    .webtransport_packets
                    .saturating_add(TELEOP_SEQUENCE_INCREMENT);
            }
        }

        let reason = if reason == TeleopAckReason::Accepted {
            let peer_key = peer_sequence_key(&packet);
            let last_sequence = state.last_sequence_by_peer.get(&peer_key).copied();
            if last_sequence.is_some_and(|sequence| packet.sequence <= sequence) {
                TeleopAckReason::ReplayRejected
            } else {
                state
                    .last_sequence_by_peer
                    .insert(peer_key, packet.sequence);
                TeleopAckReason::Accepted
            }
        } else {
            reason
        };

        state.last_server_sequence = state
            .last_server_sequence
            .saturating_add(TELEOP_SEQUENCE_INCREMENT);
        if reason == TeleopAckReason::Accepted {
            state.accepted_packets = state
                .accepted_packets
                .saturating_add(TELEOP_SEQUENCE_INCREMENT);
        } else {
            state.rejected_packets = state
                .rejected_packets
                .saturating_add(TELEOP_SEQUENCE_INCREMENT);
            if reason == TeleopAckReason::ReplayRejected {
                state.replay_rejected_packets = state
                    .replay_rejected_packets
                    .saturating_add(TELEOP_SEQUENCE_INCREMENT);
            }
        }
        state.last_reason = Some(reason.clone());
        state.last_session_id = Some(packet.session_id.clone());
        state.last_peer_id = Some(packet.peer_id.clone());
        state.last_sequence = Some(packet.sequence);

        TeleopControlAck {
            session_id: packet.session_id,
            peer_id: packet.peer_id,
            sequence: packet.sequence,
            server_sequence: state.last_server_sequence,
            accepted: reason == TeleopAckReason::Accepted,
            reason,
            server_received_unix_ms: unix_now_ms(),
        }
    }

    pub async fn record_rejected_control(
        &self,
        transport: TeleopTransport,
        reason: TeleopAckReason,
    ) -> TeleopControlAck {
        let mut state = self.state.lock().await;
        match transport {
            TeleopTransport::NativeQuic => {
                state.native_quic_packets = state
                    .native_quic_packets
                    .saturating_add(TELEOP_SEQUENCE_INCREMENT);
            }
            TeleopTransport::WebTransport => {
                state.webtransport_packets = state
                    .webtransport_packets
                    .saturating_add(TELEOP_SEQUENCE_INCREMENT);
            }
        }
        state.rejected_packets = state
            .rejected_packets
            .saturating_add(TELEOP_SEQUENCE_INCREMENT);
        state.last_server_sequence = state
            .last_server_sequence
            .saturating_add(TELEOP_SEQUENCE_INCREMENT);
        state.last_reason = Some(reason.clone());

        TeleopControlAck {
            session_id: String::new(),
            peer_id: String::new(),
            sequence: TELEOP_INITIAL_PACKET_COUNT,
            server_sequence: state.last_server_sequence,
            accepted: false,
            reason,
            server_received_unix_ms: unix_now_ms(),
        }
    }

    pub async fn stats(&self) -> TeleopStatsSnapshot {
        let state = self.state.lock().await;
        TeleopStatsSnapshot {
            accepted_packets: state.accepted_packets,
            rejected_packets: state.rejected_packets,
            replay_rejected_packets: state.replay_rejected_packets,
            webtransport_packets: state.webtransport_packets,
            native_quic_packets: state.native_quic_packets,
            last_reason: state.last_reason.clone(),
            last_session_id: state.last_session_id.clone(),
            last_peer_id: state.last_peer_id.clone(),
            last_sequence: state.last_sequence,
            last_server_sequence: state.last_server_sequence,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TeleopManifest {
    pub webtransport_url: String,
    pub webtransport_path: String,
    pub native_quic_addr: String,
    pub native_quic_alpn: String,
    pub enable_webtransport: bool,
    pub enable_native_quic: bool,
    pub certificate_mode: CertificateMode,
    pub native_quic_security_mode: NativeQuicSecurityMode,
}

impl TeleopManifest {
    pub fn from_config(config: &TeleopSidecarConfig) -> Self {
        Self {
            webtransport_url: format!(
                "https://{}{}",
                config.webtransport_bind, config.webtransport_path
            ),
            webtransport_path: config.webtransport_path.clone(),
            native_quic_addr: config.native_quic_bind.to_string(),
            native_quic_alpn: String::from_utf8_lossy(
                crate::teleop::params::TELEOP_NATIVE_QUIC_ALPN,
            )
            .to_string(),
            enable_webtransport: config.enable_webtransport,
            enable_native_quic: config.enable_native_quic,
            certificate_mode: config.certificate_mode(),
            native_quic_security_mode: config.native_quic_security_mode(),
        }
    }
}

pub fn decode_control_packet(bytes: &[u8]) -> Result<TeleopControlPacket, serde_json::Error> {
    serde_json::from_slice(bytes)
}

pub fn encode_control_ack(ack: &TeleopControlAck) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(ack)
}

fn validate_packet(packet: &TeleopControlPacket, encoded_len: usize) -> TeleopAckReason {
    if encoded_len > TELEOP_MAX_DATAGRAM_BYTES {
        return TeleopAckReason::PayloadTooLarge;
    }
    if packet.session_id.trim().is_empty() || packet.session_id.len() > TELEOP_MAX_SESSION_ID_CHARS
    {
        return TeleopAckReason::InvalidSession;
    }
    if packet.peer_id.trim().is_empty() || packet.peer_id.len() > TELEOP_MAX_PEER_ID_CHARS {
        return TeleopAckReason::InvalidPeer;
    }
    if packet.command_kind.trim().is_empty()
        || packet.command_kind.len() > TELEOP_MAX_COMMAND_KIND_CHARS
    {
        return TeleopAckReason::InvalidCommandKind;
    }
    TeleopAckReason::Accepted
}

fn peer_sequence_key(packet: &TeleopControlPacket) -> String {
    format!(
        "{}::{:?}::{}",
        packet.session_id, packet.role, packet.peer_id
    )
}

fn read_bool(key: &str, fallback: bool) -> bool {
    env::var(key)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(fallback)
}

fn read_path(key: &str) -> Option<PathBuf> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn read_socket_addr(key: &str, fallback: &str) -> Result<SocketAddr, String> {
    let raw_value = env::var(key).unwrap_or_else(|_| fallback.to_string());
    raw_value
        .parse::<SocketAddr>()
        .map_err(|error| format!("{key} must be a socket address: {error}"))
}

fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| {
            duration
                .as_secs()
                .saturating_mul(TELEOP_UNIX_MILLIS_PER_SECOND)
                .saturating_add(u64::from(duration.subsec_millis()))
        })
        .unwrap_or(TELEOP_INITIAL_PACKET_COUNT)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SESSION_ID: &str = "session-a";
    const TEST_PEER_ID: &str = "operator-a";
    const TEST_COMMAND_KIND: &str = "twist";
    const TEST_SEQUENCE: u64 = 7;
    const TEST_TIMESTAMP_NS: u64 = 123_456;
    const TEST_ENCODED_LEN: usize = 128;

    fn packet(sequence: u64) -> TeleopControlPacket {
        TeleopControlPacket {
            session_id: TEST_SESSION_ID.to_string(),
            peer_id: TEST_PEER_ID.to_string(),
            role: TeleopPeerRole::Operator,
            sequence,
            monotonic_timestamp_ns: TEST_TIMESTAMP_NS,
            command_kind: TEST_COMMAND_KIND.to_string(),
            ack_requested: true,
            payload: serde_json::json!({ "x": 0.1 }),
        }
    }

    #[tokio::test]
    async fn hub_rejects_replayed_sequences_per_peer() {
        let hub = TeleopHub::new();

        let first = hub
            .record_packet(
                TeleopTransport::WebTransport,
                packet(TEST_SEQUENCE),
                TEST_ENCODED_LEN,
            )
            .await;
        assert_eq!(first.reason, TeleopAckReason::Accepted);

        let replay = hub
            .record_packet(
                TeleopTransport::WebTransport,
                packet(TEST_SEQUENCE),
                TEST_ENCODED_LEN,
            )
            .await;
        assert_eq!(replay.reason, TeleopAckReason::ReplayRejected);

        let stats = hub.stats().await;
        assert_eq!(stats.accepted_packets, 1);
        assert_eq!(stats.replay_rejected_packets, 1);
    }

    #[test]
    fn invalid_packet_shape_is_rejected_before_sequence_tracking() {
        let mut invalid = packet(TEST_SEQUENCE);
        invalid.session_id.clear();

        assert_eq!(
            validate_packet(&invalid, TEST_ENCODED_LEN),
            TeleopAckReason::InvalidSession
        );
    }
}
