use std::collections::BTreeMap;
use std::io::{self, Read};

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct SourceInput {
    source_id: String,
    canonical_source: String,
    content_fingerprint: Option<String>,
}

#[derive(Debug, Serialize)]
struct ClusteredSource {
    source_id: String,
    canonical_source: String,
    canonical_fingerprint: String,
    duplicate_group_id: Option<String>,
    duplicate_group_size: usize,
    duplicate_match_kind: Option<&'static str>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("failed to read stdin: {error}"))?;

    let sources: Vec<SourceInput> =
        serde_json::from_str(&input).map_err(|error| format!("invalid JSON input: {error}"))?;

    let mut counts = BTreeMap::<String, usize>::new();
    let mut normalized_counts = BTreeMap::<String, usize>::new();
    let mut content_fingerprint_counts = BTreeMap::<String, usize>::new();
    let normalized_sources: Vec<String> = sources
        .iter()
        .map(|source| normalize_source_key(&source.canonical_source))
        .collect();
    for source in &sources {
        *counts.entry(source.canonical_source.clone()).or_insert(0) += 1;
    }
    for normalized_source in &normalized_sources {
        *normalized_counts
            .entry(normalized_source.clone())
            .or_insert(0) += 1;
    }
    for source in &sources {
        if let Some(content_fingerprint) =
            normalize_content_fingerprint(source.content_fingerprint.as_deref())
        {
            *content_fingerprint_counts
                .entry(content_fingerprint)
                .or_insert(0) += 1;
        }
    }

    let mut duplicate_group_ids = BTreeMap::<String, String>::new();
    let mut normalized_duplicate_group_ids = BTreeMap::<String, String>::new();
    let mut content_duplicate_group_ids = BTreeMap::<String, String>::new();
    let mut next_group_index = 0usize;
    let mut next_normalized_group_index = 0usize;
    let mut next_content_group_index = 0usize;
    let mut clustered = Vec::with_capacity(sources.len());

    for (source, normalized_source) in sources.into_iter().zip(normalized_sources.into_iter()) {
        let duplicate_group_size = *counts.get(&source.canonical_source).unwrap_or(&1usize);
        let normalized_duplicate_group_size =
            *normalized_counts.get(&normalized_source).unwrap_or(&1usize);
        let normalized_content_fingerprint =
            normalize_content_fingerprint(source.content_fingerprint.as_deref());
        let content_duplicate_group_size = normalized_content_fingerprint
            .as_ref()
            .and_then(|value| content_fingerprint_counts.get(value))
            .copied()
            .unwrap_or(0usize);
        let (duplicate_group_id, resolved_duplicate_group_size, duplicate_match_kind) =
            if let Some(content_fingerprint) = normalized_content_fingerprint.as_ref() {
                if content_duplicate_group_size > 1 {
                    let entry = content_duplicate_group_ids
                        .entry(content_fingerprint.clone())
                        .or_insert_with(|| {
                            let group_id = format!("dup:content:{next_content_group_index}");
                            next_content_group_index += 1;
                            group_id
                        });
                    (
                        Some(entry.clone()),
                        content_duplicate_group_size,
                        Some("exact"),
                    )
                } else {
                    (None, 1usize, None)
                }
            } else if duplicate_group_size > 1 {
                let entry = duplicate_group_ids
                    .entry(source.canonical_source.clone())
                    .or_insert_with(|| {
                        let group_id = format!("dup:{next_group_index}");
                        next_group_index += 1;
                        group_id
                    });
                (Some(entry.clone()), duplicate_group_size, Some("exact"))
            } else if normalized_duplicate_group_size > 1 {
                let entry = normalized_duplicate_group_ids
                    .entry(normalized_source.clone())
                    .or_insert_with(|| {
                        let group_id = format!("dup:normalized:{next_normalized_group_index}");
                        next_normalized_group_index += 1;
                        group_id
                    });
                (
                    Some(entry.clone()),
                    normalized_duplicate_group_size,
                    Some("normalized"),
                )
            } else {
                (None, 1usize, None)
            };

        clustered.push(ClusteredSource {
            source_id: source.source_id,
            canonical_source: source.canonical_source,
            canonical_fingerprint: normalized_content_fingerprint
                .unwrap_or_else(|| fingerprint_source_key(&normalized_source)),
            duplicate_group_id,
            duplicate_group_size: resolved_duplicate_group_size,
            duplicate_match_kind,
        });
    }

    let output = serde_json::to_string(&clustered)
        .map_err(|error| format!("failed to serialize result: {error}"))?;
    println!("{output}");
    Ok(())
}

fn normalize_source_key(value: &str) -> String {
    let mut normalized = value.trim().replace('\\', "/");
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    normalized = normalized.trim_end_matches('/').to_string();
    if normalized.starts_with('/') {
        normalized
    } else {
        normalized.to_lowercase()
    }
}

fn fingerprint_source_key(value: &str) -> String {
    let mut hash: u64 = 1_469_598_103_934_665_603;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1_099_511_628_211);
    }
    format!("{hash:016x}")
}

fn normalize_content_fingerprint(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim().to_lowercase();
    if normalized.len() != 16 {
        return None;
    }
    if !normalized
        .chars()
        .all(|character| character.is_ascii_hexdigit())
    {
        return None;
    }
    Some(normalized)
}
