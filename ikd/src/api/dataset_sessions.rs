use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};

use crate::app_state::AppState;
use crate::dataset_sessions::{
    resolve_source_backed_session_request, DatasetReviewReason, DatasetSessionCreateRequest,
    DatasetSessionDeleteEpisodesRequest, DatasetSessionDeleteEpisodesResponse,
    DatasetSessionEpisodeDetailResponse, DatasetSessionEpisodeListResponse, DatasetSessionError,
    DatasetSessionFlagEpisodesRequest, DatasetSessionFlagEpisodesResponse,
    DatasetSessionReviewResponse, DatasetSessionSummary, DATASET_SESSION_SCHEMA_VERSION_V1,
    DEFAULT_EPISODE_PAGE_LIMIT,
};

#[derive(Debug, Clone, serde::Deserialize)]
pub struct DatasetSessionEpisodeListQuery {
    #[serde(default)]
    pub offset: usize,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub flagged_only: bool,
    #[serde(default)]
    pub reason: Option<DatasetReviewReason>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DatasetSessionErrorResponse {
    pub schema_version: String,
    pub code: &'static str,
    pub message: String,
}

pub async fn create_session(
    State(state): State<AppState>,
    Json(payload): Json<DatasetSessionCreateRequest>,
) -> Result<Json<DatasetSessionSummary>, (StatusCode, Json<DatasetSessionErrorResponse>)> {
    let resolved_payload = resolve_source_backed_session_request(payload)
        .await
        .map_err(to_http_error)?;
    state
        .dataset_sessions
        .create_session(resolved_payload)
        .map(Json)
        .map_err(to_http_error)
}

pub async fn summary(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<DatasetSessionSummary>, (StatusCode, Json<DatasetSessionErrorResponse>)> {
    state
        .dataset_sessions
        .summary(&session_id)
        .map(Json)
        .map_err(to_http_error)
}

pub async fn list_episodes(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<DatasetSessionEpisodeListQuery>,
) -> Result<Json<DatasetSessionEpisodeListResponse>, (StatusCode, Json<DatasetSessionErrorResponse>)>
{
    state
        .dataset_sessions
        .list_episodes(
            &session_id,
            query.offset,
            query.limit.unwrap_or(DEFAULT_EPISODE_PAGE_LIMIT),
            query.flagged_only,
            query.reason,
        )
        .map(Json)
        .map_err(to_http_error)
}

pub async fn get_episode(
    State(state): State<AppState>,
    Path((session_id, episode_id)): Path<(String, String)>,
) -> Result<
    Json<DatasetSessionEpisodeDetailResponse>,
    (StatusCode, Json<DatasetSessionErrorResponse>),
> {
    state
        .dataset_sessions
        .get_episode(&session_id, &episode_id)
        .map(Json)
        .map_err(to_http_error)
}

pub async fn review(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<DatasetSessionReviewResponse>, (StatusCode, Json<DatasetSessionErrorResponse>)> {
    state
        .dataset_sessions
        .review(&session_id)
        .map(Json)
        .map_err(to_http_error)
}

pub async fn update_flags(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(payload): Json<DatasetSessionFlagEpisodesRequest>,
) -> Result<Json<DatasetSessionFlagEpisodesResponse>, (StatusCode, Json<DatasetSessionErrorResponse>)>
{
    state
        .dataset_sessions
        .update_flags(&session_id, payload)
        .map(Json)
        .map_err(to_http_error)
}

pub async fn delete_episodes(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(payload): Json<DatasetSessionDeleteEpisodesRequest>,
) -> Result<
    Json<DatasetSessionDeleteEpisodesResponse>,
    (StatusCode, Json<DatasetSessionErrorResponse>),
> {
    state
        .dataset_sessions
        .delete_episodes(&session_id, payload)
        .map(Json)
        .map_err(to_http_error)
}

fn to_http_error(err: DatasetSessionError) -> (StatusCode, Json<DatasetSessionErrorResponse>) {
    let (status_code, code, message) = match err {
        DatasetSessionError::InvalidRequest(message) => {
            (StatusCode::BAD_REQUEST, "invalid_request", message)
        }
        DatasetSessionError::InvalidSchemaVersion => (
            StatusCode::BAD_REQUEST,
            "invalid_schema_version",
            "schema_version is not supported".to_string(),
        ),
        DatasetSessionError::UnknownSession(session_id) => (
            StatusCode::NOT_FOUND,
            "unknown_session",
            format!("unknown session: {session_id}"),
        ),
        DatasetSessionError::UnknownEpisode(episode_id) => (
            StatusCode::NOT_FOUND,
            "unknown_episode",
            format!("unknown episode: {episode_id}"),
        ),
        DatasetSessionError::ExternalSourceUnavailable(message) => (
            StatusCode::BAD_GATEWAY,
            "external_source_unavailable",
            message,
        ),
    };
    (
        status_code,
        Json(DatasetSessionErrorResponse {
            schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
            code,
            message,
        }),
    )
}
