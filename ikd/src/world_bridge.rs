use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;
use tokio::sync::broadcast;

pub const WORLD_BRIDGE_SCHEMA_VERSION_V1: &str = "1";

const WORLD_BRIDGE_SERVICE: &str = "worldd-world-bridge";
const WORLD_BRIDGE_RUNTIME_MODE: &str = "rust-data-plane";
const SESSION_ID_PREFIX: &str = "wbs";
const EVENT_ID_PREFIX: &str = "evt";
const SESSION_COUNTER_START: u64 = 1;
const EVENT_COUNTER_START: u64 = 0;
const COMMAND_SEQUENCE_START: u64 = 1;
const COMMAND_SEQUENCE_STEP: u64 = 1;
const MAX_CAMERAS_PER_SESSION: usize = 32;
const MAX_JOINTS_PER_COMMAND: usize = 256;
const MAX_EVENTS_PER_SESSION: usize = 512;
const MIN_SCENARIO_DURATION_MS: u64 = 1_000;
const DEFAULT_SCENARIO_DURATION_MS: u64 = 12_000;
const MAX_SCENARIO_DURATION_MS: u64 = 600_000;
const EVENT_CHANNEL_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorldBridgeEventType {
    SessionCreated,
    JointCommandApplied,
    ScenarioTimeUpdated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBridgeEvent {
    pub schema_version: String,
    pub event_id: String,
    pub session_id: String,
    pub event_type: WorldBridgeEventType,
    pub timestamp_ns: u64,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBridgeStatusResponse {
    pub schema_version: String,
    pub service: String,
    pub runtime_mode: String,
    pub active_sessions: usize,
    pub max_events_per_session: usize,
    pub default_scenario_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBridgeSessionCreateRequest {
    pub schema_version: String,
    pub robot_name: String,
    pub urdf_sha256: Option<String>,
    pub camera_ids: Vec<String>,
    pub scenario_duration_ms: u64,
}

impl Default for WorldBridgeSessionCreateRequest {
    fn default() -> Self {
        Self {
            schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
            robot_name: String::new(),
            urdf_sha256: None,
            camera_ids: Vec::new(),
            scenario_duration_ms: DEFAULT_SCENARIO_DURATION_MS,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBridgeSessionSnapshot {
    pub schema_version: String,
    pub session_id: String,
    pub robot_name: String,
    pub urdf_sha256: Option<String>,
    pub camera_ids: Vec<String>,
    pub created_at_ns: u64,
    pub updated_at_ns: u64,
    pub scenario_duration_ms: u64,
    pub scenario_time_ms: u64,
    pub joint_state_rad: BTreeMap<String, f64>,
    pub last_command_sequence: u64,
    pub recent_events: Vec<WorldBridgeEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBridgeJointCommandRequest {
    pub schema_version: String,
    pub joint_positions_rad: BTreeMap<String, f64>,
    pub source: String,
    pub sequence_id: Option<u64>,
    pub command_time_ms: Option<u64>,
}

impl Default for WorldBridgeJointCommandRequest {
    fn default() -> Self {
        Self {
            schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
            joint_positions_rad: BTreeMap::new(),
            source: "urdf-studio".to_string(),
            sequence_id: None,
            command_time_ms: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBridgeScenarioTimeUpdateRequest {
    pub schema_version: String,
    pub scenario_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBridgeCommandAck {
    pub schema_version: String,
    pub session_id: String,
    pub accepted: bool,
    pub applied_joint_count: usize,
    pub scenario_time_ms: u64,
    pub command_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBridgeErrorResponse {
    pub schema_version: String,
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Error)]
pub enum WorldBridgeError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("invalid schema_version")]
    InvalidSchemaVersion,
    #[error("unknown session: {0}")]
    UnknownSession(String),
}

#[derive(Debug, Clone)]
struct WorldBridgeSessionState {
    session_id: String,
    robot_name: String,
    urdf_sha256: Option<String>,
    camera_ids: Vec<String>,
    scenario_duration_ms: u64,
    created_at_ns: u64,
    updated_at_ns: u64,
    scenario_time_ms: u64,
    last_command_sequence: u64,
    event_counter: u64,
    joint_state_rad: BTreeMap<String, f64>,
    recent_events: VecDeque<WorldBridgeEvent>,
}

#[derive(Clone)]
pub struct WorldBridgeHub {
    sessions: Arc<RwLock<BTreeMap<String, WorldBridgeSessionState>>>,
    session_counter: Arc<AtomicU64>,
    events_tx: broadcast::Sender<WorldBridgeEvent>,
}

impl WorldBridgeHub {
    pub fn new() -> Self {
        let (events_tx, _rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            sessions: Arc::new(RwLock::new(BTreeMap::new())),
            session_counter: Arc::new(AtomicU64::new(SESSION_COUNTER_START)),
            events_tx,
        }
    }

    pub fn status(&self) -> WorldBridgeStatusResponse {
        let sessions = self.sessions.read().expect("sessions lock poisoned");
        WorldBridgeStatusResponse {
            schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
            service: WORLD_BRIDGE_SERVICE.to_string(),
            runtime_mode: WORLD_BRIDGE_RUNTIME_MODE.to_string(),
            active_sessions: sessions.len(),
            max_events_per_session: MAX_EVENTS_PER_SESSION,
            default_scenario_duration_ms: DEFAULT_SCENARIO_DURATION_MS,
        }
    }

    pub fn list_sessions(&self) -> Vec<WorldBridgeSessionSnapshot> {
        let sessions = self.sessions.read().expect("sessions lock poisoned");
        sessions.values().map(Self::session_to_snapshot).collect()
    }

    pub fn get_session(
        &self,
        session_id: &str,
    ) -> Result<WorldBridgeSessionSnapshot, WorldBridgeError> {
        let sessions = self.sessions.read().expect("sessions lock poisoned");
        let Some(session) = sessions.get(session_id) else {
            return Err(WorldBridgeError::UnknownSession(session_id.to_string()));
        };
        Ok(Self::session_to_snapshot(session))
    }

    pub fn create_session(
        &self,
        req: WorldBridgeSessionCreateRequest,
    ) -> Result<WorldBridgeSessionSnapshot, WorldBridgeError> {
        validate_schema_version(&req.schema_version)?;
        if req.robot_name.trim().is_empty() {
            return Err(WorldBridgeError::InvalidRequest(
                "robot_name cannot be empty".to_string(),
            ));
        }
        if req.camera_ids.len() > MAX_CAMERAS_PER_SESSION {
            return Err(WorldBridgeError::InvalidRequest(format!(
                "camera_ids exceeded max size: {} > {}",
                req.camera_ids.len(),
                MAX_CAMERAS_PER_SESSION
            )));
        }
        if req.scenario_duration_ms < MIN_SCENARIO_DURATION_MS
            || req.scenario_duration_ms > MAX_SCENARIO_DURATION_MS
        {
            return Err(WorldBridgeError::InvalidRequest(format!(
                "scenario_duration_ms must be in range [{MIN_SCENARIO_DURATION_MS}, {MAX_SCENARIO_DURATION_MS}]"
            )));
        }

        let session_number = self.session_counter.fetch_add(1, Ordering::SeqCst);
        let session_id = format!("{SESSION_ID_PREFIX}-{session_number:08x}");
        let now_ns = crate::control::loop_task::now_unix_ns();

        let mut session = WorldBridgeSessionState {
            session_id: session_id.clone(),
            robot_name: req.robot_name,
            urdf_sha256: req.urdf_sha256,
            camera_ids: req.camera_ids,
            scenario_duration_ms: req.scenario_duration_ms,
            created_at_ns: now_ns,
            updated_at_ns: now_ns,
            scenario_time_ms: 0,
            last_command_sequence: 0,
            event_counter: EVENT_COUNTER_START,
            joint_state_rad: BTreeMap::new(),
            recent_events: VecDeque::with_capacity(MAX_EVENTS_PER_SESSION),
        };

        let session_created_payload = json!({
            "robot_name": session.robot_name.clone(),
            "camera_count": session.camera_ids.len(),
            "scenario_duration_ms": session.scenario_duration_ms,
        });
        let event = Self::append_event(
            &mut session,
            WorldBridgeEventType::SessionCreated,
            now_ns,
            session_created_payload,
        );

        {
            let mut sessions = self.sessions.write().expect("sessions lock poisoned");
            sessions.insert(session_id, session.clone());
        }
        let _ = self.events_tx.send(event);
        Ok(Self::session_to_snapshot(&session))
    }

    pub fn apply_joint_command(
        &self,
        session_id: &str,
        req: WorldBridgeJointCommandRequest,
    ) -> Result<WorldBridgeCommandAck, WorldBridgeError> {
        validate_schema_version(&req.schema_version)?;
        if req.joint_positions_rad.len() > MAX_JOINTS_PER_COMMAND {
            return Err(WorldBridgeError::InvalidRequest(format!(
                "joint command exceeds max joints: {} > {}",
                req.joint_positions_rad.len(),
                MAX_JOINTS_PER_COMMAND
            )));
        }
        if req
            .joint_positions_rad
            .iter()
            .any(|(name, value)| name.trim().is_empty() || !value.is_finite())
        {
            return Err(WorldBridgeError::InvalidRequest(
                "joint_positions_rad contains invalid entries".to_string(),
            ));
        }
        if req.source.trim().is_empty() {
            return Err(WorldBridgeError::InvalidRequest(
                "source cannot be empty".to_string(),
            ));
        }

        let now_ns = crate::control::loop_task::now_unix_ns();
        let command_joint_count = req.joint_positions_rad.len();
        let source = req.source.clone();
        let mut sessions = self.sessions.write().expect("sessions lock poisoned");
        let Some(session) = sessions.get_mut(session_id) else {
            return Err(WorldBridgeError::UnknownSession(session_id.to_string()));
        };

        if let Some(command_time_ms) = req.command_time_ms {
            session.scenario_time_ms =
                clamp_scenario_time(command_time_ms, session.scenario_duration_ms);
        }

        let command_sequence = resolve_sequence(session.last_command_sequence, req.sequence_id);
        session.last_command_sequence = command_sequence;
        session.updated_at_ns = now_ns;
        for (joint, value) in req.joint_positions_rad {
            session.joint_state_rad.insert(joint, value);
        }

        let event = Self::append_event(
            session,
            WorldBridgeEventType::JointCommandApplied,
            now_ns,
            json!({
                "source": source,
                "command_sequence": command_sequence,
                "joint_count": command_joint_count,
                "scenario_time_ms": session.scenario_time_ms,
            }),
        );
        let _ = self.events_tx.send(event);

        Ok(WorldBridgeCommandAck {
            schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
            session_id: session_id.to_string(),
            accepted: true,
            applied_joint_count: command_joint_count,
            scenario_time_ms: session.scenario_time_ms,
            command_sequence,
        })
    }

    pub fn update_scenario_time(
        &self,
        session_id: &str,
        req: WorldBridgeScenarioTimeUpdateRequest,
    ) -> Result<WorldBridgeSessionSnapshot, WorldBridgeError> {
        validate_schema_version(&req.schema_version)?;
        let now_ns = crate::control::loop_task::now_unix_ns();
        let mut sessions = self.sessions.write().expect("sessions lock poisoned");
        let Some(session) = sessions.get_mut(session_id) else {
            return Err(WorldBridgeError::UnknownSession(session_id.to_string()));
        };

        session.scenario_time_ms =
            clamp_scenario_time(req.scenario_time_ms, session.scenario_duration_ms);
        session.updated_at_ns = now_ns;
        let event = Self::append_event(
            session,
            WorldBridgeEventType::ScenarioTimeUpdated,
            now_ns,
            json!({
                "scenario_time_ms": session.scenario_time_ms,
            }),
        );
        let _ = self.events_tx.send(event);

        Ok(Self::session_to_snapshot(session))
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<WorldBridgeEvent> {
        self.events_tx.subscribe()
    }

    fn append_event(
        session: &mut WorldBridgeSessionState,
        event_type: WorldBridgeEventType,
        timestamp_ns: u64,
        payload: serde_json::Value,
    ) -> WorldBridgeEvent {
        session.event_counter = session.event_counter.saturating_add(1);
        let event = WorldBridgeEvent {
            schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
            event_id: format!(
                "{EVENT_ID_PREFIX}-{}-{}",
                session.session_id, session.event_counter
            ),
            session_id: session.session_id.clone(),
            event_type,
            timestamp_ns,
            payload,
        };
        if session.recent_events.len() == MAX_EVENTS_PER_SESSION {
            let _ = session.recent_events.pop_front();
        }
        session.recent_events.push_back(event.clone());
        event
    }

    fn session_to_snapshot(session: &WorldBridgeSessionState) -> WorldBridgeSessionSnapshot {
        WorldBridgeSessionSnapshot {
            schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
            session_id: session.session_id.clone(),
            robot_name: session.robot_name.clone(),
            urdf_sha256: session.urdf_sha256.clone(),
            camera_ids: session.camera_ids.clone(),
            created_at_ns: session.created_at_ns,
            updated_at_ns: session.updated_at_ns,
            scenario_duration_ms: session.scenario_duration_ms,
            scenario_time_ms: session.scenario_time_ms,
            joint_state_rad: session.joint_state_rad.clone(),
            last_command_sequence: session.last_command_sequence,
            recent_events: session.recent_events.iter().cloned().collect(),
        }
    }
}

fn validate_schema_version(schema_version: &str) -> Result<(), WorldBridgeError> {
    if schema_version != WORLD_BRIDGE_SCHEMA_VERSION_V1 {
        return Err(WorldBridgeError::InvalidSchemaVersion);
    }
    Ok(())
}

fn clamp_scenario_time(time_ms: u64, duration_ms: u64) -> u64 {
    if time_ms > duration_ms {
        return duration_ms;
    }
    time_ms
}

fn resolve_sequence(last_sequence: u64, requested_sequence: Option<u64>) -> u64 {
    match requested_sequence {
        Some(sequence) if sequence > last_sequence => sequence,
        Some(_) | None => {
            if last_sequence == 0 {
                COMMAND_SEQUENCE_START
            } else {
                last_sequence.saturating_add(COMMAND_SEQUENCE_STEP)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SCENARIO_DURATION_MS: u64 = 2_000;
    const TEST_INITIAL_SCENARIO_TIME_MS: u64 = 750;
    const TEST_SCENARIO_TIME_BEYOND_DURATION_MS: u64 = 9_999;
    const TEST_JOINT_1_VALUE_RAD: f64 = 0.4;
    const TEST_JOINT_2_VALUE_RAD: f64 = -0.2;

    #[test]
    fn create_session_populates_initial_event() {
        let hub = WorldBridgeHub::new();
        let session = hub
            .create_session(WorldBridgeSessionCreateRequest {
                schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
                robot_name: "so100".to_string(),
                urdf_sha256: None,
                camera_ids: vec!["base_cam".to_string()],
                scenario_duration_ms: TEST_SCENARIO_DURATION_MS,
            })
            .expect("session should be created");
        assert_eq!(session.scenario_duration_ms, TEST_SCENARIO_DURATION_MS);
        assert_eq!(session.recent_events.len(), 1);
        assert_eq!(
            session.recent_events[0].event_type,
            WorldBridgeEventType::SessionCreated
        );
    }

    #[test]
    fn joint_command_applies_state_and_sequence() {
        let hub = WorldBridgeHub::new();
        let session = hub
            .create_session(WorldBridgeSessionCreateRequest {
                schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
                robot_name: "so101".to_string(),
                urdf_sha256: None,
                camera_ids: Vec::new(),
                scenario_duration_ms: TEST_SCENARIO_DURATION_MS,
            })
            .expect("session should be created");

        let joint_positions = BTreeMap::from([
            ("joint_1".to_string(), TEST_JOINT_1_VALUE_RAD),
            ("joint_2".to_string(), TEST_JOINT_2_VALUE_RAD),
        ]);
        let ack = hub
            .apply_joint_command(
                &session.session_id,
                WorldBridgeJointCommandRequest {
                    schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
                    joint_positions_rad: joint_positions,
                    source: "test".to_string(),
                    sequence_id: None,
                    command_time_ms: None,
                },
            )
            .expect("joint command should apply");
        assert_eq!(ack.command_sequence, COMMAND_SEQUENCE_START);

        let snapshot = hub
            .get_session(&session.session_id)
            .expect("session should exist");
        assert_eq!(
            snapshot.joint_state_rad.get("joint_1"),
            Some(&TEST_JOINT_1_VALUE_RAD)
        );
        assert_eq!(
            snapshot.joint_state_rad.get("joint_2"),
            Some(&TEST_JOINT_2_VALUE_RAD)
        );
    }

    #[test]
    fn scenario_time_is_clamped_to_duration() {
        let hub = WorldBridgeHub::new();
        let session = hub
            .create_session(WorldBridgeSessionCreateRequest {
                schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
                robot_name: "so101".to_string(),
                urdf_sha256: None,
                camera_ids: Vec::new(),
                scenario_duration_ms: TEST_SCENARIO_DURATION_MS,
            })
            .expect("session should be created");

        let first = hub
            .update_scenario_time(
                &session.session_id,
                WorldBridgeScenarioTimeUpdateRequest {
                    schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
                    scenario_time_ms: TEST_INITIAL_SCENARIO_TIME_MS,
                },
            )
            .expect("first scenario update should apply");
        assert_eq!(first.scenario_time_ms, TEST_INITIAL_SCENARIO_TIME_MS);

        let second = hub
            .update_scenario_time(
                &session.session_id,
                WorldBridgeScenarioTimeUpdateRequest {
                    schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
                    scenario_time_ms: TEST_SCENARIO_TIME_BEYOND_DURATION_MS,
                },
            )
            .expect("second scenario update should apply");
        assert_eq!(second.scenario_time_ms, TEST_SCENARIO_DURATION_MS);
    }
}
