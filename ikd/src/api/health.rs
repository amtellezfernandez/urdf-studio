use axum::{extract::State, Json};
use serde::Serialize;

use crate::app_state::AppState;

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub started_at: String,
    pub control_hz: u16,
    pub telemetry_hz: u16,
}

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "worldd",
        started_at: state.started_at.to_rfc3339(),
        control_hz: state.config.control_hz,
        telemetry_hz: state.config.telemetry_hz,
    })
}
