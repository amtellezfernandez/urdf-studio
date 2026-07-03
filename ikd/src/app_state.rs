use chrono::{DateTime, Utc};

use crate::approach::ApproachHub;
use crate::config::IkdConfig;
use crate::control::ControlHub;
use crate::world_bridge::WorldBridgeHub;

#[derive(Clone)]
pub struct AppState {
    pub config: IkdConfig,
    pub build_sha: String,
    pub started_at: DateTime<Utc>,
    pub control: ControlHub,
    pub approach: ApproachHub,
    pub world_bridge: WorldBridgeHub,
}
