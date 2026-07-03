use std::net::SocketAddr;

use chrono::Utc;
use ikd::{
    app_state::AppState, approach::ApproachHub, build_info, config::IkdConfig, control::ControlHub,
    world_bridge::WorldBridgeHub,
};
use tracing::{error, info};

#[tokio::main]
async fn main() {
    init_tracing();

    let config = IkdConfig::from_env();
    let build_sha = build_info::build_sha();

    let control = ControlHub::new(config.clone());
    let _loop_handle = control.spawn_loop();
    let world_bridge = WorldBridgeHub::new();

    let state = AppState {
        config: config.clone(),
        build_sha,
        started_at: Utc::now(),
        control,
        approach: ApproachHub::new(),
        world_bridge,
    };

    let router = ikd::build_router(state);
    let addr: SocketAddr = config
        .bind_addr()
        .parse()
        .expect("invalid IKD_HOST/IKD_PORT configuration");

    info!("worldd listening on {}", addr);
    if let Err(err) = axum::serve(
        tokio::net::TcpListener::bind(addr)
            .await
            .expect("failed to bind worldd listener"),
        router,
    )
    .await
    {
        error!("worldd server exited with error: {}", err);
    }
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,worldd=debug,ikd=debug,tower_http=info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}
