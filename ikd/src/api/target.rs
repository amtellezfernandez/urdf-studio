use axum::{extract::State, http::StatusCode, Json};

use crate::{
    app_state::AppState,
    control::loop_task::now_unix_ns,
    types::{ErrorResponse, TargetAck, TargetMode, TargetRequest, SCHEMA_VERSION_V1},
};

pub async fn post_target(
    State(state): State<AppState>,
    Json(payload): Json<TargetRequest>,
) -> Result<Json<TargetAck>, (StatusCode, Json<ErrorResponse>)> {
    validate_target(&payload)?;

    let server_rx_ts_ns = now_unix_ns();
    state.control.set_target(payload.clone(), server_rx_ts_ns);

    Ok(Json(TargetAck {
        schema_version: SCHEMA_VERSION_V1.to_string(),
        accepted: true,
        sequence: payload.sequence,
        server_rx_ts_ns,
    }))
}

fn validate_target(payload: &TargetRequest) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if payload.schema_version != SCHEMA_VERSION_V1 {
        return Err(invalid_target("Unsupported schema_version"));
    }

    if payload.target_link.trim().is_empty() {
        return Err(invalid_target("target_link cannot be empty"));
    }

    if let Some(position) = payload.position_xyz_m {
        if !position.iter().all(|v| v.is_finite()) {
            return Err(invalid_target("position_xyz_m must contain finite values"));
        }
    }

    if let Some(quat) = payload.orientation_wxyz {
        if !quat.iter().all(|v| v.is_finite()) {
            return Err(invalid_target(
                "orientation_wxyz must contain finite values",
            ));
        }
        let norm_sq: f64 = quat.iter().map(|v| v * v).sum();
        if norm_sq <= 1e-12 {
            return Err(invalid_target("orientation_wxyz has near-zero norm"));
        }
    }

    if let Some(speed) = payload.max_linear_speed_mps {
        if !speed.is_finite() || speed <= 0.0 {
            return Err(invalid_target("max_linear_speed_mps must be > 0"));
        }
    }
    if let Some(speed) = payload.max_angular_speed_rps {
        if !speed.is_finite() || speed <= 0.0 {
            return Err(invalid_target("max_angular_speed_rps must be > 0"));
        }
    }

    if let Some(joints) = &payload.joint_targets_rad {
        if joints.is_empty() {
            return Err(invalid_target("joint_targets_rad cannot be empty"));
        }
        if joints
            .iter()
            .any(|(name, value)| name.trim().is_empty() || !value.is_finite())
        {
            return Err(invalid_target("joint_targets_rad contains invalid entries"));
        }
    }

    match payload.mode {
        TargetMode::Pose => {
            if payload.position_xyz_m.is_none() || payload.orientation_wxyz.is_none() {
                return Err(invalid_target(
                    "pose mode requires position_xyz_m and orientation_wxyz",
                ));
            }
        }
        TargetMode::Position => {
            if payload.position_xyz_m.is_none() {
                return Err(invalid_target("position mode requires position_xyz_m"));
            }
        }
        TargetMode::Joint => {
            if payload.joint_targets_rad.is_none() {
                return Err(invalid_target("joint mode requires joint_targets_rad"));
            }
        }
    }

    Ok(())
}

fn invalid_target(message: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            code: "invalid_target",
            message: message.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{OrientationPolicy, TargetMode, TargetRequest};

    fn base_target() -> TargetRequest {
        TargetRequest {
            schema_version: SCHEMA_VERSION_V1.to_string(),
            sequence: 1,
            source_ts_ns: 1,
            mode: TargetMode::Position,
            target_link: "ee".to_string(),
            position_xyz_m: Some([0.1, 0.2, 0.3]),
            orientation_wxyz: None,
            joint_targets_rad: None,
            orientation_policy: OrientationPolicy::Prefer,
            max_linear_speed_mps: Some(0.5),
            max_angular_speed_rps: Some(1.0),
        }
    }

    #[test]
    fn rejects_bad_schema() {
        let mut req = base_target();
        req.schema_version = "99".to_string();
        assert!(validate_target(&req).is_err());
    }

    #[test]
    fn rejects_pose_without_orientation() {
        let mut req = base_target();
        req.mode = TargetMode::Pose;
        req.orientation_wxyz = None;
        assert!(validate_target(&req).is_err());
    }

    #[test]
    fn accepts_joint_mode() {
        let mut req = base_target();
        req.mode = TargetMode::Joint;
        req.position_xyz_m = None;
        req.joint_targets_rad = Some([("joint1".to_string(), 0.2)].into_iter().collect());
        assert!(validate_target(&req).is_ok());
    }
}
