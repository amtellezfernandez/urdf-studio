use axum::{
    routing::{get, post},
    Router,
};

use crate::app_state::AppState;

pub mod approach;
pub mod approach_ws;
pub mod dataset_sessions;
pub mod health;
pub mod model;
pub mod target;
pub mod telemetry_ws;
pub mod version;
pub mod world_bridge;
pub mod world_bridge_ws;

pub fn router(state: AppState) -> Router {
    let ws_path = state.config.ws_path.clone();

    Router::new()
        .route("/health", get(health::health))
        .route("/version", get(version::version))
        .route("/datasets/sessions", post(dataset_sessions::create_session))
        .route(
            "/datasets/sessions/{session_id}/summary",
            get(dataset_sessions::summary),
        )
        .route(
            "/datasets/sessions/{session_id}/episodes",
            get(dataset_sessions::list_episodes),
        )
        .route(
            "/datasets/sessions/{session_id}/episodes/{episode_id}",
            get(dataset_sessions::get_episode),
        )
        .route(
            "/datasets/sessions/{session_id}/review",
            get(dataset_sessions::review),
        )
        .route(
            "/datasets/sessions/{session_id}/flags",
            post(dataset_sessions::update_flags),
        )
        .route(
            "/datasets/sessions/{session_id}/delete",
            post(dataset_sessions::delete_episodes),
        )
        .route("/model", post(model::load_model))
        .route("/target", post(target::post_target))
        .route("/approach/scene", post(approach::publish_scene))
        .route("/approach/task", get(approach::get_task))
        .route("/approach/task/start", post(approach::start_task))
        .route("/approach/task/cancel", post(approach::cancel_task))
        .route("/approach/ws", get(approach_ws::approach_ws))
        .route("/world-bridge/status", get(world_bridge::status))
        .route("/world-bridge/sessions", get(world_bridge::list_sessions))
        .route("/world-bridge/sessions", post(world_bridge::create_session))
        .route(
            "/world-bridge/sessions/{session_id}",
            get(world_bridge::get_session),
        )
        .route(
            "/world-bridge/sessions/{session_id}/joint-command",
            post(world_bridge::apply_joint_command),
        )
        .route(
            "/world-bridge/sessions/{session_id}/scenario-time",
            post(world_bridge::update_scenario_time),
        )
        .route(
            "/world-bridge/events/ws",
            get(world_bridge_ws::world_bridge_events_ws),
        )
        .route(&ws_path, get(telemetry_ws::telemetry_ws))
        .with_state(state)
}
