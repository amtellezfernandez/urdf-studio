use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use crate::app_state::AppState;
use crate::world_bridge::{
    WorldBridgeCommandAck, WorldBridgeError, WorldBridgeErrorResponse,
    WorldBridgeJointCommandRequest, WorldBridgeScenarioTimeUpdateRequest,
    WorldBridgeSessionCreateRequest, WorldBridgeSessionSnapshot, WorldBridgeStatusResponse,
    WORLD_BRIDGE_SCHEMA_VERSION_V1,
};

pub async fn status(State(state): State<AppState>) -> Json<WorldBridgeStatusResponse> {
    Json(state.world_bridge.status())
}

pub async fn list_sessions(State(state): State<AppState>) -> Json<Vec<WorldBridgeSessionSnapshot>> {
    Json(state.world_bridge.list_sessions())
}

pub async fn create_session(
    State(state): State<AppState>,
    Json(payload): Json<WorldBridgeSessionCreateRequest>,
) -> Result<Json<WorldBridgeSessionSnapshot>, (StatusCode, Json<WorldBridgeErrorResponse>)> {
    state
        .world_bridge
        .create_session(payload)
        .map(Json)
        .map_err(to_http_error)
}

pub async fn get_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<WorldBridgeSessionSnapshot>, (StatusCode, Json<WorldBridgeErrorResponse>)> {
    state
        .world_bridge
        .get_session(&session_id)
        .map(Json)
        .map_err(to_http_error)
}

pub async fn apply_joint_command(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(payload): Json<WorldBridgeJointCommandRequest>,
) -> Result<Json<WorldBridgeCommandAck>, (StatusCode, Json<WorldBridgeErrorResponse>)> {
    state
        .world_bridge
        .apply_joint_command(&session_id, payload)
        .map(Json)
        .map_err(to_http_error)
}

pub async fn update_scenario_time(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(payload): Json<WorldBridgeScenarioTimeUpdateRequest>,
) -> Result<Json<WorldBridgeSessionSnapshot>, (StatusCode, Json<WorldBridgeErrorResponse>)> {
    state
        .world_bridge
        .update_scenario_time(&session_id, payload)
        .map(Json)
        .map_err(to_http_error)
}

fn to_http_error(err: WorldBridgeError) -> (StatusCode, Json<WorldBridgeErrorResponse>) {
    let (status_code, code, message) = match err {
        WorldBridgeError::InvalidRequest(message) => {
            (StatusCode::BAD_REQUEST, "invalid_request", message)
        }
        WorldBridgeError::InvalidSchemaVersion => (
            StatusCode::BAD_REQUEST,
            "invalid_schema_version",
            "schema_version is not supported".to_string(),
        ),
        WorldBridgeError::UnknownSession(session_id) => (
            StatusCode::NOT_FOUND,
            "unknown_session",
            format!("unknown session: {session_id}"),
        ),
    };
    (
        status_code,
        Json(WorldBridgeErrorResponse {
            schema_version: WORLD_BRIDGE_SCHEMA_VERSION_V1.to_string(),
            code,
            message,
        }),
    )
}
