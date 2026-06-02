use std::time::Duration;

pub const TELEOP_HTTP_DEFAULT_BIND: &str = "127.0.0.1:8091";
pub const TELEOP_WEBTRANSPORT_DEFAULT_BIND: &str = "127.0.0.1:8092";
pub const TELEOP_NATIVE_QUIC_DEFAULT_BIND: &str = "127.0.0.1:8093";
pub const TELEOP_WEBTRANSPORT_DEFAULT_PATH: &str = "/teleop";
pub const TELEOP_WEBTRANSPORT_SELF_SIGNED_SAN_LOCALHOST: &str = "localhost";
pub const TELEOP_WEBTRANSPORT_SELF_SIGNED_SAN_IPV4_LOOPBACK: &str = "127.0.0.1";
pub const TELEOP_WEBTRANSPORT_SELF_SIGNED_SAN_IPV6_LOOPBACK: &str = "::1";
pub const TELEOP_NATIVE_QUIC_ALPN: &[u8] = b"urdf-teleop-quic-v1";
pub const TELEOP_MAX_DATAGRAM_BYTES: usize = 64 * 1024;
pub const TELEOP_KEEP_ALIVE_INTERVAL_MS: u64 = 1_000;
pub const TELEOP_MAX_SESSION_ID_CHARS: usize = 128;
pub const TELEOP_MAX_PEER_ID_CHARS: usize = 128;
pub const TELEOP_MAX_COMMAND_KIND_CHARS: usize = 64;
pub const TELEOP_INITIAL_SERVER_SEQUENCE: u64 = 0;
pub const TELEOP_SEQUENCE_INCREMENT: u64 = 1;
pub const TELEOP_INITIAL_PACKET_COUNT: u64 = 0;
pub const TELEOP_ALLOWED_INSECURE_NATIVE_QUIC_ENV_VALUE: &str = "1";
pub const TELEOP_UNIX_MILLIS_PER_SECOND: u64 = 1_000;

pub fn keep_alive_interval() -> Duration {
    Duration::from_millis(TELEOP_KEEP_ALIVE_INTERVAL_MS)
}
