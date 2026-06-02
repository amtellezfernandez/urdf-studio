use axum::{extract::State, Json};
use serde::Serialize;

use crate::app_state::AppState;

#[derive(Debug, Serialize)]
pub struct VersionResponse {
    pub service: &'static str,
    pub build: String,
    pub schema_version: &'static str,
}

pub async fn version(State(state): State<AppState>) -> Json<VersionResponse> {
    Json(VersionResponse {
        service: "worldd",
        build: state.build_sha,
        schema_version: crate::types::SCHEMA_VERSION_V1,
    })
}
