export const KITCHEN_XML_EXTENSION = ".xml";
export const KITCHEN_STL_EXTENSION = ".stl";
export const KITCHEN_GENERATED_URDF_EXTENSION = ".kitchen.urdf";
export const KITCHEN_GENERATED_URDF_MIME_TYPE = "application/xml";

export const KITCHEN_DEFAULT_ROBOT_NAME = "kitchen_robot";
export const KITCHEN_DESCRIPTION_SUFFIX = "_description";
export const KITCHEN_URDF_DIRECTORY = "urdf";
export const KITCHEN_MESHES_DIRECTORY = "meshes";
export const KITCHEN_BASE_LINK_NAME = "base_link";

export const KITCHEN_PROJECT_ROOT_TAG = "project";
export const KITCHEN_PART_ROOT_TAG = "urdf_part";
export const KITCHEN_PROJECT_NODES_TAG = "nodes";
export const KITCHEN_PROJECT_CONNECTIONS_TAG = "connections";

export const KITCHEN_BASE_LINK_INERTIA = {
  ixx: 0,
  ixy: 0,
  ixz: 0,
  iyy: 0,
  iyz: 0,
  izz: 0,
} as const;

export const KITCHEN_VECTOR_X_INDEX = 0;
export const KITCHEN_VECTOR_Y_INDEX = 1;
export const KITCHEN_VECTOR_Z_INDEX = 2;
export const KITCHEN_VECTOR_LENGTH = 3;
export const KITCHEN_VECTOR_ZERO_VALUE = 0;
export const KITCHEN_POINT_NAME_INDEX_OFFSET = 1;
export const KITCHEN_OUTPUT_PORT_INDEX_OFFSET = 1;
export const KITCHEN_SINGULAR_PART_COUNT = 1;
export const KITCHEN_RGB_MAX = 1;
export const KITCHEN_RGB_MIN = 0;
export const KITCHEN_RGB_HEX_RADIX = 16;
export const KITCHEN_RGB_HEX_WIDTH = 2;
export const KITCHEN_RGB_BYTE_MAX = 255;

export const KITCHEN_FIXED_ROTATION_AXIS_ID = 3;
export const KITCHEN_X_ROTATION_AXIS_ID = 0;
export const KITCHEN_Y_ROTATION_AXIS_ID = 1;
export const KITCHEN_Z_ROTATION_AXIS_ID = 2;
export const KITCHEN_AXIS_BY_ROTATION_ID = {
  [KITCHEN_X_ROTATION_AXIS_ID]: [1, 0, 0],
  [KITCHEN_Y_ROTATION_AXIS_ID]: [0, 1, 0],
  [KITCHEN_Z_ROTATION_AXIS_ID]: [0, 0, 1],
} as const;

export const KITCHEN_URDF_REVOLUTE_LIMIT_LOWER_RAD = -Math.PI;
export const KITCHEN_URDF_REVOLUTE_LIMIT_UPPER_RAD = Math.PI;
export const KITCHEN_URDF_DEFAULT_EFFORT = 0;
export const KITCHEN_URDF_DEFAULT_VELOCITY = 0;

export const KITCHEN_NUMBER_DECIMAL_PLACES = 6;
export const KITCHEN_NUMBER_EPSILON = 1e-12;
export const KITCHEN_XML_PARSE_ERROR_SELECTOR = "parsererror";
export const KITCHEN_OUTPUT_PORT_PREFIX = "out_";
export const KITCHEN_WARNING_TOAST_DURATION_MS = 8000;
