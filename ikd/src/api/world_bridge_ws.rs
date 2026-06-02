use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;

use crate::app_state::AppState;
use crate::world_bridge::WorldBridgeEvent;

pub async fn world_bridge_events_ws(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(state, socket))
}

async fn handle_socket(state: AppState, mut socket: WebSocket) {
    let mut event_rx = state.world_bridge.subscribe_events();
    while let Ok(event) = event_rx.recv().await {
        if send_event(&mut socket, &event).await.is_err() {
            break;
        }
    }
}

async fn send_event(socket: &mut WebSocket, event: &WorldBridgeEvent) -> Result<(), ()> {
    let payload = serde_json::to_string(event).map_err(|_| ())?;
    socket
        .send(Message::Text(payload.into()))
        .await
        .map_err(|_| ())
}
