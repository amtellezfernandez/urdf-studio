use std::time::Duration;

use futures_util::StreamExt;
use ikd::{
    app_state::AppState,
    build_info,
    config::IkdConfig,
    control::ControlHub,
    types::{OrientationPolicy, TargetMode, TargetRequest, SCHEMA_VERSION_V1},
    world_bridge::{WorldBridgeSessionCreateRequest, WORLD_BRIDGE_SCHEMA_VERSION_V1},
};
use reqwest::StatusCode;

const TWO_LINK_URDF: &str = r#"
<robot name="demo">
  <link name="base"/>
  <link name="l1"/>
  <link name="l2"/>
  <link name="ee"/>
  <joint name="j1" type="revolute">
    <parent link="base"/>
    <child link="l1"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14"/>
  </joint>
  <joint name="j2" type="revolute">
    <parent link="l1"/>
    <child link="l2"/>
    <origin xyz="1 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14"/>
  </joint>
  <joint name="j3" type="fixed">
    <parent link="l2"/>
    <child link="ee"/>
    <origin xyz="1 0 0" rpy="0 0 0"/>
  </joint>
</robot>
"#;
const TEST_CONTROL_HZ: u16 = 100;
const TEST_TELEMETRY_HZ: u16 = 20;
const TEST_WS_WAIT_TIMEOUT_MS: u64 = 400;
const TEST_WS_WAIT_TOTAL_SECONDS: u64 = 3;
const TEST_WORLD_SCENARIO_DURATION_MS: u64 = 2_000;
const TEST_WORLD_SCENARIO_TIME_MS: u64 = 120;
const TEST_WORLD_COMMAND_SEQUENCE: u64 = 7;
const TEST_WORLD_JOINT_1_RAD: f64 = 0.3;
const TEST_WORLD_JOINT_2_RAD: f64 = -0.1;

#[tokio::test]
async fn health_and_version_endpoints_work() {
    let (base_url, _ws_url) = spawn_test_server().await;

    let client = reqwest::Client::new();
    let health = client
        .get(format!("{base_url}/health"))
        .send()
        .await
        .expect("health request failed");
    assert_eq!(health.status(), StatusCode::OK);

    let version = client
        .get(format!("{base_url}/version"))
        .send()
        .await
        .expect("version request failed");
    assert_eq!(version.status(), StatusCode::OK);
}

#[tokio::test]
async fn target_updates_are_visible_on_ws_stream() {
    let (base_url, ws_url) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let model_load = client
        .post(format!("{base_url}/model"))
        .json(&serde_json::json!({
            "schema_version": "1",
            "urdf_xml": TWO_LINK_URDF,
            "target_link": "ee",
            "seed_joint_values_rad": {"j1": 0.0, "j2": 0.0}
        }))
        .send()
        .await
        .expect("model load request failed");
    assert_eq!(model_load.status(), StatusCode::OK);

    let target = TargetRequest {
        schema_version: SCHEMA_VERSION_V1.to_string(),
        sequence: 42,
        source_ts_ns: 123,
        mode: TargetMode::Position,
        target_link: "ee".to_string(),
        position_xyz_m: Some([1.2, 0.4, 0.0]),
        orientation_wxyz: None,
        joint_targets_rad: None,
        orientation_policy: OrientationPolicy::Prefer,
        max_linear_speed_mps: Some(0.3),
        max_angular_speed_rps: Some(1.1),
    };

    let ack = client
        .post(format!("{base_url}/target"))
        .json(&target)
        .send()
        .await
        .expect("target request failed");
    assert_eq!(ack.status(), StatusCode::OK);

    let (mut ws, _resp) = tokio_tungstenite::connect_async(ws_url)
        .await
        .expect("failed to connect websocket");

    let deadline = tokio::time::Instant::now() + Duration::from_secs(TEST_WS_WAIT_TOTAL_SECONDS);
    let mut saw_applied_sequence = false;
    while tokio::time::Instant::now() < deadline {
        let frame = tokio::time::timeout(Duration::from_millis(TEST_WS_WAIT_TIMEOUT_MS), ws.next())
            .await
            .ok()
            .and_then(|opt| opt)
            .transpose()
            .expect("ws frame error");
        let Some(frame) = frame else {
            continue;
        };
        let text = frame.into_text().expect("expected text frame");
        let json: serde_json::Value = serde_json::from_str(&text).expect("invalid telemetry json");
        assert_eq!(json["schema_version"], SCHEMA_VERSION_V1);
        if json["sequence_applied"] == 42 {
            saw_applied_sequence = true;
            break;
        }
    }
    assert!(
        saw_applied_sequence,
        "timed out waiting for sequence_applied=42"
    );
}

#[tokio::test]
async fn world_bridge_http_and_ws_contract_works() {
    let (base_url, _ws_url) = spawn_test_server().await;
    let world_events_ws_url = base_url.replace("http://", "ws://") + "/world-bridge/events/ws";
    let client = reqwest::Client::new();

    let create_resp = client
        .post(format!("{base_url}/world-bridge/sessions"))
        .json(&WorldBridgeSessionCreateRequest {
            schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
            robot_name: "so100".to_string(),
            urdf_sha256: None,
            camera_ids: vec!["base_cam".to_string()],
            scenario_duration_ms: TEST_WORLD_SCENARIO_DURATION_MS,
        })
        .send()
        .await
        .expect("world session create request failed");
    assert_eq!(create_resp.status(), StatusCode::OK);
    let created: serde_json::Value = create_resp.json().await.expect("invalid create response");
    let session_id = created["session_id"]
        .as_str()
        .expect("session_id should exist")
        .to_string();

    let (mut ws, _resp) = tokio_tungstenite::connect_async(world_events_ws_url)
        .await
        .expect("failed to connect world bridge ws");

    let command_resp = client
        .post(format!(
            "{base_url}/world-bridge/sessions/{session_id}/joint-command"
        ))
        .json(&serde_json::json!({
            "schema_version": WORLD_BRIDGE_SCHEMA_VERSION_V1,
            "joint_positions_rad": {
                "joint_1": TEST_WORLD_JOINT_1_RAD,
                "joint_2": TEST_WORLD_JOINT_2_RAD
            },
            "source": "test-suite",
            "sequence_id": TEST_WORLD_COMMAND_SEQUENCE,
            "command_time_ms": TEST_WORLD_SCENARIO_TIME_MS
        }))
        .send()
        .await
        .expect("world joint command request failed");
    assert_eq!(command_resp.status(), StatusCode::OK);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(TEST_WS_WAIT_TOTAL_SECONDS);
    let mut saw_joint_command_event = false;
    while tokio::time::Instant::now() < deadline {
        let event = tokio::time::timeout(Duration::from_millis(TEST_WS_WAIT_TIMEOUT_MS), ws.next())
            .await
            .ok()
            .and_then(|opt| opt)
            .transpose()
            .expect("world bridge ws frame error");
        let Some(event) = event else {
            continue;
        };
        let text = event.into_text().expect("expected text event frame");
        let json: serde_json::Value = serde_json::from_str(&text).expect("invalid ws event json");
        if json["event_type"] == "joint_command_applied"
            && json["session_id"] == session_id
            && json["payload"]["command_sequence"] == TEST_WORLD_COMMAND_SEQUENCE
        {
            saw_joint_command_event = true;
            break;
        }
    }

    assert!(
        saw_joint_command_event,
        "timed out waiting for world_bridge joint_command_applied event"
    );
}

#[tokio::test]
async fn approach_scene_and_task_endpoints_lock_target_snapshot() {
    let (base_url, _ws_url) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let publish_resp = client
        .post(format!("{base_url}/approach/scene"))
        .json(&serde_json::json!({
            "schema_version": SCHEMA_VERSION_V1,
            "scene_revision": 4,
            "objects": [{
                "id": "box-a",
                "object_type": "cube",
                "position_xyz_m": [1.0, 2.0, 3.0],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz_m": [0.4, 0.2, 0.2],
                "is_hidden": false,
                "orbit_radius_m": 0.5,
                "orbit_inclination_deg": 10.0,
                "orbit_phase_deg": 0.0,
                "orbit_secondary_offset_deg": 180.0
            }]
        }))
        .send()
        .await
        .expect("approach scene publish failed");
    assert_eq!(publish_resp.status(), StatusCode::OK);

    let start_resp = client
        .post(format!("{base_url}/approach/task/start"))
        .json(&serde_json::json!({
            "schema_version": SCHEMA_VERSION_V1,
            "scene_revision": 4,
            "object_id": "box-a",
            "target_mode": "punctual"
        }))
        .send()
        .await
        .expect("approach task start failed");
    assert_eq!(start_resp.status(), StatusCode::OK);
    let started: serde_json::Value = start_resp
        .json()
        .await
        .expect("invalid approach start response");
    assert_eq!(started["task"]["object_id"], "box-a");
    assert_eq!(
        started["task"]["object_target_position_xyz_m"],
        serde_json::json!([1.0, 2.0, 3.0])
    );

    let get_resp = client
        .get(format!("{base_url}/approach/task"))
        .send()
        .await
        .expect("approach task get failed");
    assert_eq!(get_resp.status(), StatusCode::OK);
    let task_json: serde_json::Value = get_resp
        .json()
        .await
        .expect("invalid approach task response");
    let task_id = task_json["task"]["task_id"]
        .as_u64()
        .expect("task_id should be present");

    let cancel_resp = client
        .post(format!("{base_url}/approach/task/cancel"))
        .json(&serde_json::json!({
            "schema_version": SCHEMA_VERSION_V1,
            "task_id": task_id
        }))
        .send()
        .await
        .expect("approach task cancel failed");
    assert_eq!(cancel_resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn approach_events_are_visible_on_ws_stream() {
    let (base_url, _ws_url) = spawn_test_server().await;
    let approach_ws_url = base_url.replace("http://", "ws://") + "/approach/ws";
    let client = reqwest::Client::new();
    let (mut ws, _resp) = tokio_tungstenite::connect_async(approach_ws_url)
        .await
        .expect("failed to connect approach websocket");

    let publish_resp = client
        .post(format!("{base_url}/approach/scene"))
        .json(&serde_json::json!({
            "schema_version": SCHEMA_VERSION_V1,
            "scene_revision": 9,
            "objects": [{
                "id": "box-a",
                "object_type": "cube",
                "position_xyz_m": [1.0, 2.0, 3.0],
                "rotation_rpy_rad": [0.0, 0.0, 0.0],
                "size_xyz_m": [0.4, 0.2, 0.2],
                "is_hidden": false,
                "orbit_radius_m": 0.5,
                "orbit_inclination_deg": 10.0,
                "orbit_phase_deg": 0.0,
                "orbit_secondary_offset_deg": 180.0
            }]
        }))
        .send()
        .await
        .expect("approach scene publish failed");
    assert_eq!(publish_resp.status(), StatusCode::OK);

    let start_resp = client
        .post(format!("{base_url}/approach/task/start"))
        .json(&serde_json::json!({
            "schema_version": SCHEMA_VERSION_V1,
            "scene_revision": 9,
            "object_id": "box-a",
            "target_mode": "punctual"
        }))
        .send()
        .await
        .expect("approach task start failed");
    assert_eq!(start_resp.status(), StatusCode::OK);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(TEST_WS_WAIT_TOTAL_SECONDS);
    let mut saw_started = false;
    while tokio::time::Instant::now() < deadline {
        let frame = tokio::time::timeout(Duration::from_millis(TEST_WS_WAIT_TIMEOUT_MS), ws.next())
            .await
            .ok()
            .and_then(|opt| opt)
            .transpose()
            .expect("ws frame error");
        let Some(frame) = frame else {
            continue;
        };
        let text = frame.into_text().expect("expected text frame");
        let json: serde_json::Value = serde_json::from_str(&text).expect("invalid approach json");
        assert_eq!(json["schema_version"], SCHEMA_VERSION_V1);
        if json["event_kind"] == "task_started" && json["task"]["object_id"] == "box-a" {
            saw_started = true;
            break;
        }
    }

    assert!(saw_started, "timed out waiting for task_started event");
}

async fn spawn_test_server() -> (String, String) {
    let mut cfg = IkdConfig::default();
    cfg.host = "127.0.0.1".to_string();
    cfg.port = 0;
    cfg.ws_path = "/telemetry".to_string();
    cfg.control_hz = TEST_CONTROL_HZ;
    cfg.telemetry_hz = TEST_TELEMETRY_HZ;

    let control = ControlHub::new(cfg.clone());
    let _loop_handle = control.spawn_loop();

    let state = AppState {
        config: cfg.clone(),
        build_sha: build_info::build_sha(),
        started_at: chrono::Utc::now(),
        control,
        approach: ikd::approach::ApproachHub::new(),
        world_bridge: ikd::world_bridge::WorldBridgeHub::new(),
    };

    let app = ikd::build_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind failed");
    let addr = listener.local_addr().expect("no local addr");

    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("server failed");
    });

    (
        format!("http://{}", addr),
        format!("ws://{}/telemetry", addr),
    )
}
