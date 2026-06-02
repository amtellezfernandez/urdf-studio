use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION_V1: &str = "1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TargetMode {
    Pose,
    Position,
    Joint,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrientationPolicy {
    Required,
    Optional,
    Prefer,
    Ignore,
    PositionFirst,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetRequest {
    pub schema_version: String,
    pub sequence: u64,
    pub source_ts_ns: u64,
    pub mode: TargetMode,
    pub target_link: String,
    pub position_xyz_m: Option<[f64; 3]>,
    pub orientation_wxyz: Option<[f64; 4]>,
    pub joint_targets_rad: Option<BTreeMap<String, f64>>,
    pub orientation_policy: OrientationPolicy,
    pub max_linear_speed_mps: Option<f64>,
    pub max_angular_speed_rps: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelLoadRequest {
    pub schema_version: String,
    pub urdf_xml: String,
    pub target_link: String,
    pub seed_joint_values_rad: Option<BTreeMap<String, f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelLoadAck {
    pub schema_version: String,
    pub loaded: bool,
    pub target_link: String,
    pub actuated_joint_names: Vec<String>,
    pub initial_ee_position_xyz_m: [f64; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetAck {
    pub schema_version: String,
    pub accepted: bool,
    pub sequence: u64,
    pub server_rx_ts_ns: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub schema_version: String,
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryFrame {
    pub schema_version: String,
    pub tick_ts_ns: u64,
    pub sequence_applied: Option<u64>,
    pub q_rad: BTreeMap<String, f64>,
    pub ee_position_xyz_m: [f64; 3],
    pub ee_orientation_wxyz: [f64; 4],
    pub residual_position_m: f64,
    pub residual_orientation_rad: f64,
    pub loop_hz: f64,
    pub overrun: bool,
    pub stale_target: bool,
    pub limit_clamp_count: u32,
}

impl Default for TelemetryFrame {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            tick_ts_ns: 0,
            sequence_applied: None,
            q_rad: BTreeMap::new(),
            ee_position_xyz_m: [0.0, 0.0, 0.0],
            ee_orientation_wxyz: [1.0, 0.0, 0.0, 0.0],
            residual_position_m: 0.0,
            residual_orientation_rad: 0.0,
            loop_hz: 0.0,
            overrun: false,
            stale_target: true,
            limit_clamp_count: 0,
        }
    }
}
