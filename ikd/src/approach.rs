use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::types::{ErrorResponse, SCHEMA_VERSION_V1};

const APPROACH_EVENT_BUFFER_CAPACITY: usize = 64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApproachObjectType {
    Cube,
    Point,
    Sphere,
    Cylinder,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApproachTaskTargetMode {
    Punctual,
    OrbitCenter,
    OrbitPrimary,
    OrbitSecondary,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApproachTaskState {
    Locked,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApproachEventKind {
    Snapshot,
    ScenePublished,
    TaskStarted,
    TaskCancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApproachSceneObject {
    pub id: String,
    pub object_type: ApproachObjectType,
    pub position_xyz_m: [f64; 3],
    pub rotation_rpy_rad: Option<[f64; 3]>,
    pub size_xyz_m: [f64; 3],
    pub is_hidden: bool,
    pub orbit_radius_m: Option<f64>,
    pub orbit_inclination_deg: Option<f64>,
    pub orbit_phase_deg: Option<f64>,
    pub orbit_secondary_offset_deg: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApproachSceneSnapshotRequest {
    pub schema_version: String,
    pub scene_revision: u64,
    pub objects: Vec<ApproachSceneObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApproachSceneSnapshotAck {
    pub schema_version: String,
    pub accepted: bool,
    pub scene_revision: u64,
    pub object_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartApproachTaskRequest {
    pub schema_version: String,
    pub scene_revision: u64,
    pub object_id: String,
    pub target_mode: ApproachTaskTargetMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelApproachTaskRequest {
    pub schema_version: String,
    pub task_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelApproachTaskAck {
    pub schema_version: String,
    pub accepted: bool,
    pub task_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApproachTaskSnapshot {
    pub schema_version: String,
    pub task_id: u64,
    pub scene_revision: u64,
    pub object_id: String,
    pub target_mode: ApproachTaskTargetMode,
    pub state: ApproachTaskState,
    pub object: ApproachSceneObject,
    pub object_target_position_xyz_m: [f64; 3],
    pub created_at_ts_ns: u64,
    pub updated_at_ts_ns: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartApproachTaskAck {
    pub schema_version: String,
    pub accepted: bool,
    pub task: ApproachTaskSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetApproachTaskAck {
    pub schema_version: String,
    pub task: Option<ApproachTaskSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApproachEventFrame {
    pub schema_version: String,
    pub event_kind: ApproachEventKind,
    pub scene_revision: Option<u64>,
    pub object_count: Option<usize>,
    pub task: Option<ApproachTaskSnapshot>,
    pub emitted_at_ts_ns: u64,
}

#[derive(Debug, Clone)]
struct ApproachSceneState {
    scene_revision: u64,
    objects: Vec<ApproachSceneObject>,
}

#[derive(Debug, Clone)]
struct ApproachHubState {
    scene: Option<ApproachSceneState>,
    active_task: Option<ApproachTaskSnapshot>,
    next_task_id: u64,
}

#[derive(Clone)]
pub struct ApproachHub {
    state: Arc<RwLock<ApproachHubState>>,
    events_tx: broadcast::Sender<ApproachEventFrame>,
}

impl ApproachHub {
    pub fn new() -> Self {
        let (events_tx, _events_rx) = broadcast::channel(APPROACH_EVENT_BUFFER_CAPACITY);
        Self {
            state: Arc::new(RwLock::new(ApproachHubState {
                scene: None,
                active_task: None,
                next_task_id: 1,
            })),
            events_tx,
        }
    }

    pub fn publish_scene(
        &self,
        request: ApproachSceneSnapshotRequest,
        now_ts_ns: u64,
    ) -> Result<ApproachSceneSnapshotAck, String> {
        validate_scene_request(&request)?;
        let object_count = request.objects.len();
        let mut state = self.state.write().expect("approach hub lock poisoned");
        if let Some(active_task) = state.active_task.as_mut() {
            if active_task.state != ApproachTaskState::Cancelled {
                active_task.state = ApproachTaskState::Cancelled;
                active_task.updated_at_ts_ns = now_ts_ns;
                self.emit_event(ApproachEventFrame {
                    schema_version: SCHEMA_VERSION_V1.to_string(),
                    event_kind: ApproachEventKind::TaskCancelled,
                    scene_revision: Some(active_task.scene_revision),
                    object_count: Some(object_count),
                    task: Some(active_task.clone()),
                    emitted_at_ts_ns: now_ts_ns,
                });
            }
        }
        state.scene = Some(ApproachSceneState {
            scene_revision: request.scene_revision,
            objects: request.objects,
        });
        self.emit_event(ApproachEventFrame {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            event_kind: ApproachEventKind::ScenePublished,
            scene_revision: Some(request.scene_revision),
            object_count: Some(object_count),
            task: state.active_task.clone(),
            emitted_at_ts_ns: now_ts_ns,
        });
        Ok(ApproachSceneSnapshotAck {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            accepted: true,
            scene_revision: request.scene_revision,
            object_count,
        })
    }

    pub fn start_task(
        &self,
        request: StartApproachTaskRequest,
        now_ts_ns: u64,
    ) -> Result<StartApproachTaskAck, String> {
        validate_start_task_request(&request)?;
        let mut state = self.state.write().expect("approach hub lock poisoned");
        let scene = state
            .scene
            .clone()
            .ok_or_else(|| "No approach scene snapshot has been published".to_string())?;
        if scene.scene_revision != request.scene_revision {
            return Err("Approach scene revision is stale".to_string());
        }
        let object = scene
            .objects
            .iter()
            .find(|object| object.id == request.object_id)
            .cloned()
            .ok_or_else(|| {
                "Approach target object was not found in the published scene".to_string()
            })?;
        if object.is_hidden {
            return Err("Approach target object is hidden".to_string());
        }
        if let Some(active_task) = state.active_task.as_mut() {
            if active_task.state != ApproachTaskState::Cancelled {
                active_task.state = ApproachTaskState::Cancelled;
                active_task.updated_at_ts_ns = now_ts_ns;
                self.emit_event(ApproachEventFrame {
                    schema_version: SCHEMA_VERSION_V1.to_string(),
                    event_kind: ApproachEventKind::TaskCancelled,
                    scene_revision: Some(active_task.scene_revision),
                    object_count: Some(scene.objects.len()),
                    task: Some(active_task.clone()),
                    emitted_at_ts_ns: now_ts_ns,
                });
            }
        }
        let task_id = state.next_task_id;
        state.next_task_id = state.next_task_id.saturating_add(1);
        let task = ApproachTaskSnapshot {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            task_id,
            scene_revision: request.scene_revision,
            object_id: object.id.clone(),
            target_mode: request.target_mode,
            state: ApproachTaskState::Locked,
            object_target_position_xyz_m: resolve_object_target_position_xyz_m(
                &object,
                request.target_mode,
            ),
            object,
            created_at_ts_ns: now_ts_ns,
            updated_at_ts_ns: now_ts_ns,
        };
        state.active_task = Some(task.clone());
        self.emit_event(ApproachEventFrame {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            event_kind: ApproachEventKind::TaskStarted,
            scene_revision: Some(request.scene_revision),
            object_count: Some(scene.objects.len()),
            task: Some(task.clone()),
            emitted_at_ts_ns: now_ts_ns,
        });
        Ok(StartApproachTaskAck {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            accepted: true,
            task,
        })
    }

    pub fn cancel_task(
        &self,
        request: CancelApproachTaskRequest,
        now_ts_ns: u64,
    ) -> Result<CancelApproachTaskAck, String> {
        validate_cancel_task_request(&request)?;
        let mut state = self.state.write().expect("approach hub lock poisoned");
        let object_count = state.scene.as_ref().map(|scene| scene.objects.len());
        let active_task = state
            .active_task
            .as_mut()
            .ok_or_else(|| "No active approach task exists".to_string())?;
        if active_task.task_id != request.task_id {
            return Err("Approach task id does not match the active task".to_string());
        }
        active_task.state = ApproachTaskState::Cancelled;
        active_task.updated_at_ts_ns = now_ts_ns;
        self.emit_event(ApproachEventFrame {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            event_kind: ApproachEventKind::TaskCancelled,
            scene_revision: Some(active_task.scene_revision),
            object_count,
            task: Some(active_task.clone()),
            emitted_at_ts_ns: now_ts_ns,
        });
        Ok(CancelApproachTaskAck {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            accepted: true,
            task_id: request.task_id,
        })
    }

    pub fn get_active_task(&self) -> Option<ApproachTaskSnapshot> {
        self.state
            .read()
            .expect("approach hub lock poisoned")
            .active_task
            .clone()
    }

    pub fn snapshot_event(&self, now_ts_ns: u64) -> ApproachEventFrame {
        let state = self.state.read().expect("approach hub lock poisoned");
        ApproachEventFrame {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            event_kind: ApproachEventKind::Snapshot,
            scene_revision: state.scene.as_ref().map(|scene| scene.scene_revision),
            object_count: state.scene.as_ref().map(|scene| scene.objects.len()),
            task: state.active_task.clone(),
            emitted_at_ts_ns: now_ts_ns,
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<ApproachEventFrame> {
        self.events_tx.subscribe()
    }

    fn emit_event(&self, event: ApproachEventFrame) {
        let _ = self.events_tx.send(event);
    }
}

fn validate_scene_request(request: &ApproachSceneSnapshotRequest) -> Result<(), String> {
    if request.schema_version != SCHEMA_VERSION_V1 {
        return Err("Unsupported schema_version".to_string());
    }
    if request
        .objects
        .iter()
        .any(|object| object.id.trim().is_empty())
    {
        return Err("Approach scene objects must have non-empty ids".to_string());
    }
    if request.objects.iter().any(|object| {
        !object
            .position_xyz_m
            .iter()
            .chain(object.size_xyz_m.iter())
            .all(|value| value.is_finite())
    }) {
        return Err("Approach scene objects must have finite position and size values".to_string());
    }
    Ok(())
}

fn validate_start_task_request(request: &StartApproachTaskRequest) -> Result<(), String> {
    if request.schema_version != SCHEMA_VERSION_V1 {
        return Err("Unsupported schema_version".to_string());
    }
    if request.object_id.trim().is_empty() {
        return Err("object_id cannot be empty".to_string());
    }
    Ok(())
}

fn validate_cancel_task_request(request: &CancelApproachTaskRequest) -> Result<(), String> {
    if request.schema_version != SCHEMA_VERSION_V1 {
        return Err("Unsupported schema_version".to_string());
    }
    if request.task_id == 0 {
        return Err("task_id must be greater than zero".to_string());
    }
    Ok(())
}

fn resolve_orbit_target_position_xyz_m(
    object: &ApproachSceneObject,
    target_mode: ApproachTaskTargetMode,
) -> [f64; 3] {
    let radius = object.orbit_radius_m.unwrap_or(0.5);
    let inclination_deg = object.orbit_inclination_deg.unwrap_or(15.0);
    let phase_deg = object.orbit_phase_deg.unwrap_or(0.0);
    let secondary_offset_deg = object.orbit_secondary_offset_deg.unwrap_or(180.0);
    let resolved_phase_deg = match target_mode {
        ApproachTaskTargetMode::OrbitSecondary => phase_deg + secondary_offset_deg,
        _ => phase_deg,
    };
    let phase_rad = resolved_phase_deg.to_radians();
    let inclination_rad = inclination_deg.to_radians();
    let x = phase_rad.cos() * radius;
    let y = phase_rad.sin() * radius;
    let z = y * inclination_rad.sin();
    let y_adjusted = y * inclination_rad.cos();
    [
        object.position_xyz_m[0] + x,
        object.position_xyz_m[1] + y_adjusted,
        object.position_xyz_m[2] + z,
    ]
}

fn resolve_object_target_position_xyz_m(
    object: &ApproachSceneObject,
    target_mode: ApproachTaskTargetMode,
) -> [f64; 3] {
    match target_mode {
        ApproachTaskTargetMode::Punctual | ApproachTaskTargetMode::OrbitCenter => {
            object.position_xyz_m
        }
        ApproachTaskTargetMode::OrbitPrimary | ApproachTaskTargetMode::OrbitSecondary => {
            resolve_orbit_target_position_xyz_m(object, target_mode)
        }
    }
}

pub fn invalid_approach_response(message: &str) -> ErrorResponse {
    ErrorResponse {
        schema_version: SCHEMA_VERSION_V1.to_string(),
        code: "invalid_approach_request",
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object() -> ApproachSceneObject {
        ApproachSceneObject {
            id: "box-1".to_string(),
            object_type: ApproachObjectType::Cube,
            position_xyz_m: [1.0, 2.0, 3.0],
            rotation_rpy_rad: Some([0.0, 0.0, 0.0]),
            size_xyz_m: [0.4, 0.2, 0.2],
            is_hidden: false,
            orbit_radius_m: Some(0.5),
            orbit_inclination_deg: Some(10.0),
            orbit_phase_deg: Some(0.0),
            orbit_secondary_offset_deg: Some(180.0),
        }
    }

    #[test]
    fn locks_task_against_published_scene() {
        let hub = ApproachHub::new();
        hub.publish_scene(
            ApproachSceneSnapshotRequest {
                schema_version: SCHEMA_VERSION_V1.to_string(),
                scene_revision: 7,
                objects: vec![object()],
            },
            100,
        )
        .expect("scene publish should succeed");

        let ack = hub
            .start_task(
                StartApproachTaskRequest {
                    schema_version: SCHEMA_VERSION_V1.to_string(),
                    scene_revision: 7,
                    object_id: "box-1".to_string(),
                    target_mode: ApproachTaskTargetMode::Punctual,
                },
                123,
            )
            .expect("task start should succeed");

        assert_eq!(ack.task.object_id, "box-1");
        assert_eq!(ack.task.object_target_position_xyz_m, [1.0, 2.0, 3.0]);
    }

    #[test]
    fn rejects_stale_scene_revision() {
        let hub = ApproachHub::new();
        hub.publish_scene(
            ApproachSceneSnapshotRequest {
                schema_version: SCHEMA_VERSION_V1.to_string(),
                scene_revision: 7,
                objects: vec![object()],
            },
            100,
        )
        .expect("scene publish should succeed");

        let result = hub.start_task(
            StartApproachTaskRequest {
                schema_version: SCHEMA_VERSION_V1.to_string(),
                scene_revision: 6,
                object_id: "box-1".to_string(),
                target_mode: ApproachTaskTargetMode::Punctual,
            },
            123,
        );

        assert!(result.is_err());
    }

    #[test]
    fn publishes_task_events() {
        let hub = ApproachHub::new();
        let mut events = hub.subscribe_events();

        hub.publish_scene(
            ApproachSceneSnapshotRequest {
                schema_version: SCHEMA_VERSION_V1.to_string(),
                scene_revision: 7,
                objects: vec![object()],
            },
            100,
        )
        .expect("scene publish should succeed");
        let scene_event = events.try_recv().expect("scene event should be available");
        assert_eq!(scene_event.event_kind, ApproachEventKind::ScenePublished);
        assert_eq!(scene_event.scene_revision, Some(7));

        let start = hub
            .start_task(
                StartApproachTaskRequest {
                    schema_version: SCHEMA_VERSION_V1.to_string(),
                    scene_revision: 7,
                    object_id: "box-1".to_string(),
                    target_mode: ApproachTaskTargetMode::Punctual,
                },
                120,
            )
            .expect("task start should succeed");
        let started_event = events.try_recv().expect("start event should be available");
        assert_eq!(started_event.event_kind, ApproachEventKind::TaskStarted);
        assert_eq!(
            started_event.task.as_ref().map(|task| task.task_id),
            Some(start.task.task_id)
        );

        hub.cancel_task(
            CancelApproachTaskRequest {
                schema_version: SCHEMA_VERSION_V1.to_string(),
                task_id: start.task.task_id,
            },
            130,
        )
        .expect("task cancel should succeed");
        let cancelled_event = events.try_recv().expect("cancel event should be available");
        assert_eq!(cancelled_event.event_kind, ApproachEventKind::TaskCancelled);
        assert_eq!(
            cancelled_event.task.as_ref().map(|task| task.state),
            Some(ApproachTaskState::Cancelled)
        );
    }

    #[test]
    fn cancels_previous_task_before_replacement() {
        let hub = ApproachHub::new();
        let mut events = hub.subscribe_events();
        hub.publish_scene(
            ApproachSceneSnapshotRequest {
                schema_version: SCHEMA_VERSION_V1.to_string(),
                scene_revision: 7,
                objects: vec![object()],
            },
            100,
        )
        .expect("scene publish should succeed");
        let _ = events.try_recv();

        let first = hub
            .start_task(
                StartApproachTaskRequest {
                    schema_version: SCHEMA_VERSION_V1.to_string(),
                    scene_revision: 7,
                    object_id: "box-1".to_string(),
                    target_mode: ApproachTaskTargetMode::Punctual,
                },
                120,
            )
            .expect("first task start should succeed");
        let _ = events
            .try_recv()
            .expect("first task start event should exist");

        let second = hub
            .start_task(
                StartApproachTaskRequest {
                    schema_version: SCHEMA_VERSION_V1.to_string(),
                    scene_revision: 7,
                    object_id: "box-1".to_string(),
                    target_mode: ApproachTaskTargetMode::OrbitPrimary,
                },
                140,
            )
            .expect("second task start should succeed");
        let cancel_event = events
            .try_recv()
            .expect("replacement cancel event should exist");
        let start_event = events
            .try_recv()
            .expect("replacement start event should exist");
        assert_eq!(cancel_event.event_kind, ApproachEventKind::TaskCancelled);
        assert_eq!(
            cancel_event.task.as_ref().map(|task| task.task_id),
            Some(first.task.task_id)
        );
        assert_eq!(start_event.event_kind, ApproachEventKind::TaskStarted);
        assert_eq!(
            start_event.task.as_ref().map(|task| task.task_id),
            Some(second.task.task_id)
        );
    }
}
