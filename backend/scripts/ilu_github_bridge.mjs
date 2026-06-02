#!/usr/bin/env node

import process from "node:process";
import { urdfCore } from "../../tools/scripts/urdfCoreModules.js";

const {
  fetchGitHubFileBytes,
  fetchGitHubRepositoryFiles,
  findRepositoryUrdfCandidates,
} = urdfCore;

const readJsonStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  const raw = chunks.join("").trim();
  return raw ? JSON.parse(raw) : {};
};

const fail = (message, code = 2) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const inferMimeType = (filePath) => {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".urdf") || lower.endsWith(".xml") || lower.endsWith(".xacro")) {
    return "application/xml";
  }
  if (lower.endsWith(".stl")) return "model/stl";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "application/yaml";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
};

const main = async () => {
  const command = process.argv[2];
  if (!command) {
    fail("Missing bridge command.");
  }

  const payload = await readJsonStdin();
  const owner = String(payload.owner || "").trim();
  const repo = String(payload.repo || "").trim();
  const accessToken = typeof payload.accessToken === "string" ? payload.accessToken : undefined;

  if (!owner || !repo) {
    fail("Bridge requires owner and repo.");
  }

  if (command === "repo-contents") {
    const path = typeof payload.path === "string" ? payload.path : undefined;
    const branch = typeof payload.branch === "string" ? payload.branch : undefined;
    const result = await fetchGitHubRepositoryFiles(
      {
        owner,
        repo,
        path,
        ref: branch,
      },
      accessToken
    );
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === "repo-candidates") {
    const path = typeof payload.path === "string" ? payload.path : undefined;
    const branch = typeof payload.branch === "string" ? payload.branch : undefined;
    const result = await fetchGitHubRepositoryFiles(
      {
        owner,
        repo,
        path,
        ref: branch,
      },
      accessToken
    );
    process.stdout.write(
      JSON.stringify({
        ref: typeof result.ref === "string" ? result.ref : branch ?? null,
        candidates: findRepositoryUrdfCandidates(result.files),
      })
    );
    return;
  }

  if (command === "file-bytes") {
    const filePath = String(payload.path || "").trim();
    const sha = typeof payload.sha === "string" ? payload.sha : undefined;
    if (!filePath) {
      fail("Bridge requires path for file-bytes.");
    }
    const bytes = await fetchGitHubFileBytes(owner, repo, filePath, sha, accessToken);
    process.stdout.write(
      JSON.stringify({
        contentBase64: Buffer.from(bytes).toString("base64"),
        mimeType: inferMimeType(filePath),
      })
    );
    return;
  }

  fail(`Unsupported bridge command: ${command}`);
};

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error), 1);
});
