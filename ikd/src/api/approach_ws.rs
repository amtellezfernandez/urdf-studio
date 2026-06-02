use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;

use crate::app_state::AppState;
use crate::approach::ApproachEventFrame;
use crate::control::loop_task::now_unix_ns;

pub async fn approach_ws(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle_socket(state, socket))
}

async fn handle_socket(state: AppState, mut socket: WebSocket) {
    let snapshot = state.approach.snapshot_event(now_unix_ns());
    if send_frame(&mut socket, &snapshot).await.is_err() {
        return;
    }

    let mut rx = state.approach.subscribe_events();
    while let Ok(frame) = rx.recv().await {
        if send_frame(&mut socket, &frame).await.is_err() {
            break;
        }
    }
}

async fn send_frame(socket: &mut WebSocket, frame: &ApproachEventFrame) -> Result<(), ()> {
    let payload = serde_json::to_string(frame).map_err(|_| ())?;
    socket
        .send(Message::Text(payload.into()))
        .await
        .map_err(|_| ())
}
