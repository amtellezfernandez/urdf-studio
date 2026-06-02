use std::collections::BTreeMap;

use axum::{extract::State, http::StatusCode, Json};

use crate::{
    app_state::AppState,
    types::{ErrorResponse, ModelLoadAck, ModelLoadRequest, SCHEMA_VERSION_V1},
};

pub async fn load_model(
    State(state): State<AppState>,
    Json(payload): Json<ModelLoadRequest>,
) -> Result<Json<ModelLoadAck>, (StatusCode, Json<ErrorResponse>)> {
    if payload.schema_version != SCHEMA_VERSION_V1 {
        return Err(invalid_model("Unsupported schema_version"));
    }
    if payload.urdf_xml.trim().is_empty() {
        return Err(invalid_model("urdf_xml cannot be empty"));
    }
    if payload.target_link.trim().is_empty() {
        return Err(invalid_model("target_link cannot be empty"));
    }

    let seed = payload.seed_joint_values_rad.unwrap_or_else(BTreeMap::new);

    let loaded = state
        .control
        .load_model(&payload.urdf_xml, &payload.target_link, &seed)
        .map_err(|err| invalid_model(&format!("failed to load model: {err}")))?;

    Ok(Json(ModelLoadAck {
        schema_version: SCHEMA_VERSION_V1.to_string(),
        loaded: true,
        target_link: loaded.target_link,
        actuated_joint_names: loaded.actuated_joint_names,
        initial_ee_position_xyz_m: loaded.initial_ee_position,
    }))
}

fn invalid_model(message: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            code: "invalid_model",
            message: message.to_string(),
        }),
    )
}
