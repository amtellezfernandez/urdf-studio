use std::collections::{BTreeMap, HashMap, HashSet};

use nalgebra::{DMatrix, Isometry3, Translation3, Unit, UnitQuaternion, Vector3};
use roxmltree::Document;
use thiserror::Error;

// Control-loop mode: run bounded DLS updates each tick for smooth and stable motion.
const DEFAULT_MAX_ITERATIONS: usize = 5;
const DEFAULT_TOLERANCE_M: f64 = 0.003;
const BASE_DLS_DAMPING: f64 = 0.03;
const DLS_GAIN: f64 = 0.85;
const MAX_STEP_RAD_HARD: f64 = 0.05;
const MAX_STEP_LINEAR_HARD: f64 = 0.006;
const MAX_JOINT_SPEED_RAD_S: f64 = 4.0;
const MAX_JOINT_SPEED_M_S: f64 = 0.4;
const EPS: f64 = 1e-8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum JointKind {
    Revolute,
    Prismatic,
    Continuous,
    Fixed,
}

impl JointKind {
    fn from_urdf(raw: &str) -> Option<Self> {
        match raw {
            "revolute" => Some(Self::Revolute),
            "prismatic" => Some(Self::Prismatic),
            "continuous" => Some(Self::Continuous),
            "fixed" => Some(Self::Fixed),
            _ => None,
        }
    }

    fn is_actuated(self) -> bool {
        matches!(self, Self::Revolute | Self::Prismatic | Self::Continuous)
    }
}

#[derive(Debug, Clone)]
struct JointSpec {
    name: String,
    parent: String,
    child: String,
    kind: JointKind,
    axis: Vector3<f64>,
    origin: Isometry3<f64>,
    lower: Option<f64>,
    upper: Option<f64>,
    mimic: bool,
}

#[derive(Debug, Clone)]
struct ChainModel {
    target_link: String,
    joints: Vec<JointSpec>,
    chain_root_to_target: Vec<usize>,
    actuated_distal_to_proximal: Vec<usize>,
    actuated_joint_names: Vec<String>,
}

#[derive(Debug, Clone)]
struct ForwardState {
    ee_position: Vector3<f64>,
    joint_positions: Vec<Option<Vector3<f64>>>,
    axis_world: Vec<Option<Vector3<f64>>>,
}

#[derive(Debug, Clone)]
pub struct AmikStepResult {
    pub joint_values: BTreeMap<String, f64>,
    pub ee_position: [f64; 3],
    pub residual_position_m: f64,
    pub iterations: usize,
    pub limit_clamp_count: u32,
}

#[derive(Debug, Clone)]
pub struct ModelLoadResult {
    pub target_link: String,
    pub actuated_joint_names: Vec<String>,
    pub initial_ee_position: [f64; 3],
}

#[derive(Debug, Default)]
pub struct AmikRuntime {
    model: Option<ChainModel>,
    joint_values: BTreeMap<String, f64>,
}

#[derive(Debug, Error)]
pub enum AmikError {
    #[error("URDF parse failed: {0}")]
    UrdfParse(String),
    #[error("Target link '{0}' not found in URDF")]
    TargetLinkNotFound(String),
    #[error("Unsupported joint type '{0}'")]
    UnsupportedJointType(String),
    #[error("No chain found for target link '{0}'")]
    ChainNotFound(String),
    #[error("No actuated joints found on chain to target link '{0}'")]
    NoActuatedJoints(String),
    #[error("No model loaded")]
    ModelNotLoaded,
}

impl AmikRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_loaded(&self) -> bool {
        self.model.is_some()
    }

    pub fn load_model(
        &mut self,
        urdf_xml: &str,
        target_link: &str,
        seed_joint_values: &BTreeMap<String, f64>,
    ) -> Result<ModelLoadResult, AmikError> {
        let model = parse_model(urdf_xml, target_link)?;

        let mut joint_values = BTreeMap::new();
        for joint_name in &model.actuated_joint_names {
            joint_values.insert(
                joint_name.clone(),
                *seed_joint_values.get(joint_name).unwrap_or(&0.0),
            );
        }

        let state = model.forward_state(&joint_values);
        let ee = state.ee_position;

        self.joint_values = joint_values;
        self.model = Some(model.clone());

        Ok(ModelLoadResult {
            target_link: model.target_link,
            actuated_joint_names: model.actuated_joint_names,
            initial_ee_position: [ee.x, ee.y, ee.z],
        })
    }

    pub fn step_towards(
        &mut self,
        target_position: [f64; 3],
        dt_s: f64,
    ) -> Result<AmikStepResult, AmikError> {
        let model = self.model.as_ref().ok_or(AmikError::ModelNotLoaded)?;
        let target = Vector3::new(target_position[0], target_position[1], target_position[2]);
        let safe_dt = if dt_s.is_finite() {
            dt_s.clamp(1.0 / 2000.0, 1.0 / 30.0)
        } else {
            1.0 / 500.0
        };
        let max_step_rad = (MAX_JOINT_SPEED_RAD_S * safe_dt).clamp(0.001, MAX_STEP_RAD_HARD);
        let max_step_linear = (MAX_JOINT_SPEED_M_S * safe_dt).clamp(0.0002, MAX_STEP_LINEAR_HARD);
        let mut limit_clamp_count: u32 = 0;
        let mut iterations = 0usize;

        for iter_idx in 0..DEFAULT_MAX_ITERATIONS {
            iterations = iter_idx + 1;
            let current_state = model.forward_state(&self.joint_values);
            let error = target - current_state.ee_position;
            let error_norm = error.norm();
            if error_norm <= DEFAULT_TOLERANCE_M {
                break;
            }

            let ee = current_state.ee_position;
            let mut active_joint_indices = Vec::new();
            let mut jacobian_cols = Vec::new();

            for &joint_idx in &model.actuated_distal_to_proximal {
                let joint_pos = match current_state
                    .joint_positions
                    .get(joint_idx)
                    .and_then(|p| *p)
                {
                    Some(v) => v,
                    None => continue,
                };
                let mut axis_world = match current_state.axis_world.get(joint_idx).and_then(|a| *a)
                {
                    Some(v) => v,
                    None => continue,
                };

                let axis_len = axis_world.norm();
                if !axis_len.is_finite() || axis_len < EPS {
                    continue;
                }
                axis_world /= axis_len;

                let joint = &model.joints[joint_idx];
                let jcol = match joint.kind {
                    JointKind::Revolute | JointKind::Continuous => {
                        axis_world.cross(&(ee - joint_pos))
                    }
                    JointKind::Prismatic => axis_world,
                    JointKind::Fixed => continue,
                };

                if !jcol.iter().all(|v| v.is_finite()) {
                    continue;
                }

                active_joint_indices.push(joint_idx);
                jacobian_cols.push(jcol);
            }

            if active_joint_indices.is_empty() {
                break;
            }

            let n = active_joint_indices.len();
            let mut j = DMatrix::<f64>::zeros(3, n);
            for (col, vec) in jacobian_cols.iter().enumerate() {
                j[(0, col)] = vec.x;
                j[(1, col)] = vec.y;
                j[(2, col)] = vec.z;
            }

            let damping = BASE_DLS_DAMPING + (error_norm * 0.12);
            let jt = j.transpose();
            let mut h = &jt * &j;
            let g = &jt * error;
            for i in 0..n {
                h[(i, i)] += damping * damping;
            }

            let mut dq = match h.lu().solve(&g) {
                Some(v) => v,
                None => break,
            };

            for (i, &joint_idx) in active_joint_indices.iter().enumerate() {
                let joint = &model.joints[joint_idx];
                let max_step = match joint.kind {
                    JointKind::Prismatic => max_step_linear,
                    JointKind::Revolute | JointKind::Continuous => max_step_rad,
                    JointKind::Fixed => 0.0,
                };
                dq[i] = clamp(dq[i] * DLS_GAIN, -max_step, max_step);
            }

            if dq.iter().all(|delta| delta.abs() < 1e-6) {
                break;
            }

            let mut best_candidate: Option<BTreeMap<String, f64>> = None;
            let mut best_residual = f64::INFINITY;
            let mut best_clamps = 0u32;
            for alpha in [1.0, 0.7, 0.45, 0.25] {
                let mut candidate = self.joint_values.clone();
                let mut local_clamps = 0u32;
                let mut changed = false;

                for (i, &joint_idx) in active_joint_indices.iter().enumerate() {
                    let delta = dq[i] * alpha;
                    if delta.abs() < 1e-7 {
                        continue;
                    }
                    let joint = &model.joints[joint_idx];
                    let current_value = *candidate.get(&joint.name).unwrap_or(&0.0);
                    let next_value = current_value + delta;
                    let clamped = clamp_to_limits(joint, next_value);
                    if (clamped - next_value).abs() > EPS {
                        local_clamps = local_clamps.saturating_add(1);
                    }
                    if (clamped - current_value).abs() > 1e-8 {
                        candidate.insert(joint.name.clone(), clamped);
                        changed = true;
                    }
                }

                if !changed {
                    continue;
                }

                let candidate_state = model.forward_state(&candidate);
                let candidate_residual = (candidate_state.ee_position - target).norm();
                if candidate_residual.is_finite() && candidate_residual < best_residual {
                    best_residual = candidate_residual;
                    best_candidate = Some(candidate);
                    best_clamps = local_clamps;
                }
            }

            let Some(candidate) = best_candidate else {
                break;
            };
            // Accept the best candidate even with tiny non-improvement to avoid stall at small dt limits.
            if best_residual > error_norm + 5e-5 {
                break;
            }

            self.joint_values = candidate;
            limit_clamp_count = limit_clamp_count.saturating_add(best_clamps);
        }

        let solved_state = model.forward_state(&self.joint_values);
        let residual = (solved_state.ee_position - target).norm();

        Ok(AmikStepResult {
            joint_values: self.joint_values.clone(),
            ee_position: [
                solved_state.ee_position.x,
                solved_state.ee_position.y,
                solved_state.ee_position.z,
            ],
            residual_position_m: residual,
            iterations,
            limit_clamp_count,
        })
    }
}

impl ChainModel {
    fn forward_state(&self, joint_values: &BTreeMap<String, f64>) -> ForwardState {
        let mut t_world_link = Isometry3::<f64>::identity();
        let mut joint_positions = vec![None; self.joints.len()];
        let mut axis_world = vec![None; self.joints.len()];

        for &joint_idx in &self.chain_root_to_target {
            let joint = &self.joints[joint_idx];
            let t_joint = t_world_link * joint.origin;

            joint_positions[joint_idx] = Some(t_joint.translation.vector);
            axis_world[joint_idx] = Some(t_joint.rotation * joint.axis);

            let q = *joint_values.get(&joint.name).unwrap_or(&0.0);
            let motion = joint_motion(joint, q);
            t_world_link = t_joint * motion;
        }

        ForwardState {
            ee_position: t_world_link.translation.vector,
            joint_positions,
            axis_world,
        }
    }
}

fn joint_motion(joint: &JointSpec, q: f64) -> Isometry3<f64> {
    match joint.kind {
        JointKind::Fixed => Isometry3::identity(),
        JointKind::Prismatic => {
            let d = joint.axis * q;
            Isometry3::from_parts(Translation3::new(d.x, d.y, d.z), UnitQuaternion::identity())
        }
        JointKind::Revolute | JointKind::Continuous => {
            let axis = if joint.axis.norm() > EPS {
                Unit::new_normalize(joint.axis)
            } else {
                Unit::new_normalize(Vector3::new(0.0, 0.0, 1.0))
            };
            let rotation = UnitQuaternion::from_axis_angle(&axis, q);
            Isometry3::from_parts(Translation3::new(0.0, 0.0, 0.0), rotation)
        }
    }
}

fn clamp_to_limits(joint: &JointSpec, value: f64) -> f64 {
    if matches!(joint.kind, JointKind::Continuous) {
        return value;
    }

    match (joint.lower, joint.upper) {
        (Some(lower), Some(upper)) => clamp(value, lower, upper),
        _ => value,
    }
}

fn clamp(value: f64, lower: f64, upper: f64) -> f64 {
    lower.max(upper.min(value))
}

fn parse_model(urdf_xml: &str, target_link: &str) -> Result<ChainModel, AmikError> {
    let doc = Document::parse(urdf_xml).map_err(|e| AmikError::UrdfParse(e.to_string()))?;

    let mut links = HashSet::new();
    for node in doc.descendants().filter(|n| n.has_tag_name("link")) {
        if let Some(name) = node.attribute("name") {
            links.insert(name.to_string());
        }
    }

    if !links.contains(target_link) {
        return Err(AmikError::TargetLinkNotFound(target_link.to_string()));
    }

    let mut joints = Vec::new();
    for joint_node in doc.descendants().filter(|n| n.has_tag_name("joint")) {
        let name = joint_node
            .attribute("name")
            .ok_or_else(|| AmikError::UrdfParse("joint missing name".to_string()))?
            .to_string();

        let parent = find_link_attribute(&joint_node, "parent");
        let child = find_link_attribute(&joint_node, "child");

        // Skip non-kinematic joint tags such as transmission/control blocks.
        let (parent, child) = match (parent, child) {
            (Some(parent), Some(child)) => (parent, child),
            _ => continue,
        };

        let joint_type_raw = find_attribute_loose(&joint_node, "type")
            .ok_or_else(|| AmikError::UrdfParse(format!("joint '{name}' missing type")))?;
        let kind = JointKind::from_urdf(&joint_type_raw)
            .ok_or_else(|| AmikError::UnsupportedJointType(joint_type_raw.to_string()))?;

        let origin_xyz = find_pose_component(&joint_node, "origin", "xyz")
            .map(parse_vec3)
            .transpose()?
            .unwrap_or_else(|| Vector3::new(0.0, 0.0, 0.0));
        let origin_rpy = find_pose_component(&joint_node, "origin", "rpy")
            .map(parse_vec3)
            .transpose()?
            .unwrap_or_else(|| Vector3::new(0.0, 0.0, 0.0));

        let origin_rot =
            UnitQuaternion::from_euler_angles(origin_rpy.x, origin_rpy.y, origin_rpy.z);
        let origin = Isometry3::from_parts(
            Translation3::new(origin_xyz.x, origin_xyz.y, origin_xyz.z),
            origin_rot,
        );

        let axis = find_pose_component(&joint_node, "axis", "xyz")
            .map(parse_vec3)
            .transpose()?
            .unwrap_or_else(|| Vector3::new(1.0, 0.0, 0.0));

        let lower = find_pose_component(&joint_node, "limit", "lower")
            .map(parse_scalar)
            .transpose()?;
        let upper = find_pose_component(&joint_node, "limit", "upper")
            .map(parse_scalar)
            .transpose()?;

        let mimic = joint_node.children().any(|c| c.has_tag_name("mimic"));

        joints.push(JointSpec {
            name,
            parent,
            child,
            kind,
            axis,
            origin,
            lower,
            upper,
            mimic,
        });
    }

    let mut child_to_joint: HashMap<String, usize> = HashMap::new();
    for (idx, joint) in joints.iter().enumerate() {
        child_to_joint.insert(joint.child.clone(), idx);
    }

    let mut chain_distal_to_proximal_all = Vec::new();
    let mut cursor = target_link.to_string();
    let mut visited = HashSet::new();

    while let Some(joint_idx) = child_to_joint.get(&cursor).copied() {
        if !visited.insert(joint_idx) {
            break;
        }

        chain_distal_to_proximal_all.push(joint_idx);
        cursor = joints[joint_idx].parent.clone();
    }

    if chain_distal_to_proximal_all.is_empty() {
        return Err(AmikError::ChainNotFound(target_link.to_string()));
    }

    let mut chain_root_to_target = chain_distal_to_proximal_all.clone();
    chain_root_to_target.reverse();

    let actuated_distal_to_proximal = chain_distal_to_proximal_all
        .iter()
        .copied()
        .filter(|idx| {
            let joint = &joints[*idx];
            joint.kind.is_actuated() && !joint.mimic
        })
        .collect::<Vec<_>>();

    let mut actuated_joint_names = Vec::new();
    for idx in &chain_root_to_target {
        let joint = &joints[*idx];
        if joint.kind.is_actuated() && !joint.mimic {
            actuated_joint_names.push(joint.name.clone());
        }
    }

    if actuated_joint_names.is_empty() {
        return Err(AmikError::NoActuatedJoints(target_link.to_string()));
    }

    Ok(ChainModel {
        target_link: target_link.to_string(),
        joints,
        chain_root_to_target,
        actuated_distal_to_proximal,
        actuated_joint_names,
    })
}

fn find_link_attribute<'a, 'i>(
    joint_node: &roxmltree::Node<'a, 'i>,
    child_tag: &str,
) -> Option<String> {
    joint_node
        .children()
        .find(|n| n.has_tag_name(child_tag))
        .and_then(|n| n.attribute("link"))
        .map(|s| s.to_string())
}

fn find_pose_component<'a, 'i>(
    joint_node: &roxmltree::Node<'a, 'i>,
    child_tag: &str,
    attr: &str,
) -> Option<String> {
    joint_node
        .children()
        .find(|n| n.has_tag_name(child_tag))
        .and_then(|n| n.attribute(attr))
        .map(|s| s.to_string())
}

fn find_attribute_loose<'a, 'i>(node: &roxmltree::Node<'a, 'i>, attr: &str) -> Option<String> {
    if let Some(value) = node.attribute(attr) {
        return Some(value.to_string());
    }

    let suffix = format!(":{attr}");
    for candidate in node.attributes() {
        let name = candidate.name();
        if name == attr || name.ends_with(&suffix) {
            return Some(candidate.value().to_string());
        }
    }
    None
}

fn parse_scalar(raw: String) -> Result<f64, AmikError> {
    raw.parse::<f64>()
        .map_err(|_| AmikError::UrdfParse(format!("Invalid scalar '{raw}'")))
}

fn parse_vec3(raw: String) -> Result<Vector3<f64>, AmikError> {
    let parts = raw
        .split_whitespace()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();

    if parts.len() != 3 {
        return Err(AmikError::UrdfParse(format!("Invalid vec3 '{raw}'")));
    }

    let x = parts[0]
        .parse::<f64>()
        .map_err(|_| AmikError::UrdfParse(format!("Invalid vec3 '{raw}'")))?;
    let y = parts[1]
        .parse::<f64>()
        .map_err(|_| AmikError::UrdfParse(format!("Invalid vec3 '{raw}'")))?;
    let z = parts[2]
        .parse::<f64>()
        .map_err(|_| AmikError::UrdfParse(format!("Invalid vec3 '{raw}'")))?;
    Ok(Vector3::new(x, y, z))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TWO_LINK_URDF: &str = r#"
<robot name="demo">
  <link name="base"/>
  <link name="l1"/>
  <link name="l2"/>
  <link name="ee"/>
  <joint name="j1" type="revolute">
    <parent link="base"/>
    <child link="l1"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14"/>
  </joint>
  <joint name="j2" type="revolute">
    <parent link="l1"/>
    <child link="l2"/>
    <origin xyz="1 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14"/>
  </joint>
  <joint name="j3" type="fixed">
    <parent link="l2"/>
    <child link="ee"/>
    <origin xyz="1 0 0" rpy="0 0 0"/>
  </joint>
</robot>
"#;

    const MISSING_TYPE_URDF: &str = r#"
<robot name="demo_missing_type">
  <link name="base"/>
  <link name="l1"/>
  <link name="ee"/>
  <joint name="j1" type="revolute">
    <parent link="base"/>
    <child link="l1"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14"/>
  </joint>
  <joint name="gripper">
    <parent link="l1"/>
    <child link="ee"/>
    <origin xyz="0.2 0 0" rpy="0 0 0"/>
  </joint>
</robot>
"#;

    const TRANSMISSION_JOINT_URDF: &str = r#"
<robot name="demo_transmission">
  <link name="base"/>
  <link name="l1"/>
  <link name="ee"/>
  <joint name="gripper" type="revolute">
    <parent link="base"/>
    <child link="l1"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-1.57" upper="1.57"/>
  </joint>
  <joint name="tip_fixed" type="fixed">
    <parent link="l1"/>
    <child link="ee"/>
    <origin xyz="0.2 0 0" rpy="0 0 0"/>
  </joint>
  <transmission name="gripper_trans">
    <type>transmission_interface/SimpleTransmission</type>
    <joint name="gripper">
      <hardwareInterface>PositionJointInterface</hardwareInterface>
    </joint>
  </transmission>
</robot>
"#;

    const FIXED_CHAIN_URDF: &str = r#"
<robot name="fixed_chain">
  <link name="base"/>
  <link name="mid"/>
  <link name="ee"/>
  <joint name="j_fixed_1" type="fixed">
    <parent link="base"/>
    <child link="mid"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
  </joint>
  <joint name="j_fixed_2" type="fixed">
    <parent link="mid"/>
    <child link="ee"/>
    <origin xyz="0.2 0 0" rpy="0 0 0"/>
  </joint>
</robot>
"#;

    #[test]
    fn model_parses_and_chain_is_found() {
        let model = parse_model(TWO_LINK_URDF, "ee").expect("model parse failed");
        assert_eq!(model.target_link, "ee");
        assert_eq!(model.actuated_joint_names, vec!["j1", "j2"]);
        assert_eq!(model.chain_root_to_target.len(), 3);
    }

    #[test]
    fn amik_moves_towards_target() {
        let mut amik = AmikRuntime::new();
        amik.load_model(TWO_LINK_URDF, "ee", &BTreeMap::new())
            .expect("model load failed");

        let result = amik
            .step_towards([1.3, 0.5, 0.0], 1.0 / 500.0)
            .expect("step failed");

        assert!(result.residual_position_m < 0.9);
        assert!(result.joint_values.values().any(|v| v.abs() > 1e-4));
        assert!(result.joint_values.contains_key("j1"));
        assert!(result.joint_values.contains_key("j2"));
    }

    #[test]
    fn kinematic_joint_missing_type_is_rejected() {
        let mut amik = AmikRuntime::new();
        let err = amik
            .load_model(MISSING_TYPE_URDF, "ee", &BTreeMap::new())
            .expect_err("kinematic joint without type should be rejected");
        assert!(format!("{err}").contains("missing type"));
    }

    #[test]
    fn transmission_joint_blocks_are_ignored() {
        let mut amik = AmikRuntime::new();
        let load = amik
            .load_model(TRANSMISSION_JOINT_URDF, "ee", &BTreeMap::new())
            .expect("model should ignore transmission joint blocks");

        assert!(load.actuated_joint_names.contains(&"gripper".to_string()));
        assert_eq!(load.actuated_joint_names.len(), 1);
    }

    #[test]
    fn fixed_only_chain_is_rejected() {
        let mut amik = AmikRuntime::new();
        let err = amik
            .load_model(FIXED_CHAIN_URDF, "ee", &BTreeMap::new())
            .expect_err("fixed-only chain should be rejected");
        assert!(matches!(err, AmikError::NoActuatedJoints(_)));
    }
}
