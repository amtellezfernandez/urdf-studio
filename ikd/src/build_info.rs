use std::env;

pub fn build_sha() -> String {
    env::var("URDF_STUDIO_BUILD_SHA")
        .or_else(|_| env::var("VERCEL_GIT_COMMIT_SHA"))
        .or_else(|_| env::var("GITHUB_SHA"))
        .or_else(|_| env::var("CF_PAGES_COMMIT_SHA"))
        .or_else(|_| env::var("SOURCE_VERSION"))
        .unwrap_or_else(|_| "dev".to_string())
}
