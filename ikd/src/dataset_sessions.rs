use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

pub const DATASET_SESSION_SCHEMA_VERSION_V1: &str = "1";

const DATASET_SESSION_ID_PREFIX: &str = "dss";
const DATASET_SESSION_COUNTER_START: u64 = 1;
const MAX_ACTIVE_DATASET_SESSIONS: usize = 128;
const MAX_EPISODES_PER_SESSION: usize = 2_048;
const MAX_FRAMES_PER_EPISODE: usize = 200_000;
const MAX_JOINTS_PER_FRAME: usize = 512;
const MAX_FLAG_UPDATES_PER_REQUEST: usize = 512;
pub const DEFAULT_EPISODE_PAGE_LIMIT: usize = 50;
const MAX_EPISODE_PAGE_LIMIT: usize = 200;
const HF_DATASET_ROWS_BATCH_SIZE: usize = 1_000;
const HF_DATASET_SERVER_BASE_URL: &str = "https://datasets-server.huggingface.co";
const MIN_EPISODES_FOR_DURATION_OUTLIERS: usize = 4;
const SHORT_DURATION_RATIO_THRESHOLD: f64 = 0.6;
const LONG_DURATION_RATIO_THRESHOLD: f64 = 1.8;
const LOW_MOTION_MEAN_DELTA_THRESHOLD: f64 = 0.01;
const FPS_MISMATCH_TOLERANCE: f64 = 0.5;
const MIN_EPISODES_FOR_LOSS_OUTLIERS: usize = 4;
const HIGH_LOSS_RATIO_THRESHOLD: f64 = 2.0;
const MIN_DUPLICATE_CONTENT_FINGERPRINT_COUNT: usize = 2;
const VLA_ACTION_OUTLIER_SCORE_THRESHOLD: f64 = 0.8;
const VLA_METADATA_POSITIVE_COUNT_THRESHOLD: f64 = 0.0;
const EPISODE_LOSS_METADATA_KEYS: [&str; 6] = [
    "loss",
    "sample_loss",
    "episode_loss",
    "training_loss",
    "mean_loss",
    "eval_loss",
];
const EPISODE_LOSS_NESTED_METADATA_KEYS: [(&str, &str); 2] =
    [("training_metrics", "loss"), ("metrics", "loss")];
const VLA_SENSOR_GAP_BOOL_METADATA_KEYS: [&str; 4] = [
    "sensor_gap",
    "missing_observation",
    "camera_gap",
    "observation_gap",
];
const VLA_SENSOR_GAP_COUNT_METADATA_KEYS: [&str; 4] = [
    "dropped_frames",
    "missing_frames",
    "sensor_gap_count",
    "camera_gap_count",
];
const VLA_ACTION_OUTLIER_BOOL_METADATA_KEYS: [&str; 3] =
    ["action_outlier", "bad_action", "controller_saturation"];
const VLA_ACTION_OUTLIER_SCORE_METADATA_KEYS: [&str; 3] = [
    "action_outlier_score",
    "controller_saturation_ratio",
    "action_anomaly_score",
];
const VLA_LANGUAGE_ISSUE_BOOL_METADATA_KEYS: [&str; 3] =
    ["language_mismatch", "instruction_mismatch", "task_mismatch"];
const VLA_LANGUAGE_METADATA_KEYS: [&str; 5] = [
    "language_instruction",
    "instruction",
    "task",
    "prompt",
    "label",
];
const VLA_ENABLE_BOOL_METADATA_KEYS: [&str; 3] = ["is_vla", "vla", "requires_language"];
const VLA_FAMILY_METADATA_KEYS: [&str; 4] = [
    "policy_family",
    "policy_type",
    "model_family",
    "dataset_family",
];
const VLA_EXPLICIT_FAILED_DEMO_BOOL_METADATA_KEYS: [&str; 2] = ["episode_success", "demo_success"];
const VLA_CONTEXTUAL_FAILED_DEMO_BOOL_METADATA_KEYS: [&str; 1] = ["success"];
const VLA_FAILED_DEMO_STRING_METADATA_KEYS: [&str; 3] = ["outcome", "status", "result"];
const VLA_FAILED_DEMO_STRING_VALUES: [&str; 5] = [
    "failure",
    "failed",
    "unsuccessful",
    "intervention",
    "aborted",
];
const VLA_NESTED_CURATED_OBJECT_KEYS: [&str; 3] = ["vla_curation", "curation", "quality"];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatasetSourceKind {
    Hf,
    Local,
    Recorded,
    Derived,
    Mixed,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum DatasetReviewReason {
    ShortDuration,
    LongDuration,
    LowMotion,
    TimingIrregularity,
    FpsMismatch,
    UnnamedJoints,
    UnmappedSignals,
    HighLoss,
    SensorGap,
    ActionOutlier,
    LanguageMismatch,
    FailedDemo,
    DuplicateEpisode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetEpisodeBasePose {
    pub position: DatasetEpisodeVec3,
    pub quaternion: DatasetEpisodeQuaternion,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetEpisodeVec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetEpisodeQuaternion {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetEpisodeFrame {
    pub timestamp: f64,
    pub joint_positions: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_pose: Option<DatasetEpisodeBasePose>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetSessionEpisodeCreateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_number: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<DatasetSourceKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(default)]
    pub frames: Vec<DatasetEpisodeFrame>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HfDatasetSourceDescriptor {
    pub dataset: String,
    pub config: String,
    pub split: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetSessionCreateRequest {
    pub schema_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset_label: Option<String>,
    pub source_kind: DatasetSourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(default)]
    pub dataset_metadata: Value,
    #[serde(default)]
    pub episodes: Vec<DatasetSessionEpisodeCreateRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hf_source: Option<HfDatasetSourceDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetReviewCount {
    pub reason: DatasetReviewReason,
    pub episode_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetSessionSummary {
    pub schema_version: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset_label: Option<String>,
    pub source_kind: DatasetSourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub robot_type: Option<String>,
    pub episode_count: usize,
    pub total_frame_count: usize,
    pub total_duration_sec: f64,
    pub flagged_episode_count: usize,
    pub review_counts: Vec<DatasetReviewCount>,
    pub created_at_ns: u64,
    pub updated_at_ns: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetSessionEpisodeSummary {
    pub episode_id: String,
    pub episode_number: u32,
    pub frame_count: usize,
    pub duration_sec: f64,
    pub fps: f64,
    pub flagged: bool,
    #[serde(default)]
    pub detected_reasons: Vec<DatasetReviewReason>,
    #[serde(default)]
    pub manual_reasons: Vec<DatasetReviewReason>,
    #[serde(default)]
    pub review_reasons: Vec<DatasetReviewReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_note: Option<String>,
    pub source_kind: DatasetSourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_fingerprint: Option<String>,
    #[serde(default)]
    pub recorded_video_camera_count: usize,
    #[serde(default)]
    pub recorded_video_stream_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub robot_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub naming_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetSessionEpisodeListResponse {
    pub schema_version: String,
    pub session_id: String,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub episodes: Vec<DatasetSessionEpisodeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetSessionEpisodeDetailResponse {
    pub schema_version: String,
    pub session_id: String,
    pub episode: DatasetSessionEpisodeSummary,
    #[serde(default)]
    pub frames: Vec<DatasetEpisodeFrame>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DatasetSessionReviewResponse {
    pub schema_version: String,
    pub session_id: String,
    pub flagged_episode_ids: Vec<String>,
    pub review_counts: Vec<DatasetReviewCount>,
    pub summary: DatasetSessionSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetSessionFlagUpdate {
    pub episode_id: String,
    pub flagged: bool,
    #[serde(default)]
    pub reasons: Vec<DatasetReviewReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetSessionFlagEpisodesRequest {
    pub schema_version: String,
    #[serde(default)]
    pub updates: Vec<DatasetSessionFlagUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetSessionFlagEpisodesResponse {
    pub schema_version: String,
    pub session_id: String,
    pub flagged_episode_count: usize,
    pub review_counts: Vec<DatasetReviewCount>,
    pub updated_episode_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetSessionDeleteEpisodesRequest {
    pub schema_version: String,
    #[serde(default)]
    pub episode_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatasetSessionDeleteEpisodesResponse {
    pub schema_version: String,
    pub session_id: String,
    pub deleted_episode_ids: Vec<String>,
    pub remaining_episode_count: usize,
}

#[derive(Debug, Error)]
pub enum DatasetSessionError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("invalid schema_version")]
    InvalidSchemaVersion,
    #[error("unknown session: {0}")]
    UnknownSession(String),
    #[error("unknown episode: {0}")]
    UnknownEpisode(String),
    #[error("external source unavailable: {0}")]
    ExternalSourceUnavailable(String),
}

#[derive(Debug, Clone)]
struct DatasetSessionEpisodeReviewState {
    flagged: bool,
    manual_reasons: Vec<DatasetReviewReason>,
    note: Option<String>,
}

#[derive(Debug, Clone)]
struct DatasetSessionEpisodeState {
    episode_id: String,
    episode_number: u32,
    source_kind: DatasetSourceKind,
    source_name: Option<String>,
    frames: Vec<DatasetEpisodeFrame>,
    metadata: Value,
    review_state: DatasetSessionEpisodeReviewState,
    derived_summary: DatasetSessionEpisodeSummary,
}

struct DatasetSessionEpisodeLineageFields {
    source_id: Option<String>,
    canonical_source: Option<String>,
    content_fingerprint: Option<String>,
}

#[derive(Debug, Clone)]
struct DatasetSessionState {
    session_id: String,
    dataset_label: Option<String>,
    source_kind: DatasetSourceKind,
    source_name: Option<String>,
    dataset_metadata: Value,
    episodes: Vec<DatasetSessionEpisodeState>,
    created_at_ns: u64,
    updated_at_ns: u64,
    summary: DatasetSessionSummary,
}

#[derive(Clone)]
pub struct DatasetSessionHub {
    sessions: Arc<RwLock<BTreeMap<String, DatasetSessionState>>>,
    session_counter: Arc<AtomicU64>,
}

impl DatasetSessionHub {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(BTreeMap::new())),
            session_counter: Arc::new(AtomicU64::new(DATASET_SESSION_COUNTER_START)),
        }
    }

    pub fn create_session(
        &self,
        req: DatasetSessionCreateRequest,
    ) -> Result<DatasetSessionSummary, DatasetSessionError> {
        validate_schema_version(&req.schema_version)?;
        validate_session_request(&req)?;

        let session_number = self.session_counter.fetch_add(1, Ordering::SeqCst);
        let session_id = format!("{DATASET_SESSION_ID_PREFIX}-{session_number:08x}");
        let now_ns = crate::control::loop_task::now_unix_ns();

        let episodes = req
            .episodes
            .into_iter()
            .enumerate()
            .map(|(index, episode)| {
                build_episode_state(index, episode, req.source_kind, req.source_name.clone())
            })
            .collect::<Result<Vec<_>, _>>()?;

        let mut session = DatasetSessionState {
            session_id: session_id.clone(),
            dataset_label: req.dataset_label,
            source_kind: req.source_kind,
            source_name: req.source_name,
            dataset_metadata: req.dataset_metadata,
            episodes,
            created_at_ns: now_ns,
            updated_at_ns: now_ns,
            summary: DatasetSessionSummary {
                schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
                session_id,
                dataset_label: None,
                source_kind: DatasetSourceKind::Unknown,
                source_name: None,
                robot_type: None,
                episode_count: 0,
                total_frame_count: 0,
                total_duration_sec: 0.0,
                flagged_episode_count: 0,
                review_counts: Vec::new(),
                created_at_ns: now_ns,
                updated_at_ns: now_ns,
            },
        };
        refresh_session_derived_state(&mut session);

        let session_summary = session.summary.clone();
        let mut sessions = self
            .sessions
            .write()
            .expect("dataset sessions lock poisoned");
        if sessions.len() >= MAX_ACTIVE_DATASET_SESSIONS {
            return Err(DatasetSessionError::InvalidRequest(format!(
                "active dataset sessions exceeded configured capacity: {} >= {}",
                sessions.len(),
                MAX_ACTIVE_DATASET_SESSIONS
            )));
        }
        sessions.insert(session.session_id.clone(), session);
        Ok(session_summary)
    }

    pub fn summary(&self, session_id: &str) -> Result<DatasetSessionSummary, DatasetSessionError> {
        let sessions = self
            .sessions
            .read()
            .expect("dataset sessions lock poisoned");
        let session = sessions
            .get(session_id)
            .ok_or_else(|| DatasetSessionError::UnknownSession(session_id.to_string()))?;
        Ok(session.summary.clone())
    }

    pub fn list_episodes(
        &self,
        session_id: &str,
        offset: usize,
        limit: usize,
        flagged_only: bool,
        reason: Option<DatasetReviewReason>,
    ) -> Result<DatasetSessionEpisodeListResponse, DatasetSessionError> {
        let sessions = self
            .sessions
            .read()
            .expect("dataset sessions lock poisoned");
        let session = sessions
            .get(session_id)
            .ok_or_else(|| DatasetSessionError::UnknownSession(session_id.to_string()))?;
        let resolved_limit = limit.clamp(1, MAX_EPISODE_PAGE_LIMIT);

        let filtered = session
            .episodes
            .iter()
            .filter(|episode| !flagged_only || episode.review_state.flagged)
            .filter(|episode| {
                reason
                    .map(|expected| episode.derived_summary.review_reasons.contains(&expected))
                    .unwrap_or(true)
            })
            .map(|episode| episode.derived_summary.clone())
            .collect::<Vec<_>>();
        let total = filtered.len();
        let episodes = filtered
            .into_iter()
            .skip(offset)
            .take(resolved_limit)
            .collect::<Vec<_>>();

        Ok(DatasetSessionEpisodeListResponse {
            schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
            session_id: session_id.to_string(),
            total,
            offset,
            limit: resolved_limit,
            episodes,
        })
    }

    pub fn get_episode(
        &self,
        session_id: &str,
        episode_id: &str,
    ) -> Result<DatasetSessionEpisodeDetailResponse, DatasetSessionError> {
        let sessions = self
            .sessions
            .read()
            .expect("dataset sessions lock poisoned");
        let session = sessions
            .get(session_id)
            .ok_or_else(|| DatasetSessionError::UnknownSession(session_id.to_string()))?;
        let episode = session
            .episodes
            .iter()
            .find(|episode| episode.episode_id == episode_id)
            .ok_or_else(|| DatasetSessionError::UnknownEpisode(episode_id.to_string()))?;

        Ok(DatasetSessionEpisodeDetailResponse {
            schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
            session_id: session_id.to_string(),
            episode: episode.derived_summary.clone(),
            frames: episode.frames.clone(),
            metadata: episode.metadata.clone(),
        })
    }

    pub fn review(
        &self,
        session_id: &str,
    ) -> Result<DatasetSessionReviewResponse, DatasetSessionError> {
        let sessions = self
            .sessions
            .read()
            .expect("dataset sessions lock poisoned");
        let session = sessions
            .get(session_id)
            .ok_or_else(|| DatasetSessionError::UnknownSession(session_id.to_string()))?;

        Ok(DatasetSessionReviewResponse {
            schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
            session_id: session_id.to_string(),
            flagged_episode_ids: session
                .episodes
                .iter()
                .filter(|episode| episode.review_state.flagged)
                .map(|episode| episode.episode_id.clone())
                .collect(),
            review_counts: session.summary.review_counts.clone(),
            summary: session.summary.clone(),
        })
    }

    pub fn update_flags(
        &self,
        session_id: &str,
        req: DatasetSessionFlagEpisodesRequest,
    ) -> Result<DatasetSessionFlagEpisodesResponse, DatasetSessionError> {
        validate_schema_version(&req.schema_version)?;
        if req.updates.is_empty() {
            return Err(DatasetSessionError::InvalidRequest(
                "updates cannot be empty".to_string(),
            ));
        }
        if req.updates.len() > MAX_FLAG_UPDATES_PER_REQUEST {
            return Err(DatasetSessionError::InvalidRequest(format!(
                "updates exceeded max size: {} > {}",
                req.updates.len(),
                MAX_FLAG_UPDATES_PER_REQUEST
            )));
        }

        let mut sessions = self
            .sessions
            .write()
            .expect("dataset sessions lock poisoned");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| DatasetSessionError::UnknownSession(session_id.to_string()))?;
        let mut updated_episode_ids = Vec::with_capacity(req.updates.len());
        for update in req.updates {
            let episode = session
                .episodes
                .iter_mut()
                .find(|episode| episode.episode_id == update.episode_id)
                .ok_or_else(|| DatasetSessionError::UnknownEpisode(update.episode_id.clone()))?;
            episode.review_state.flagged = update.flagged;
            episode.review_state.manual_reasons = if update.flagged {
                dedupe_review_reasons(update.reasons)
            } else {
                Vec::new()
            };
            episode.review_state.note = if update.flagged {
                sanitize_optional_string(update.note)
            } else {
                None
            };
            updated_episode_ids.push(episode.episode_id.clone());
        }
        session.updated_at_ns = crate::control::loop_task::now_unix_ns();
        refresh_session_derived_state(session);

        Ok(DatasetSessionFlagEpisodesResponse {
            schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
            session_id: session_id.to_string(),
            flagged_episode_count: session.summary.flagged_episode_count,
            review_counts: session.summary.review_counts.clone(),
            updated_episode_ids,
        })
    }

    pub fn delete_episodes(
        &self,
        session_id: &str,
        req: DatasetSessionDeleteEpisodesRequest,
    ) -> Result<DatasetSessionDeleteEpisodesResponse, DatasetSessionError> {
        validate_schema_version(&req.schema_version)?;
        if req.episode_ids.is_empty() {
            return Err(DatasetSessionError::InvalidRequest(
                "episode_ids cannot be empty".to_string(),
            ));
        }

        let delete_ids = req.episode_ids.into_iter().collect::<BTreeSet<_>>();
        let mut sessions = self
            .sessions
            .write()
            .expect("dataset sessions lock poisoned");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| DatasetSessionError::UnknownSession(session_id.to_string()))?;

        let existing_ids = session
            .episodes
            .iter()
            .map(|episode| episode.episode_id.clone())
            .collect::<BTreeSet<_>>();
        let missing_id = delete_ids
            .iter()
            .find(|episode_id| !existing_ids.contains(*episode_id))
            .cloned();
        if let Some(episode_id) = missing_id {
            return Err(DatasetSessionError::UnknownEpisode(episode_id));
        }

        session
            .episodes
            .retain(|episode| !delete_ids.contains(&episode.episode_id));
        session.updated_at_ns = crate::control::loop_task::now_unix_ns();
        refresh_session_derived_state(session);

        Ok(DatasetSessionDeleteEpisodesResponse {
            schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
            session_id: session_id.to_string(),
            deleted_episode_ids: delete_ids.into_iter().collect(),
            remaining_episode_count: session.episodes.len(),
        })
    }
}

pub async fn resolve_source_backed_session_request(
    req: DatasetSessionCreateRequest,
) -> Result<DatasetSessionCreateRequest, DatasetSessionError> {
    if let Some(hf_source) = req.hf_source.clone() {
        return build_hf_session_request(&req, &hf_source).await;
    }
    Ok(req)
}

async fn build_hf_session_request(
    req: &DatasetSessionCreateRequest,
    hf_source: &HfDatasetSourceDescriptor,
) -> Result<DatasetSessionCreateRequest, DatasetSessionError> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| DatasetSessionError::ExternalSourceUnavailable(error.to_string()))?;

    let info_url = format!(
        "{HF_DATASET_SERVER_BASE_URL}/info?dataset={}",
        urlencoding::encode(&hf_source.dataset)
    );
    let info_response = client
        .get(info_url)
        .send()
        .await
        .map_err(|error| DatasetSessionError::ExternalSourceUnavailable(error.to_string()))?;
    let info = if info_response.status().is_success() {
        info_response
            .json::<HfDatasetServerInfoResponse>()
            .await
            .map_err(|error| DatasetSessionError::ExternalSourceUnavailable(error.to_string()))?
    } else {
        HfDatasetServerInfoResponse {
            dataset_info: BTreeMap::new(),
        }
    };

    let robot_type = info
        .dataset_info
        .get(&hf_source.config)
        .and_then(|config_info| {
            config_info
                .robot_type
                .clone()
                .or_else(|| resolve_string_field_from_map(&config_info.features, "robot_type"))
        });

    let indexed_episodes = fetch_hf_indexed_episodes(
        &client,
        &hf_source.dataset,
        &hf_source.config,
        &hf_source.split,
    )
    .await?;
    build_hf_session_request_from_indexed_episodes(req, hf_source, robot_type, indexed_episodes)
}

async fn fetch_hf_indexed_episodes(
    client: &reqwest::Client,
    dataset: &str,
    config: &str,
    split: &str,
) -> Result<Vec<HfIndexedEpisode>, DatasetSessionError> {
    let mut offset = 0usize;
    let mut episodes_by_index = BTreeMap::<u32, HfIndexedEpisode>::new();

    loop {
        let rows_url = format!(
            "{HF_DATASET_SERVER_BASE_URL}/rows?dataset={}&config={}&split={}&offset={offset}&length={HF_DATASET_ROWS_BATCH_SIZE}",
            urlencoding::encode(dataset),
            urlencoding::encode(config),
            urlencoding::encode(split),
        );
        let response =
            client.get(rows_url).send().await.map_err(|error| {
                DatasetSessionError::ExternalSourceUnavailable(error.to_string())
            })?;
        if !response.status().is_success() {
            return Err(DatasetSessionError::ExternalSourceUnavailable(format!(
                "HF rows request failed ({})",
                response.status()
            )));
        }
        let payload = response
            .json::<HfDatasetServerRowsResponse>()
            .await
            .map_err(|error| DatasetSessionError::ExternalSourceUnavailable(error.to_string()))?;
        if payload.rows.is_empty() {
            break;
        }

        let row_count = payload.rows.len();
        for row in payload.rows {
            let Some(row_data) = unwrap_hf_dataset_server_row(row) else {
                continue;
            };
            let episode_index = resolve_u32_field(&row_data, "episode_index").unwrap_or(0);
            let timestamp_ms = resolve_number_field_from_map(&row_data, "timestamp")
                .map(|timestamp| timestamp * 1000.0)
                .unwrap_or(0.0);
            let frame = DatasetEpisodeFrame {
                timestamp: timestamp_ms,
                joint_positions: BTreeMap::new(),
                base_pose: None,
            };
            let entry =
                episodes_by_index
                    .entry(episode_index)
                    .or_insert_with(|| HfIndexedEpisode {
                        episode_index,
                        frames: Vec::new(),
                        losses: Vec::new(),
                        first_timestamp_ms: None,
                        last_timestamp_ms: None,
                    });
            if let Some(loss) = resolve_loss_from_map(&row_data) {
                entry.losses.push(loss);
            }
            entry.frames.push(frame);
            entry.first_timestamp_ms = Some(
                entry
                    .first_timestamp_ms
                    .map(|current| current.min(timestamp_ms))
                    .unwrap_or(timestamp_ms),
            );
            entry.last_timestamp_ms = Some(
                entry
                    .last_timestamp_ms
                    .map(|current| current.max(timestamp_ms))
                    .unwrap_or(timestamp_ms),
            );
        }

        if row_count < HF_DATASET_ROWS_BATCH_SIZE {
            break;
        }
        offset += row_count;
    }

    Ok(episodes_by_index.into_values().collect())
}

fn build_hf_dataset_metadata(
    hf_source: &HfDatasetSourceDescriptor,
    robot_type: Option<&str>,
) -> Value {
    let mut metadata = Map::new();
    metadata.insert(
        "hf_dataset_repo".to_string(),
        Value::String(hf_source.dataset.clone()),
    );
    metadata.insert(
        "hf_config".to_string(),
        Value::String(hf_source.config.clone()),
    );
    metadata.insert(
        "hf_split".to_string(),
        Value::String(hf_source.split.clone()),
    );
    if let Some(robot_type) = robot_type {
        metadata.insert(
            "robot_type".to_string(),
            Value::String(robot_type.to_string()),
        );
    }
    Value::Object(metadata)
}

fn build_hf_session_request_from_indexed_episodes(
    req: &DatasetSessionCreateRequest,
    hf_source: &HfDatasetSourceDescriptor,
    robot_type: Option<String>,
    indexed_episodes: Vec<HfIndexedEpisode>,
) -> Result<DatasetSessionCreateRequest, DatasetSessionError> {
    if indexed_episodes.is_empty() {
        return Err(DatasetSessionError::ExternalSourceUnavailable(
            "HF dataset source produced no episodes".to_string(),
        ));
    }
    if indexed_episodes.len() > MAX_EPISODES_PER_SESSION {
        return Err(DatasetSessionError::InvalidRequest(format!(
            "episodes exceeded max size: {} > {}",
            indexed_episodes.len(),
            MAX_EPISODES_PER_SESSION
        )));
    }

    let dataset_metadata = build_hf_dataset_metadata(hf_source, robot_type.as_deref());
    let episodes = indexed_episodes
        .into_iter()
        .map(|episode| build_hf_episode_request(episode, hf_source, robot_type.as_deref()))
        .collect::<Vec<_>>();

    Ok(DatasetSessionCreateRequest {
        schema_version: req.schema_version.clone(),
        dataset_label: req
            .dataset_label
            .clone()
            .or_else(|| hf_source.dataset_label.clone())
            .or_else(|| Some(hf_source.dataset.clone())),
        source_kind: DatasetSourceKind::Hf,
        source_name: req
            .source_name
            .clone()
            .or_else(|| hf_source.source_name.clone())
            .or_else(|| Some(hf_source.dataset.clone())),
        dataset_metadata,
        episodes,
        hf_source: None,
    })
}

fn build_hf_episode_request(
    episode: HfIndexedEpisode,
    hf_source: &HfDatasetSourceDescriptor,
    robot_type: Option<&str>,
) -> DatasetSessionEpisodeCreateRequest {
    let frame_count = episode.frames.len();
    let duration_sec = match (episode.first_timestamp_ms, episode.last_timestamp_ms) {
        (Some(first), Some(last)) if last > first => (last - first) / 1000.0,
        _ => 0.0,
    };
    let fps = if duration_sec > 0.0 && frame_count > 1 {
        (frame_count.saturating_sub(1) as f64) / duration_sec
    } else {
        0.0
    };
    let mut additional = Map::new();
    additional.insert("sourceType".to_string(), Value::String("hf".to_string()));
    additional.insert(
        "sourceName".to_string(),
        Value::String(hf_source.dataset.clone()),
    );
    additional.insert(
        "hfDatasetRepo".to_string(),
        Value::String(hf_source.dataset.clone()),
    );
    additional.insert(
        "canonicalSource".to_string(),
        Value::String(hf_source.dataset.clone()),
    );
    additional.insert(
        "sourceId".to_string(),
        Value::String(format!(
            "hf:{}:{}:{}:{}",
            hf_source.dataset, hf_source.config, hf_source.split, episode.episode_index
        )),
    );
    additional.insert(
        "hfConfig".to_string(),
        Value::String(hf_source.config.clone()),
    );
    additional.insert(
        "hfSplit".to_string(),
        Value::String(hf_source.split.clone()),
    );

    let mut metadata = Map::new();
    metadata.insert(
        "episode_index".to_string(),
        Value::Number(serde_json::Number::from(episode.episode_index)),
    );
    metadata.insert(
        "num_frames".to_string(),
        Value::Number(serde_json::Number::from(frame_count as u64)),
    );
    if let Some(number) = serde_json::Number::from_f64(round_two(duration_sec)) {
        metadata.insert("episode_length_sec".to_string(), Value::Number(number));
    }
    if let Some(number) = serde_json::Number::from_f64(round_two(fps)) {
        metadata.insert("fps".to_string(), Value::Number(number));
    }
    if let Some(mean_loss) = mean(&episode.losses) {
        if let Some(number) = serde_json::Number::from_f64(round_two(mean_loss)) {
            metadata.insert("mean_loss".to_string(), Value::Number(number));
        }
    }
    if let Some(robot_type) = robot_type {
        metadata.insert(
            "robot_type".to_string(),
            Value::String(robot_type.to_string()),
        );
    }
    metadata.insert("additional".to_string(), Value::Object(additional));

    DatasetSessionEpisodeCreateRequest {
        episode_id: Some(format!(
            "hf-{}-{}-{}-{}",
            hf_source.dataset.replace('/', "-"),
            hf_source.config,
            hf_source.split,
            episode.episode_index
        )),
        episode_number: Some(episode.episode_index.saturating_add(1)),
        source_kind: Some(DatasetSourceKind::Hf),
        source_name: Some(hf_source.dataset.clone()),
        frames: episode.frames,
        metadata: Value::Object(metadata),
    }
}

#[derive(Debug, Deserialize)]
struct HfDatasetServerRowsResponse {
    #[serde(default)]
    rows: Vec<HfDatasetServerRow>,
}

#[derive(Debug, Deserialize)]
struct HfDatasetServerInfoResponse {
    #[serde(default)]
    dataset_info: BTreeMap<String, HfDatasetServerConfigInfo>,
}

#[derive(Debug, Deserialize)]
struct HfDatasetServerConfigInfo {
    #[serde(default)]
    features: BTreeMap<String, Value>,
    #[serde(default)]
    robot_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum HfDatasetServerRow {
    Wrapped {
        row: Option<BTreeMap<String, Value>>,
        #[serde(rename = "row_idx")]
        _row_idx: Option<usize>,
    },
    Flat(BTreeMap<String, Value>),
}

#[derive(Debug, Clone)]
struct HfIndexedEpisode {
    episode_index: u32,
    frames: Vec<DatasetEpisodeFrame>,
    losses: Vec<f64>,
    first_timestamp_ms: Option<f64>,
    last_timestamp_ms: Option<f64>,
}

fn validate_session_request(req: &DatasetSessionCreateRequest) -> Result<(), DatasetSessionError> {
    let has_episode_payload = !req.episodes.is_empty();
    let has_hf_source = req.hf_source.is_some();
    if !has_episode_payload && !has_hf_source {
        return Err(DatasetSessionError::InvalidRequest(
            "episodes or hf_source is required".to_string(),
        ));
    }
    if has_episode_payload && has_hf_source {
        return Err(DatasetSessionError::InvalidRequest(
            "episodes and hf_source cannot both be provided".to_string(),
        ));
    }
    if req.episodes.len() > MAX_EPISODES_PER_SESSION {
        return Err(DatasetSessionError::InvalidRequest(format!(
            "episodes exceeded max size: {} > {}",
            req.episodes.len(),
            MAX_EPISODES_PER_SESSION
        )));
    }
    if let Some(label) = &req.dataset_label {
        if label.trim().is_empty() {
            return Err(DatasetSessionError::InvalidRequest(
                "dataset_label cannot be blank".to_string(),
            ));
        }
    }
    if let Some(source_name) = &req.source_name {
        if source_name.trim().is_empty() {
            return Err(DatasetSessionError::InvalidRequest(
                "source_name cannot be blank".to_string(),
            ));
        }
    }
    if let Some(episode) = req.episodes.iter().find(|episode| {
        episode
            .source_name
            .as_ref()
            .map(|name| name.trim().is_empty())
            .unwrap_or(false)
    }) {
        return Err(DatasetSessionError::InvalidRequest(format!(
            "episode {} source_name cannot be blank",
            episode.episode_id.as_deref().unwrap_or("unknown")
        )));
    }
    if let Some(hf_source) = &req.hf_source {
        if hf_source.dataset.trim().is_empty()
            || hf_source.config.trim().is_empty()
            || hf_source.split.trim().is_empty()
        {
            return Err(DatasetSessionError::InvalidRequest(
                "hf_source.dataset/config/split cannot be blank".to_string(),
            ));
        }
    }
    Ok(())
}

fn build_episode_state(
    index: usize,
    episode: DatasetSessionEpisodeCreateRequest,
    source_kind: DatasetSourceKind,
    source_name: Option<String>,
) -> Result<DatasetSessionEpisodeState, DatasetSessionError> {
    let episode_id = sanitize_optional_string(episode.episode_id)
        .unwrap_or_else(|| format!("episode-{:06}", index + 1));
    let episode_number = episode.episode_number.unwrap_or((index + 1) as u32);
    let episode_source_kind = episode.source_kind.unwrap_or(source_kind);
    let episode_source_name = sanitize_optional_string(episode.source_name).or(source_name);

    if episode.frames.len() > MAX_FRAMES_PER_EPISODE {
        return Err(DatasetSessionError::InvalidRequest(format!(
            "episode {} exceeded max frame size: {} > {}",
            episode_id,
            episode.frames.len(),
            MAX_FRAMES_PER_EPISODE
        )));
    }
    for frame in &episode.frames {
        if !frame.timestamp.is_finite() {
            return Err(DatasetSessionError::InvalidRequest(format!(
                "episode {} contains non-finite timestamp",
                episode_id
            )));
        }
        if frame.joint_positions.len() > MAX_JOINTS_PER_FRAME {
            return Err(DatasetSessionError::InvalidRequest(format!(
                "episode {} exceeded max joint count per frame: {} > {}",
                episode_id,
                frame.joint_positions.len(),
                MAX_JOINTS_PER_FRAME
            )));
        }
        if frame
            .joint_positions
            .iter()
            .any(|(joint_name, value)| joint_name.trim().is_empty() || !value.is_finite())
        {
            return Err(DatasetSessionError::InvalidRequest(format!(
                "episode {} contains invalid joint entries",
                episode_id
            )));
        }
    }

    let metadata = normalize_metadata_value(episode.metadata);
    let summary = DatasetSessionEpisodeSummary {
        episode_id: episode_id.clone(),
        episode_number,
        frame_count: 0,
        duration_sec: 0.0,
        fps: 0.0,
        flagged: false,
        detected_reasons: Vec::new(),
        manual_reasons: Vec::new(),
        review_reasons: Vec::new(),
        review_note: None,
        source_kind: episode_source_kind,
        source_name: episode_source_name.clone(),
        source_id: None,
        canonical_source: None,
        content_fingerprint: None,
        recorded_video_camera_count: 0,
        recorded_video_stream_count: 0,
        robot_type: None,
        naming_status: None,
    };

    Ok(DatasetSessionEpisodeState {
        episode_id,
        episode_number,
        source_kind: episode_source_kind,
        source_name: episode_source_name,
        frames: episode.frames,
        metadata,
        review_state: DatasetSessionEpisodeReviewState {
            flagged: false,
            manual_reasons: Vec::new(),
            note: None,
        },
        derived_summary: summary,
    })
}

fn refresh_session_derived_state(session: &mut DatasetSessionState) {
    let mut durations = session
        .episodes
        .iter()
        .filter_map(|episode| {
            let duration_sec = resolve_episode_duration_sec(&episode.frames, &episode.metadata);
            (duration_sec > 0.0).then_some(duration_sec)
        })
        .collect::<Vec<_>>();
    durations.sort_by(total_cmp);
    let median_duration_sec = median_sorted(&durations);
    let mut losses = session
        .episodes
        .iter()
        .filter_map(|episode| resolve_episode_loss(&episode.metadata))
        .filter(|loss| *loss > 0.0)
        .collect::<Vec<_>>();
    losses.sort_by(total_cmp);
    let median_loss = median_sorted(&losses);
    let content_fingerprint_counts =
        build_content_fingerprint_counts(session.episodes.iter().map(|episode| &episode.metadata));

    let mut total_frame_count = 0usize;
    let mut total_duration_sec = 0.0;
    let mut flagged_episode_count = 0usize;
    let mut review_counts = BTreeMap::<DatasetReviewReason, usize>::new();

    for episode in &mut session.episodes {
        let derived = derive_episode_summary(
            episode,
            median_duration_sec,
            durations.len(),
            median_loss,
            losses.len(),
            &content_fingerprint_counts,
        );
        total_frame_count += derived.frame_count;
        total_duration_sec += derived.duration_sec;
        if derived.flagged {
            flagged_episode_count += 1;
        }
        for reason in &derived.review_reasons {
            *review_counts.entry(*reason).or_insert(0) += 1;
        }
        episode.derived_summary = derived;
    }

    session.summary = DatasetSessionSummary {
        schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
        session_id: session.session_id.clone(),
        dataset_label: session.dataset_label.clone(),
        source_kind: session.source_kind,
        source_name: session.source_name.clone(),
        robot_type: resolve_session_robot_type(&session.dataset_metadata, &session.episodes),
        episode_count: session.episodes.len(),
        total_frame_count,
        total_duration_sec: round_two(total_duration_sec),
        flagged_episode_count,
        review_counts: review_counts
            .into_iter()
            .map(|(reason, episode_count)| DatasetReviewCount {
                reason,
                episode_count,
            })
            .collect(),
        created_at_ns: session.created_at_ns,
        updated_at_ns: session.updated_at_ns,
    };
}

fn derive_episode_summary(
    episode: &DatasetSessionEpisodeState,
    median_duration_sec: Option<f64>,
    duration_sample_count: usize,
    median_loss: Option<f64>,
    loss_sample_count: usize,
    content_fingerprint_counts: &BTreeMap<String, usize>,
) -> DatasetSessionEpisodeSummary {
    let frame_count = episode.frames.len();
    let duration_sec = resolve_episode_duration_sec(&episode.frames, &episode.metadata);
    let fps = resolve_episode_fps(&episode.frames, &episode.metadata);
    let detected_reasons = derive_detected_reasons(
        episode,
        duration_sec,
        fps,
        median_duration_sec,
        duration_sample_count,
        median_loss,
        loss_sample_count,
        content_fingerprint_counts,
    );
    let manual_reasons = dedupe_review_reasons(episode.review_state.manual_reasons.clone());
    let review_reasons = merge_review_reasons(&detected_reasons, &manual_reasons);
    let (recorded_video_camera_count, recorded_video_stream_count) =
        resolve_recorded_video_counts(&episode.metadata);
    let lineage = resolve_episode_lineage_fields(&episode.metadata);

    DatasetSessionEpisodeSummary {
        episode_id: episode.episode_id.clone(),
        episode_number: episode.episode_number,
        frame_count,
        duration_sec: round_two(duration_sec),
        fps: round_two(fps),
        flagged: episode.review_state.flagged,
        detected_reasons,
        manual_reasons,
        review_reasons,
        review_note: episode.review_state.note.clone(),
        source_kind: episode.source_kind,
        source_name: episode.source_name.clone(),
        source_id: lineage.source_id,
        canonical_source: lineage.canonical_source,
        content_fingerprint: lineage.content_fingerprint,
        recorded_video_camera_count,
        recorded_video_stream_count,
        robot_type: resolve_robot_type_from_metadata(&episode.metadata),
        naming_status: resolve_string_field(&episode.metadata, "naming_status"),
    }
}

fn resolve_recorded_video_counts(metadata: &Value) -> (usize, usize) {
    let videos = metadata.get("videos").and_then(Value::as_object);
    let Some(videos) = videos else {
        return (0, 0);
    };
    let camera_count = videos
        .keys()
        .filter(|camera_name| !camera_name.trim().is_empty())
        .count();
    let stream_count = videos
        .iter()
        .filter(|(camera_name, descriptor)| {
            !camera_name.trim().is_empty() && descriptor_has_playable_video_candidate(descriptor)
        })
        .count();
    (camera_count, stream_count)
}

fn resolve_episode_lineage_fields(metadata: &Value) -> DatasetSessionEpisodeLineageFields {
    DatasetSessionEpisodeLineageFields {
        source_id: resolve_lineage_string_field(metadata, "sourceId", "source_id"),
        canonical_source: resolve_lineage_string_field(
            metadata,
            "canonicalSource",
            "canonical_source",
        ),
        content_fingerprint: resolve_lineage_string_field(
            metadata,
            "contentFingerprint",
            "content_fingerprint",
        ),
    }
}

fn resolve_lineage_string_field(
    metadata: &Value,
    camel_key: &str,
    snake_key: &str,
) -> Option<String> {
    resolve_nested_string_field(metadata, "additional", camel_key)
        .or_else(|| resolve_nested_string_field(metadata, "additional", snake_key))
        .or_else(|| resolve_string_field(metadata, camel_key))
        .or_else(|| resolve_string_field(metadata, snake_key))
}

fn resolve_nested_string_field(
    metadata: &Value,
    object_key: &str,
    field_key: &str,
) -> Option<String> {
    metadata
        .as_object()
        .and_then(|map| map.get(object_key))
        .and_then(Value::as_object)
        .and_then(|map| map.get(field_key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn descriptor_has_playable_video_candidate(value: &Value) -> bool {
    if value
        .as_str()
        .is_some_and(|candidate| !candidate.trim().is_empty())
    {
        return true;
    }
    let Some(object) = value.as_object() else {
        return false;
    };
    [
        "url",
        "hf_url",
        "src",
        "uri",
        "path",
        "filename",
        "path_template",
        "video_path",
        "template",
    ]
    .iter()
    .any(|key| {
        object
            .get(*key)
            .and_then(Value::as_str)
            .is_some_and(|candidate| !candidate.trim().is_empty())
    })
}

fn derive_detected_reasons(
    episode: &DatasetSessionEpisodeState,
    duration_sec: f64,
    fps: f64,
    median_duration_sec: Option<f64>,
    duration_sample_count: usize,
    median_loss: Option<f64>,
    loss_sample_count: usize,
    content_fingerprint_counts: &BTreeMap<String, usize>,
) -> Vec<DatasetReviewReason> {
    let mut reasons = BTreeSet::new();

    if duration_sample_count >= MIN_EPISODES_FOR_DURATION_OUTLIERS {
        if let Some(median) = median_duration_sec {
            if median > 0.0 && duration_sec > 0.0 {
                if duration_sec < median * SHORT_DURATION_RATIO_THRESHOLD {
                    reasons.insert(DatasetReviewReason::ShortDuration);
                }
                if duration_sec > median * LONG_DURATION_RATIO_THRESHOLD {
                    reasons.insert(DatasetReviewReason::LongDuration);
                }
            }
        }
    }

    if has_timing_irregularity(&episode.frames) {
        reasons.insert(DatasetReviewReason::TimingIrregularity);
    }
    if is_low_motion(&episode.frames) {
        reasons.insert(DatasetReviewReason::LowMotion);
    }

    if let Some(metadata_fps) = resolve_metadata_fps(&episode.metadata) {
        if fps > 0.0 && (fps - metadata_fps).abs() > FPS_MISMATCH_TOLERANCE {
            reasons.insert(DatasetReviewReason::FpsMismatch);
        }
    }

    if is_unnamed_episode(&episode.metadata, &episode.frames) {
        reasons.insert(DatasetReviewReason::UnnamedJoints);
    }
    if has_unmapped_signals(&episode.metadata) {
        reasons.insert(DatasetReviewReason::UnmappedSignals);
    }
    if is_high_loss_sample(&episode.metadata, median_loss, loss_sample_count) {
        reasons.insert(DatasetReviewReason::HighLoss);
    }
    if has_vla_sensor_gap(&episode.metadata) {
        reasons.insert(DatasetReviewReason::SensorGap);
    }
    if has_vla_action_outlier(&episode.metadata) {
        reasons.insert(DatasetReviewReason::ActionOutlier);
    }
    if has_vla_language_issue(&episode.metadata) {
        reasons.insert(DatasetReviewReason::LanguageMismatch);
    }
    if has_failed_demo(&episode.metadata) {
        reasons.insert(DatasetReviewReason::FailedDemo);
    }
    if has_duplicate_content_fingerprint(&episode.metadata, content_fingerprint_counts) {
        reasons.insert(DatasetReviewReason::DuplicateEpisode);
    }

    reasons.into_iter().collect()
}

fn resolve_session_robot_type(
    dataset_metadata: &Value,
    episodes: &[DatasetSessionEpisodeState],
) -> Option<String> {
    resolve_string_field(dataset_metadata, "robot_type").or_else(|| {
        episodes
            .iter()
            .find_map(|episode| resolve_robot_type_from_metadata(&episode.metadata))
    })
}

fn resolve_robot_type_from_metadata(metadata: &Value) -> Option<String> {
    resolve_string_field(metadata, "robot_type")
}

fn resolve_episode_duration_sec(frames: &[DatasetEpisodeFrame], metadata: &Value) -> f64 {
    if frames.len() >= 2 {
        let first = frames.first().map(|frame| frame.timestamp).unwrap_or(0.0);
        let last = frames.last().map(|frame| frame.timestamp).unwrap_or(first);
        let duration_ms = (last - first).max(0.0);
        if duration_ms.is_finite() {
            return duration_ms / 1000.0;
        }
    }
    resolve_number_field(metadata, "episode_length_sec").unwrap_or(0.0)
}

fn resolve_episode_fps(frames: &[DatasetEpisodeFrame], metadata: &Value) -> f64 {
    if frames.len() >= 2 {
        let first = frames.first().map(|frame| frame.timestamp).unwrap_or(0.0);
        let last = frames.last().map(|frame| frame.timestamp).unwrap_or(first);
        let duration_ms = last - first;
        if duration_ms > 0.0 && duration_ms.is_finite() {
            return (frames.len().saturating_sub(1) as f64) / (duration_ms / 1000.0);
        }
    }
    resolve_metadata_fps(metadata).unwrap_or(0.0)
}

fn resolve_metadata_fps(metadata: &Value) -> Option<f64> {
    resolve_number_field(metadata, "fps")
}

fn resolve_episode_loss(metadata: &Value) -> Option<f64> {
    EPISODE_LOSS_METADATA_KEYS
        .iter()
        .find_map(|key| resolve_number_field(metadata, key))
        .or_else(|| {
            EPISODE_LOSS_NESTED_METADATA_KEYS
                .iter()
                .find_map(|(object_key, field_key)| {
                    resolve_nested_number_field(metadata, object_key, field_key)
                })
        })
        .filter(|loss| *loss >= 0.0)
}

fn resolve_loss_from_map(metadata: &BTreeMap<String, Value>) -> Option<f64> {
    EPISODE_LOSS_METADATA_KEYS
        .iter()
        .find_map(|key| resolve_number_field_from_map(metadata, key))
        .or_else(|| {
            EPISODE_LOSS_NESTED_METADATA_KEYS
                .iter()
                .find_map(|(object_key, field_key)| {
                    resolve_nested_number_field_from_map(metadata, object_key, field_key)
                })
        })
        .filter(|loss| *loss >= 0.0)
}

fn is_high_loss_sample(
    metadata: &Value,
    median_loss: Option<f64>,
    loss_sample_count: usize,
) -> bool {
    if loss_sample_count < MIN_EPISODES_FOR_LOSS_OUTLIERS {
        return false;
    }
    let Some(sample_loss) = resolve_episode_loss(metadata) else {
        return false;
    };
    let Some(median_loss) = median_loss else {
        return false;
    };
    median_loss > 0.0 && sample_loss > median_loss * HIGH_LOSS_RATIO_THRESHOLD
}

fn build_content_fingerprint_counts<'a>(
    metadata_values: impl Iterator<Item = &'a Value>,
) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for metadata in metadata_values {
        if let Some(content_fingerprint) =
            resolve_episode_lineage_fields(metadata).content_fingerprint
        {
            *counts.entry(content_fingerprint).or_insert(0) += 1;
        }
    }
    counts
}

fn has_duplicate_content_fingerprint(
    metadata: &Value,
    content_fingerprint_counts: &BTreeMap<String, usize>,
) -> bool {
    resolve_episode_lineage_fields(metadata)
        .content_fingerprint
        .and_then(|content_fingerprint| {
            content_fingerprint_counts
                .get(&content_fingerprint)
                .copied()
        })
        .is_some_and(|count| count >= MIN_DUPLICATE_CONTENT_FINGERPRINT_COUNT)
}

fn has_vla_sensor_gap(metadata: &Value) -> bool {
    has_any_true_metadata_flag(metadata, &VLA_SENSOR_GAP_BOOL_METADATA_KEYS)
        || has_any_positive_metadata_count(metadata, &VLA_SENSOR_GAP_COUNT_METADATA_KEYS)
}

fn has_vla_action_outlier(metadata: &Value) -> bool {
    has_any_true_metadata_flag(metadata, &VLA_ACTION_OUTLIER_BOOL_METADATA_KEYS)
        || has_any_metadata_score_at_or_above(
            metadata,
            &VLA_ACTION_OUTLIER_SCORE_METADATA_KEYS,
            VLA_ACTION_OUTLIER_SCORE_THRESHOLD,
        )
}

fn has_vla_language_issue(metadata: &Value) -> bool {
    has_any_true_metadata_flag(metadata, &VLA_LANGUAGE_ISSUE_BOOL_METADATA_KEYS)
        || (is_vla_episode(metadata) && !has_language_instruction(metadata))
}

fn has_failed_demo(metadata: &Value) -> bool {
    has_explicit_failed_demo_bool(metadata)
        || has_nested_failed_demo_bool(metadata)
        || has_nested_failed_demo_string(metadata)
        || (is_vla_episode(metadata)
            && (has_contextual_failed_demo_bool(metadata)
                || has_top_level_failed_demo_string(metadata)))
}

fn has_explicit_failed_demo_bool(metadata: &Value) -> bool {
    VLA_EXPLICIT_FAILED_DEMO_BOOL_METADATA_KEYS
        .iter()
        .any(|key| resolve_bool_field(metadata, key).is_some_and(|value| !value))
}

fn has_contextual_failed_demo_bool(metadata: &Value) -> bool {
    VLA_CONTEXTUAL_FAILED_DEMO_BOOL_METADATA_KEYS
        .iter()
        .any(|key| resolve_bool_field(metadata, key).is_some_and(|value| !value))
}

fn has_nested_failed_demo_bool(metadata: &Value) -> bool {
    VLA_EXPLICIT_FAILED_DEMO_BOOL_METADATA_KEYS
        .iter()
        .chain(VLA_CONTEXTUAL_FAILED_DEMO_BOOL_METADATA_KEYS.iter())
        .any(|key| {
            resolve_nested_bool_from_curated_objects(metadata, key).is_some_and(|value| !value)
        })
}

fn has_top_level_failed_demo_string(metadata: &Value) -> bool {
    VLA_FAILED_DEMO_STRING_METADATA_KEYS.iter().any(|key| {
        resolve_string_field(metadata, key).is_some_and(|value| is_failed_demo_value(&value))
    })
}

fn has_nested_failed_demo_string(metadata: &Value) -> bool {
    VLA_FAILED_DEMO_STRING_METADATA_KEYS.iter().any(|key| {
        resolve_nested_string_from_curated_objects(metadata, key)
            .is_some_and(|value| is_failed_demo_value(&value))
    })
}

fn is_vla_episode(metadata: &Value) -> bool {
    has_any_true_metadata_flag(metadata, &VLA_ENABLE_BOOL_METADATA_KEYS)
        || VLA_FAMILY_METADATA_KEYS.iter().any(|key| {
            resolve_string_field(metadata, key)
                .or_else(|| resolve_nested_string_field(metadata, "additional", key))
                .is_some_and(|value| {
                    let normalized = value.to_ascii_lowercase();
                    normalized.contains("vla")
                        || normalized.contains("vision-language-action")
                        || normalized.contains("vision language action")
                })
        })
}

fn has_language_instruction(metadata: &Value) -> bool {
    VLA_LANGUAGE_METADATA_KEYS.iter().any(|key| {
        resolve_string_field(metadata, key)
            .or_else(|| resolve_nested_string_field(metadata, "additional", key))
            .is_some()
    }) || metadata
        .as_object()
        .and_then(|object| object.get("tasks"))
        .and_then(Value::as_array)
        .is_some_and(|tasks| {
            tasks
                .iter()
                .filter_map(Value::as_str)
                .any(|task| !task.trim().is_empty())
        })
}

fn has_any_true_metadata_flag(metadata: &Value, keys: &[&str]) -> bool {
    keys.iter().any(|key| {
        resolve_bool_field(metadata, key)
            .or_else(|| resolve_nested_bool_from_curated_objects(metadata, key))
            .unwrap_or(false)
    })
}

fn has_any_positive_metadata_count(metadata: &Value, keys: &[&str]) -> bool {
    keys.iter().any(|key| {
        resolve_number_field(metadata, key)
            .or_else(|| resolve_nested_number_from_curated_objects(metadata, key))
            .is_some_and(|count| count > VLA_METADATA_POSITIVE_COUNT_THRESHOLD)
    })
}

fn has_any_metadata_score_at_or_above(metadata: &Value, keys: &[&str], threshold: f64) -> bool {
    keys.iter().any(|key| {
        resolve_number_field(metadata, key)
            .or_else(|| resolve_nested_number_from_curated_objects(metadata, key))
            .is_some_and(|score| score >= threshold)
    })
}

fn resolve_nested_bool_from_curated_objects(metadata: &Value, field_key: &str) -> Option<bool> {
    VLA_NESTED_CURATED_OBJECT_KEYS
        .iter()
        .find_map(|object_key| resolve_nested_bool_field(metadata, object_key, field_key))
}

fn resolve_nested_number_from_curated_objects(metadata: &Value, field_key: &str) -> Option<f64> {
    VLA_NESTED_CURATED_OBJECT_KEYS
        .iter()
        .find_map(|object_key| resolve_nested_number_field(metadata, object_key, field_key))
}

fn resolve_nested_string_from_curated_objects(metadata: &Value, field_key: &str) -> Option<String> {
    VLA_NESTED_CURATED_OBJECT_KEYS
        .iter()
        .find_map(|object_key| resolve_nested_string_field(metadata, object_key, field_key))
}

fn is_failed_demo_value(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    VLA_FAILED_DEMO_STRING_VALUES
        .iter()
        .any(|failure_value| normalized == *failure_value)
}

fn has_timing_irregularity(frames: &[DatasetEpisodeFrame]) -> bool {
    frames
        .windows(2)
        .any(|pair| (pair[1].timestamp - pair[0].timestamp) <= 0.0)
}

fn is_low_motion(frames: &[DatasetEpisodeFrame]) -> bool {
    if frames.len() < 2 {
        return false;
    }
    let mut delta_sum = 0.0;
    let mut delta_count = 0usize;
    for pair in frames.windows(2) {
        let previous = &pair[0].joint_positions;
        let current = &pair[1].joint_positions;
        for (joint_name, current_value) in current {
            if let Some(previous_value) = previous.get(joint_name) {
                delta_sum += (current_value - previous_value).abs();
                delta_count += 1;
            }
        }
    }
    if delta_count == 0 {
        return false;
    }
    (delta_sum / delta_count as f64) < LOW_MOTION_MEAN_DELTA_THRESHOLD
}

fn is_unnamed_episode(metadata: &Value, frames: &[DatasetEpisodeFrame]) -> bool {
    if let Some(status) = resolve_string_field(metadata, "naming_status") {
        return status.eq_ignore_ascii_case("unnamed");
    }
    if let Some(joint_names) = metadata
        .as_object()
        .and_then(|map| map.get("joint_names"))
        .and_then(Value::as_array)
    {
        let valid_joint_names = joint_names
            .iter()
            .filter_map(Value::as_str)
            .filter(|name| !name.trim().is_empty())
            .count();
        return valid_joint_names == 0
            && frames.iter().any(|frame| !frame.joint_positions.is_empty());
    }
    false
}

fn has_unmapped_signals(metadata: &Value) -> bool {
    let Some(report) = metadata
        .as_object()
        .and_then(|map| map.get("signal_mapping_report"))
        .and_then(Value::as_object)
    else {
        return false;
    };

    let unmapped_channels = report
        .get("unmappedChannels")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if unmapped_channels > 0 {
        return true;
    }

    report
        .get("unmappedNames")
        .and_then(Value::as_array)
        .map(|entries| !entries.is_empty())
        .unwrap_or(false)
}

fn resolve_number_field(metadata: &Value, key: &str) -> Option<f64> {
    metadata
        .as_object()
        .and_then(|map| map.get(key))
        .and_then(resolve_number_value)
}

fn resolve_nested_number_field(metadata: &Value, object_key: &str, field_key: &str) -> Option<f64> {
    metadata
        .as_object()
        .and_then(|map| map.get(object_key))
        .and_then(Value::as_object)
        .and_then(|map| map.get(field_key))
        .and_then(resolve_number_value)
}

fn resolve_nested_number_field_from_map(
    metadata: &BTreeMap<String, Value>,
    object_key: &str,
    field_key: &str,
) -> Option<f64> {
    metadata
        .get(object_key)
        .and_then(Value::as_object)
        .and_then(|map| map.get(field_key))
        .and_then(resolve_number_value)
}

fn resolve_number_field_from_map(metadata: &BTreeMap<String, Value>, key: &str) -> Option<f64> {
    metadata.get(key).and_then(resolve_number_value)
}

fn resolve_number_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    }
    .filter(|value| value.is_finite())
}

fn resolve_bool_field(metadata: &Value, key: &str) -> Option<bool> {
    metadata
        .as_object()
        .and_then(|map| map.get(key))
        .and_then(resolve_bool_value)
}

fn resolve_nested_bool_field(metadata: &Value, object_key: &str, field_key: &str) -> Option<bool> {
    metadata
        .as_object()
        .and_then(|map| map.get(object_key))
        .and_then(Value::as_object)
        .and_then(|map| map.get(field_key))
        .and_then(resolve_bool_value)
}

fn resolve_bool_value(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "true" | "yes" | "success" | "succeeded" => Some(true),
            "false" | "no" | "failure" | "failed" | "unsuccessful" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn resolve_u32_field(metadata: &BTreeMap<String, Value>, key: &str) -> Option<u32> {
    resolve_number_field_from_map(metadata, key).and_then(|value| {
        if value.is_finite() && value >= 0.0 {
            Some(value.trunc() as u32)
        } else {
            None
        }
    })
}

fn resolve_string_field_from_map(metadata: &BTreeMap<String, Value>, key: &str) -> Option<String> {
    metadata
        .get(key)
        .and_then(|value| match value {
            Value::String(text) => Some(text.as_str()),
            _ => None,
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn resolve_string_field(metadata: &Value, key: &str) -> Option<String> {
    metadata
        .as_object()
        .and_then(|map| map.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn unwrap_hf_dataset_server_row(row: HfDatasetServerRow) -> Option<BTreeMap<String, Value>> {
    match row {
        HfDatasetServerRow::Wrapped { row, .. } => row,
        HfDatasetServerRow::Flat(row) => Some(row),
    }
}

fn sanitize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_metadata_value(metadata: Value) -> Value {
    match metadata {
        Value::Object(_) => metadata,
        Value::Null => Value::Object(Map::new()),
        other => {
            let mut object = Map::new();
            object.insert("value".to_string(), other);
            Value::Object(object)
        }
    }
}

fn merge_review_reasons(
    detected: &[DatasetReviewReason],
    manual: &[DatasetReviewReason],
) -> Vec<DatasetReviewReason> {
    let mut merged = BTreeSet::new();
    detected.iter().for_each(|reason| {
        merged.insert(*reason);
    });
    manual.iter().for_each(|reason| {
        merged.insert(*reason);
    });
    merged.into_iter().collect()
}

fn dedupe_review_reasons(reasons: Vec<DatasetReviewReason>) -> Vec<DatasetReviewReason> {
    reasons
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn median_sorted(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let middle = values.len() / 2;
    if values.len() % 2 == 0 {
        Some((values[middle - 1] + values[middle]) / 2.0)
    } else {
        Some(values[middle])
    }
}

fn mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(values.iter().sum::<f64>() / values.len() as f64)
}

fn round_two(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn total_cmp(left: &f64, right: &f64) -> std::cmp::Ordering {
    left.total_cmp(right)
}

fn validate_schema_version(schema_version: &str) -> Result<(), DatasetSessionError> {
    if schema_version != DATASET_SESSION_SCHEMA_VERSION_V1 {
        return Err(DatasetSessionError::InvalidSchemaVersion);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SHORT_DELTA: f64 = 0.005;
    const TEST_LONG_DELTA: f64 = 1.0;
    const TEST_MATCHING_FPS: f64 = 30.0;
    const TEST_MISMATCHING_FPS: f64 = 60.0;
    const TEST_BASELINE_LOSS: f64 = 0.25;
    const TEST_HIGH_LOSS_MULTIPLIER: f64 = 3.0;
    const TEST_HIGH_LOSS: f64 = TEST_BASELINE_LOSS * TEST_HIGH_LOSS_MULTIPLIER;
    const TEST_DEMO_FRAME_START_MS: f64 = 0.0;
    const TEST_DEMO_FRAME_END_MS: f64 = 1_000.0;
    const TEST_DEMO_JOINT_START: f64 = 0.0;
    const TEST_VLA_ACTION_OUTLIER_SCORE: f64 = 0.91;
    const TEST_DUPLICATE_CONTENT_FINGERPRINT: &str = "sha256:vla-duplicate";
    const TEST_SINGLE_EPISODE_ID: &str = "ep-single";
    const TEST_SINGLE_EPISODE_NUMBER: u32 = 1;
    const TEST_SESSION_SOURCE_NAME: &str = "operator-run";
    const TEST_VLA_POLICY_FAMILY: &str = "vision-language-action";
    const TEST_NON_VLA_TASK_LABEL: &str = "pick the red block";
    const TEST_FAILED_STATUS_VALUE: &str = "failed";

    fn frame(timestamp: f64, joint_value: f64) -> DatasetEpisodeFrame {
        DatasetEpisodeFrame {
            timestamp,
            joint_positions: BTreeMap::from([("joint_1".to_string(), joint_value)]),
            base_pose: None,
        }
    }

    fn create_single_episode_summary(metadata: Value) -> DatasetSessionEpisodeSummary {
        let hub = DatasetSessionHub::new();
        let summary = hub
            .create_session(DatasetSessionCreateRequest {
                schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
                dataset_label: Some("vla-regression".to_string()),
                source_kind: DatasetSourceKind::Recorded,
                source_name: Some(TEST_SESSION_SOURCE_NAME.to_string()),
                dataset_metadata: serde_json::json!({ "robot_type": "so101" }),
                hf_source: None,
                episodes: vec![DatasetSessionEpisodeCreateRequest {
                    episode_id: Some(TEST_SINGLE_EPISODE_ID.to_string()),
                    episode_number: Some(TEST_SINGLE_EPISODE_NUMBER),
                    source_kind: None,
                    source_name: None,
                    frames: vec![
                        frame(TEST_DEMO_FRAME_START_MS, TEST_DEMO_JOINT_START),
                        frame(TEST_DEMO_FRAME_END_MS, TEST_LONG_DELTA),
                    ],
                    metadata,
                }],
            })
            .expect("session should be created");
        hub.list_episodes(
            &summary.session_id,
            0,
            DEFAULT_EPISODE_PAGE_LIMIT,
            false,
            None,
        )
        .expect("episode list should succeed")
        .episodes
        .into_iter()
        .next()
        .expect("episode should exist")
    }

    #[test]
    fn create_session_derives_review_reasons_and_summary() {
        let hub = DatasetSessionHub::new();
        let summary = hub
            .create_session(DatasetSessionCreateRequest {
                schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
                dataset_label: Some("demo".to_string()),
                source_kind: DatasetSourceKind::Hf,
                source_name: Some("openai/demo".to_string()),
                dataset_metadata: serde_json::json!({ "robot_type": "so100" }),
                hf_source: None,
                episodes: vec![
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("ep-short".to_string()),
                        episode_number: Some(1),
                        source_kind: None,
                        source_name: None,
                        frames: vec![frame(0.0, 0.0), frame(1_000.0, TEST_SHORT_DELTA)],
                        metadata: serde_json::json!({
                            "fps": TEST_MATCHING_FPS,
                            "joint_names": ["joint_1"],
                            "loss": TEST_BASELINE_LOSS
                        }),
                    },
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("ep-long".to_string()),
                        episode_number: Some(2),
                        source_kind: None,
                        source_name: None,
                        frames: vec![frame(0.0, 0.0), frame(6_000.0, TEST_LONG_DELTA)],
                        metadata: serde_json::json!({
                            "fps": TEST_MISMATCHING_FPS,
                            "training_metrics": {
                                "loss": TEST_HIGH_LOSS
                            },
                            "naming_status": "unnamed",
                            "signal_mapping_report": { "unmappedChannels": 2 }
                        }),
                    },
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("ep-mid-a".to_string()),
                        episode_number: Some(3),
                        source_kind: None,
                        source_name: None,
                        frames: vec![frame(0.0, 0.0), frame(3_000.0, TEST_LONG_DELTA)],
                        metadata: serde_json::json!({
                            "fps": TEST_MATCHING_FPS,
                            "sample_loss": TEST_BASELINE_LOSS
                        }),
                    },
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("ep-mid-b".to_string()),
                        episode_number: Some(4),
                        source_kind: None,
                        source_name: None,
                        frames: vec![frame(0.0, 0.0), frame(3_000.0, TEST_LONG_DELTA)],
                        metadata: serde_json::json!({
                            "fps": TEST_MATCHING_FPS,
                            "metrics": {
                                "loss": TEST_BASELINE_LOSS
                            }
                        }),
                    },
                ],
            })
            .expect("session should be created");

        assert_eq!(summary.episode_count, 4);
        assert_eq!(summary.robot_type.as_deref(), Some("so100"));

        let episodes = hub
            .list_episodes(
                &summary.session_id,
                0,
                DEFAULT_EPISODE_PAGE_LIMIT,
                false,
                None,
            )
            .expect("episode list should succeed");
        let short = episodes
            .episodes
            .iter()
            .find(|episode| episode.episode_id == "ep-short")
            .expect("short episode should exist");
        assert!(short
            .review_reasons
            .contains(&DatasetReviewReason::ShortDuration));
        assert!(short
            .review_reasons
            .contains(&DatasetReviewReason::LowMotion));

        let long = episodes
            .episodes
            .iter()
            .find(|episode| episode.episode_id == "ep-long")
            .expect("long episode should exist");
        assert!(long
            .review_reasons
            .contains(&DatasetReviewReason::LongDuration));
        assert!(long
            .review_reasons
            .contains(&DatasetReviewReason::FpsMismatch));
        assert!(long
            .review_reasons
            .contains(&DatasetReviewReason::UnnamedJoints));
        assert!(long
            .review_reasons
            .contains(&DatasetReviewReason::UnmappedSignals));
        assert!(long.review_reasons.contains(&DatasetReviewReason::HighLoss));

        let high_loss_episodes = hub
            .list_episodes(
                &summary.session_id,
                0,
                DEFAULT_EPISODE_PAGE_LIMIT,
                false,
                Some(DatasetReviewReason::HighLoss),
            )
            .expect("high-loss episode list should succeed");
        assert_eq!(high_loss_episodes.total, 1);
        assert_eq!(high_loss_episodes.episodes[0].episode_id, "ep-long");
    }

    #[test]
    fn create_session_derives_vla_episode_curation_reasons() {
        let hub = DatasetSessionHub::new();
        let summary = hub
            .create_session(DatasetSessionCreateRequest {
                schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
                dataset_label: Some("vla-demo".to_string()),
                source_kind: DatasetSourceKind::Recorded,
                source_name: Some("operator-run".to_string()),
                dataset_metadata: serde_json::json!({ "robot_type": "so101" }),
                hf_source: None,
                episodes: vec![
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("ep-vla-bad".to_string()),
                        episode_number: Some(1),
                        source_kind: None,
                        source_name: None,
                        frames: vec![
                            frame(TEST_DEMO_FRAME_START_MS, TEST_DEMO_JOINT_START),
                            frame(TEST_DEMO_FRAME_END_MS, TEST_LONG_DELTA),
                        ],
                        metadata: serde_json::json!({
                            "is_vla": true,
                            "success": false,
                            "content_fingerprint": TEST_DUPLICATE_CONTENT_FINGERPRINT,
                            "vla_curation": {
                                "sensor_gap": true,
                                "action_outlier_score": TEST_VLA_ACTION_OUTLIER_SCORE,
                                "language_mismatch": true
                            }
                        }),
                    },
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("ep-vla-duplicate".to_string()),
                        episode_number: Some(2),
                        source_kind: None,
                        source_name: None,
                        frames: vec![
                            frame(TEST_DEMO_FRAME_START_MS, TEST_DEMO_JOINT_START),
                            frame(TEST_DEMO_FRAME_END_MS, TEST_LONG_DELTA),
                        ],
                        metadata: serde_json::json!({
                            "tasks": ["pick the red block"],
                            "content_fingerprint": TEST_DUPLICATE_CONTENT_FINGERPRINT,
                            "success": true
                        }),
                    },
                ],
            })
            .expect("session should be created");

        let episodes = hub
            .list_episodes(
                &summary.session_id,
                0,
                DEFAULT_EPISODE_PAGE_LIMIT,
                false,
                None,
            )
            .expect("episode list should succeed");
        let vla_bad = episodes
            .episodes
            .iter()
            .find(|episode| episode.episode_id == "ep-vla-bad")
            .expect("bad VLA episode should exist");
        assert!(vla_bad
            .review_reasons
            .contains(&DatasetReviewReason::SensorGap));
        assert!(vla_bad
            .review_reasons
            .contains(&DatasetReviewReason::ActionOutlier));
        assert!(vla_bad
            .review_reasons
            .contains(&DatasetReviewReason::LanguageMismatch));
        assert!(vla_bad
            .review_reasons
            .contains(&DatasetReviewReason::FailedDemo));
        assert!(vla_bad
            .review_reasons
            .contains(&DatasetReviewReason::DuplicateEpisode));

        let duplicate_episodes = hub
            .list_episodes(
                &summary.session_id,
                0,
                DEFAULT_EPISODE_PAGE_LIMIT,
                false,
                Some(DatasetReviewReason::DuplicateEpisode),
            )
            .expect("duplicate episode list should succeed");
        assert_eq!(duplicate_episodes.total, 2);

        let failed_demo_episodes = hub
            .list_episodes(
                &summary.session_id,
                0,
                DEFAULT_EPISODE_PAGE_LIMIT,
                false,
                Some(DatasetReviewReason::FailedDemo),
            )
            .expect("failed-demo episode list should succeed");
        assert_eq!(failed_demo_episodes.total, 1);
        assert_eq!(failed_demo_episodes.episodes[0].episode_id, "ep-vla-bad");
    }

    #[test]
    fn generic_task_and_failure_metadata_do_not_create_vla_review_reasons() {
        let episode = create_single_episode_summary(serde_json::json!({
            "tasks": [TEST_NON_VLA_TASK_LABEL],
            "success": false,
            "status": TEST_FAILED_STATUS_VALUE,
            "result": TEST_FAILED_STATUS_VALUE,
            "outcome": TEST_FAILED_STATUS_VALUE
        }));

        assert!(!episode
            .review_reasons
            .contains(&DatasetReviewReason::LanguageMismatch));
        assert!(!episode
            .review_reasons
            .contains(&DatasetReviewReason::FailedDemo));
    }

    #[test]
    fn explicit_vla_missing_language_and_failed_success_are_detected() {
        let episode = create_single_episode_summary(serde_json::json!({
            "policy_family": TEST_VLA_POLICY_FAMILY,
            "success": false
        }));

        assert!(episode
            .review_reasons
            .contains(&DatasetReviewReason::LanguageMismatch));
        assert!(episode
            .review_reasons
            .contains(&DatasetReviewReason::FailedDemo));
    }

    #[test]
    fn nested_curation_failure_is_detected_without_top_level_vla_marker() {
        let bool_failure_episode = create_single_episode_summary(serde_json::json!({
            "vla_curation": {
                "success": false
            }
        }));
        let string_failure_episode = create_single_episode_summary(serde_json::json!({
            "vla_curation": {
                "outcome": TEST_FAILED_STATUS_VALUE
            }
        }));

        assert!(bool_failure_episode
            .review_reasons
            .contains(&DatasetReviewReason::FailedDemo));
        assert!(string_failure_episode
            .review_reasons
            .contains(&DatasetReviewReason::FailedDemo));
    }

    #[test]
    fn flag_updates_and_deletes_refresh_summary() {
        let hub = DatasetSessionHub::new();
        let summary = hub
            .create_session(DatasetSessionCreateRequest {
                schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
                dataset_label: Some("demo".to_string()),
                source_kind: DatasetSourceKind::Recorded,
                source_name: Some("session-1".to_string()),
                dataset_metadata: Value::Object(Map::new()),
                hf_source: None,
                episodes: vec![
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("ep-1".to_string()),
                        episode_number: Some(1),
                        source_kind: None,
                        source_name: None,
                        frames: vec![frame(0.0, 0.0), frame(1_000.0, 0.5)],
                        metadata: Value::Object(Map::new()),
                    },
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("ep-2".to_string()),
                        episode_number: Some(2),
                        source_kind: None,
                        source_name: None,
                        frames: vec![frame(0.0, 0.0), frame(1_000.0, 0.6)],
                        metadata: Value::Object(Map::new()),
                    },
                ],
            })
            .expect("session should be created");

        let flag_response = hub
            .update_flags(
                &summary.session_id,
                DatasetSessionFlagEpisodesRequest {
                    schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
                    updates: vec![DatasetSessionFlagUpdate {
                        episode_id: "ep-1".to_string(),
                        flagged: true,
                        reasons: vec![DatasetReviewReason::TimingIrregularity],
                        note: Some("inspect".to_string()),
                    }],
                },
            )
            .expect("flag update should succeed");
        assert_eq!(flag_response.flagged_episode_count, 1);

        let review = hub
            .review(&summary.session_id)
            .expect("review should succeed");
        assert_eq!(review.flagged_episode_ids, vec!["ep-1".to_string()]);

        let delete_response = hub
            .delete_episodes(
                &summary.session_id,
                DatasetSessionDeleteEpisodesRequest {
                    schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
                    episode_ids: vec!["ep-2".to_string()],
                },
            )
            .expect("delete should succeed");
        assert_eq!(delete_response.remaining_episode_count, 1);

        let remaining = hub
            .list_episodes(
                &summary.session_id,
                0,
                DEFAULT_EPISODE_PAGE_LIMIT,
                false,
                None,
            )
            .expect("episode list should succeed");
        assert_eq!(remaining.total, 1);
        assert_eq!(remaining.episodes[0].episode_id, "ep-1");
    }

    #[test]
    fn episode_summaries_preserve_per_episode_source_lineage() {
        let hub = DatasetSessionHub::new();
        let summary = hub
            .create_session(DatasetSessionCreateRequest {
                schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
                dataset_label: Some("mixed".to_string()),
                source_kind: DatasetSourceKind::Mixed,
                source_name: Some("mixed".to_string()),
                dataset_metadata: Value::Object(Map::new()),
                hf_source: None,
                episodes: vec![
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("hf-episode".to_string()),
                        episode_number: Some(4),
                        source_kind: Some(DatasetSourceKind::Hf),
                        source_name: Some("openai/demo".to_string()),
                        frames: vec![frame(0.0, 0.0), frame(1_000.0, 0.5)],
                        metadata: serde_json::json!({
                            "additional": {
                                "sourceId": "repo:demo:episode-4",
                                "canonicalSource": "openai/demo",
                                "contentFingerprint": "sha256:demo-episode-4"
                            },
                            "videos": {
                                "observation.images.top": {
                                    "url": "https://example.com/top.mp4"
                                },
                                "observation.images.wrist": {}
                            }
                        }),
                    },
                    DatasetSessionEpisodeCreateRequest {
                        episode_id: Some("local-episode".to_string()),
                        episode_number: Some(2),
                        source_kind: Some(DatasetSourceKind::Local),
                        source_name: Some("/tmp/demo".to_string()),
                        frames: vec![frame(0.0, 0.0), frame(1_000.0, 0.6)],
                        metadata: serde_json::json!({
                            "additional": {
                                "source_id": "local:episode-2",
                                "canonical_source": "/tmp/demo"
                            }
                        }),
                    },
                ],
            })
            .expect("session should be created");

        let episodes = hub
            .list_episodes(
                &summary.session_id,
                0,
                DEFAULT_EPISODE_PAGE_LIMIT,
                false,
                None,
            )
            .expect("episode list should succeed");

        assert_eq!(episodes.total, 2);
        assert_eq!(episodes.episodes[0].episode_number, 4);
        assert_eq!(episodes.episodes[0].source_kind, DatasetSourceKind::Hf);
        assert_eq!(
            episodes.episodes[0].source_name.as_deref(),
            Some("openai/demo")
        );
        assert_eq!(
            episodes.episodes[0].source_id.as_deref(),
            Some("repo:demo:episode-4")
        );
        assert_eq!(
            episodes.episodes[0].canonical_source.as_deref(),
            Some("openai/demo")
        );
        assert_eq!(
            episodes.episodes[0].content_fingerprint.as_deref(),
            Some("sha256:demo-episode-4")
        );
        assert_eq!(episodes.episodes[0].recorded_video_camera_count, 2);
        assert_eq!(episodes.episodes[0].recorded_video_stream_count, 1);
        assert_eq!(episodes.episodes[1].episode_number, 2);
        assert_eq!(episodes.episodes[1].source_kind, DatasetSourceKind::Local);
        assert_eq!(
            episodes.episodes[1].source_name.as_deref(),
            Some("/tmp/demo")
        );
        assert_eq!(
            episodes.episodes[1].source_id.as_deref(),
            Some("local:episode-2")
        );
        assert_eq!(
            episodes.episodes[1].canonical_source.as_deref(),
            Some("/tmp/demo")
        );
    }

    #[test]
    fn hf_source_rows_build_source_backed_session_request() {
        let hf_source = HfDatasetSourceDescriptor {
            dataset: "openai/demo".to_string(),
            config: "default".to_string(),
            split: "train".to_string(),
            dataset_label: Some("openai/demo".to_string()),
            source_name: Some("openai/demo".to_string()),
        };
        let request = build_hf_session_request_from_indexed_episodes(
            &DatasetSessionCreateRequest {
                schema_version: DATASET_SESSION_SCHEMA_VERSION_V1.to_string(),
                dataset_label: None,
                source_kind: DatasetSourceKind::Hf,
                source_name: None,
                dataset_metadata: Value::Null,
                episodes: Vec::new(),
                hf_source: Some(hf_source.clone()),
            },
            &hf_source,
            Some("so100".to_string()),
            vec![HfIndexedEpisode {
                episode_index: 0,
                frames: vec![
                    DatasetEpisodeFrame {
                        timestamp: 0.0,
                        joint_positions: BTreeMap::new(),
                        base_pose: None,
                    },
                    DatasetEpisodeFrame {
                        timestamp: 1_000.0,
                        joint_positions: BTreeMap::new(),
                        base_pose: None,
                    },
                ],
                losses: vec![TEST_BASELINE_LOSS, TEST_HIGH_LOSS],
                first_timestamp_ms: Some(0.0),
                last_timestamp_ms: Some(1_000.0),
            }],
        )
        .expect("hf source request should build");

        assert_eq!(request.source_kind, DatasetSourceKind::Hf);
        assert_eq!(request.episodes.len(), 1);
        assert_eq!(request.hf_source, None);
        assert_eq!(
            resolve_string_field(&request.dataset_metadata, "hf_dataset_repo").as_deref(),
            Some("openai/demo")
        );
        assert_eq!(
            resolve_string_field(&request.episodes[0].metadata, "robot_type").as_deref(),
            Some("so100")
        );
        assert_eq!(
            resolve_number_field(&request.episodes[0].metadata, "mean_loss"),
            Some(0.5)
        );
    }
}
