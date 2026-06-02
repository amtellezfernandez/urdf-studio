use std::env;

#[derive(Debug, Clone, PartialEq)]
pub struct IkdConfig {
    pub host: String,
    pub port: u16,
    pub ws_path: String,
    pub telemetry_hz: u16,
    pub control_hz: u16,
    pub stale_target_ms: u64,
    pub cors_origin: Option<String>,
}

impl Default for IkdConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 8088,
            ws_path: "/telemetry".to_string(),
            telemetry_hz: 60,
            control_hz: 500,
            stale_target_ms: 250,
            cors_origin: None,
        }
    }
}

impl IkdConfig {
    pub fn from_env() -> Self {
        let defaults = Self::default();

        Self {
            host: env::var("IKD_HOST").unwrap_or(defaults.host),
            port: read_u16("IKD_PORT", defaults.port),
            ws_path: env::var("IKD_WS_PATH").unwrap_or(defaults.ws_path),
            telemetry_hz: read_u16("IKD_TELEMETRY_HZ", defaults.telemetry_hz),
            control_hz: read_u16("IKD_CONTROL_HZ", defaults.control_hz),
            stale_target_ms: read_u64("IKD_STALE_TARGET_MS", defaults.stale_target_ms),
            cors_origin: env::var("IKD_CORS_ORIGIN").ok().filter(|v| !v.is_empty()),
        }
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

fn read_u16(key: &str, fallback: u16) -> u16 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(fallback)
}

fn read_u64(key: &str, fallback: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_bind_addr_is_valid() {
        let cfg = IkdConfig::default();
        assert_eq!(cfg.bind_addr(), "127.0.0.1:8088");
    }
}
