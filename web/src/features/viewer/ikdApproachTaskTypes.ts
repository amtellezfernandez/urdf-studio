export const IKD_APPROACH_SCHEMA_VERSION = "1";

export type IkdApproachObjectType = "cube" | "point" | "sphere" | "cylinder";
export type IkdApproachTargetMode =
  | "punctual"
  | "orbit_center"
  | "orbit_primary"
  | "orbit_secondary";
export type IkdApproachTaskState = "locked" | "cancelled";
export type IkdApproachEventKind =
  | "snapshot"
  | "scene_published"
  | "task_started"
  | "task_cancelled";

export type IkdApproachSceneObject = {
  id: string;
  object_type: IkdApproachObjectType;
  position_xyz_m: [number, number, number];
  rotation_rpy_rad?: [number, number, number];
  size_xyz_m: [number, number, number];
  is_hidden: boolean;
  orbit_radius_m?: number;
  orbit_inclination_deg?: number;
  orbit_phase_deg?: number;
  orbit_secondary_offset_deg?: number;
};

export type IkdApproachTaskSnapshot = {
  schema_version: string;
  task_id: number;
  scene_revision: number;
  object_id: string;
  target_mode: IkdApproachTargetMode;
  state: IkdApproachTaskState;
  object: IkdApproachSceneObject;
  object_target_position_xyz_m: [number, number, number];
  created_at_ts_ns: number;
  updated_at_ts_ns: number;
};

export type IkdApproachTaskEvent = {
  schema_version: string;
  event_kind: IkdApproachEventKind;
  scene_revision?: number | null;
  object_count?: number | null;
  task?: IkdApproachTaskSnapshot | null;
  emitted_at_ts_ns: number;
};
