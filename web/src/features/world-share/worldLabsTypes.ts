import type { WorldScenePackageManifest } from "@/features/world-share/worldScenePackageTypes";

export type WorldLabsCapabilitiesResponse = {
  available: boolean;
  configured: boolean;
  provider: "world-labs";
  marble_url: string;
  docs_url: string;
  generate_endpoint: string;
  default_model: string;
  models: string[];
  missing_reason?: string | null;
};

export type WorldLabsGenerateRequest = {
  prompt: string;
  display_name: string;
  model?: string;
  seed?: number | null;
  tags?: string[];
  public?: boolean;
  allow_id_access?: boolean;
  disable_recaption?: boolean;
};

export type WorldLabsGenerateResponse = {
  operation_id: string;
  created_at?: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
  status_url: string;
  raw_response: Record<string, unknown>;
};

export type WorldLabsOperationStatusResponse = {
  operation_id: string;
  done: boolean;
  error?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  world_id?: string | null;
  world_marble_url?: string | null;
  thumbnail_url?: string | null;
  collider_mesh_url?: string | null;
  metric_scale_factor?: number | null;
  ground_plane_offset?: number | null;
  world_package?: WorldScenePackageManifest | null;
  raw_response: Record<string, unknown>;
};

export type WorldLabsWorldSummary = {
  world_id: string;
  display_name?: string | null;
  world_marble_url?: string | null;
  thumbnail_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  public?: boolean | null;
  raw_world: Record<string, unknown>;
};

export type WorldLabsListWorldsRequest = {
  page_size?: number;
  page_token?: string | null;
  tags?: string[];
};

export type WorldLabsListWorldsResponse = {
  worlds: WorldLabsWorldSummary[];
  next_page_token?: string | null;
  raw_response: Record<string, unknown>;
};

export type WorldLabsWorldImportResponse = {
  world_id: string;
  world_marble_url?: string | null;
  thumbnail_url?: string | null;
  collider_mesh_url?: string | null;
  metric_scale_factor?: number | null;
  ground_plane_offset?: number | null;
  world_package: WorldScenePackageManifest;
  raw_world: Record<string, unknown>;
};
