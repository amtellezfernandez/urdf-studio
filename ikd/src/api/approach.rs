use axum::{extract::State, http::StatusCode, Json};

use crate::{
    app_state::AppState,
    approach::{
        invalid_approach_response, ApproachSceneSnapshotAck, ApproachSceneSnapshotRequest,
        CancelApproachTaskAck, CancelApproachTaskRequest, GetApproachTaskAck, StartApproachTaskAck,
        StartApproachTaskRequest,
    },
    control::loop_task::now_unix_ns,
};

pub async fn publish_scene(
    State(state): State<AppState>,
    Json(payload): Json<ApproachSceneSnapshotRequest>,
) -> Result<Json<ApproachSceneSnapshotAck>, (StatusCode, Json<crate::types::ErrorResponse>)> {
    state
        .approach
        .publish_scene(payload, now_unix_ns())
        .map(Json)
        .map_err(|message| {
            (
                StatusCode::BAD_REQUEST,
                Json(invalid_approach_response(&message)),
            )
        })
}

pub async fn start_task(
    State(state): State<AppState>,
    Json(payload): Json<StartApproachTaskRequest>,
) -> Result<Json<StartApproachTaskAck>, (StatusCode, Json<crate::types::ErrorResponse>)> {
    state
        .approach
        .start_task(payload, now_unix_ns())
        .map(Json)
        .map_err(|message| {
            (
                StatusCode::BAD_REQUEST,
                Json(invalid_approach_response(&message)),
            )
        })
}

pub async fn cancel_task(
    State(state): State<AppState>,
    Json(payload): Json<CancelApproachTaskRequest>,
) -> Result<Json<CancelApproachTaskAck>, (StatusCode, Json<crate::types::ErrorResponse>)> {
    state
        .approach
        .cancel_task(payload, now_unix_ns())
        .map(Json)
        .map_err(|message| {
            (
                StatusCode::BAD_REQUEST,
                Json(invalid_approach_response(&message)),
            )
        })
}

pub async fn get_task(State(state): State<AppState>) -> Json<GetApproachTaskAck> {
    Json(GetApproachTaskAck {
        schema_version: crate::types::SCHEMA_VERSION_V1.to_string(),
        task: state.approach.get_active_task(),
    })
}
