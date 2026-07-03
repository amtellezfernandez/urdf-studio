pub mod api;
pub mod app_state;
pub mod approach;
pub mod build_info;
pub mod config;
pub mod control;
pub mod solver;
pub mod types;
pub mod world_bridge;

use axum::http::HeaderValue;
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::app_state::AppState;

pub fn build_router(state: AppState) -> Router {
    let mut router = api::router(state.clone()).layer(TraceLayer::new_for_http());

    let cors = if let Some(origin) = &state.config.cors_origin {
        if let Ok(header) = origin.parse::<HeaderValue>() {
            CorsLayer::new()
                .allow_origin(header)
                .allow_methods(Any)
                .allow_headers(Any)
        } else {
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
        }
    } else {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    };

    router = router.layer(cors);
    router
}
