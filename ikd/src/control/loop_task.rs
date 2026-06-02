use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tokio::time::{interval, MissedTickBehavior};

use crate::config::IkdConfig;
use crate::solver::{AmikError, AmikRuntime, ModelLoadResult};
use crate::types::{TargetMode, TargetRequest, TelemetryFrame};

const TARGET_FILTER_ALPHA: f64 = 0.5;

#[derive(Debug, Clone)]
struct LatestTarget {
    target: TargetRequest,
    server_rx_ts_ns: u64,
}

#[derive(Clone)]
pub struct ControlHub {
    latest_target: Arc<RwLock<Option<LatestTarget>>>,
    latest_telemetry: Arc<RwLock<TelemetryFrame>>,
    solver: Arc<RwLock<AmikRuntime>>,
    telemetry_tx: broadcast::Sender<TelemetryFrame>,
    config: IkdConfig,
}

impl ControlHub {
    pub fn new(config: IkdConfig) -> Self {
        let (telemetry_tx, _rx) = broadcast::channel(256);
        Self {
            latest_target: Arc::new(RwLock::new(None)),
            latest_telemetry: Arc::new(RwLock::new(TelemetryFrame::default())),
            solver: Arc::new(RwLock::new(AmikRuntime::new())),
            telemetry_tx,
            config,
        }
    }

    pub fn set_target(&self, target: TargetRequest, server_rx_ts_ns: u64) {
        let mut latest = self
            .latest_target
            .write()
            .expect("latest_target lock poisoned");
        *latest = Some(LatestTarget {
            target,
            server_rx_ts_ns,
        });
    }

    pub fn snapshot_telemetry(&self) -> TelemetryFrame {
        self.latest_telemetry
            .read()
            .expect("latest_telemetry lock poisoned")
            .clone()
    }

    pub fn subscribe_telemetry(&self) -> broadcast::Receiver<TelemetryFrame> {
        self.telemetry_tx.subscribe()
    }

    pub fn load_model(
        &self,
        urdf_xml: &str,
        target_link: &str,
        seed_joint_values: &std::collections::BTreeMap<String, f64>,
    ) -> Result<ModelLoadResult, AmikError> {
        let mut solver = self.solver.write().expect("solver lock poisoned");
        solver.load_model(urdf_xml, target_link, seed_joint_values)
    }

    pub fn spawn_loop(&self) -> JoinHandle<()> {
        let control_hz = self.config.control_hz.max(1) as u64;
        let telemetry_hz = self.config.telemetry_hz.max(1) as u64;
        let period = Duration::from_nanos(1_000_000_000u64 / control_hz);
        let period_s = period.as_secs_f64();
        let stale_target_ns = self.config.stale_target_ms.saturating_mul(1_000_000);
        let telemetry_stride = (control_hz / telemetry_hz).max(1);

        let latest_target = Arc::clone(&self.latest_target);
        let latest_telemetry = Arc::clone(&self.latest_telemetry);
        let solver = Arc::clone(&self.solver);
        let telemetry_tx = self.telemetry_tx.clone();

        tokio::spawn(async move {
            let mut ticker = interval(period);
            ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
            let mut tick_index = 0u64;
            let mut filtered_position: Option<[f64; 3]> = None;

            loop {
                ticker.tick().await;
                let loop_start = Instant::now();
                let now_ns = now_unix_ns();

                let mut frame = {
                    latest_telemetry
                        .read()
                        .expect("latest_telemetry lock poisoned")
                        .clone()
                };

                frame.tick_ts_ns = now_ns;
                frame.loop_hz = control_hz as f64;
                frame.limit_clamp_count = 0;
                frame.overrun = false;
                frame.residual_position_m = 0.0;

                let maybe_target = {
                    latest_target
                        .read()
                        .expect("latest_target lock poisoned")
                        .clone()
                };

                if let Some(latest) = maybe_target {
                    frame.sequence_applied = Some(latest.target.sequence);
                    let target_age_ns = now_ns.saturating_sub(latest.server_rx_ts_ns);
                    frame.stale_target = target_age_ns > stale_target_ns;
                    // Keep converging for a grace window after staleness to avoid abrupt freeze on sporadic network updates.
                    let hard_stale_ns = stale_target_ns.saturating_mul(8);
                    let allow_solve = target_age_ns <= hard_stale_ns;

                    if let Some(orientation) = latest.target.orientation_wxyz {
                        frame.ee_orientation_wxyz = orientation;
                    }

                    if allow_solve {
                        match latest.target.mode {
                            TargetMode::Joint => {
                                if let Some(joints) = latest.target.joint_targets_rad {
                                    frame.q_rad = joints;
                                }
                            }
                            TargetMode::Pose | TargetMode::Position => {
                                if let Some(position) = latest.target.position_xyz_m {
                                    let smoothed_target = if let Some(prev) = filtered_position {
                                        let next = [
                                            prev[0] + (position[0] - prev[0]) * TARGET_FILTER_ALPHA,
                                            prev[1] + (position[1] - prev[1]) * TARGET_FILTER_ALPHA,
                                            prev[2] + (position[2] - prev[2]) * TARGET_FILTER_ALPHA,
                                        ];
                                        filtered_position = Some(next);
                                        next
                                    } else {
                                        filtered_position = Some(position);
                                        position
                                    };

                                    let mut solver = solver.write().expect("solver lock poisoned");
                                    if solver.is_loaded() {
                                        if let Ok(step) =
                                            solver.step_towards(smoothed_target, period_s)
                                        {
                                            frame.q_rad = step.joint_values;
                                            frame.ee_position_xyz_m = step.ee_position;
                                            frame.residual_position_m = step.residual_position_m;
                                            frame.limit_clamp_count = step.limit_clamp_count;
                                        } else {
                                            // Keep previous telemetry frame when solve fails.
                                        }
                                    } else {
                                        frame.ee_position_xyz_m = position;
                                    }
                                }
                            }
                        }
                    } else if let Some(position) = latest.target.position_xyz_m {
                        filtered_position = Some(position);
                        frame.ee_position_xyz_m = position;
                    }
                } else {
                    frame.sequence_applied = None;
                    frame.stale_target = true;
                    filtered_position = None;
                }

                let loop_elapsed = loop_start.elapsed();
                frame.overrun = loop_elapsed > period;

                {
                    let mut shared = latest_telemetry
                        .write()
                        .expect("latest_telemetry lock poisoned");
                    *shared = frame.clone();
                }

                tick_index = tick_index.wrapping_add(1);
                if tick_index % telemetry_stride == 0 {
                    let _ = telemetry_tx.send(frame);
                }
            }
        })
    }
}

pub fn now_unix_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_ns_is_non_zero() {
        assert!(now_unix_ns() > 0);
    }
}
