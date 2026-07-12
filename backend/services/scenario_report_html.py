"""Self-contained HTML comparison report for a cross-simulator scenario run.

Reads a run directory produced by ``scenario_run`` (run.json, comparison.json,
the staged world package, and per-sim per-episode trace.ndjson / report.json)
and emits a single standalone .html file: no server, no network, opens
offline. It shows the success/divergence summary and a synchronized top-down +
side-view playback of every simulator's recorded object trajectories, so the
cross-simulator divergence is something you watch rather than read.

Trajectory data is embedded inline as JSON; rendering is plain canvas 2D
(rigid boxes/spheres/cylinders in orthographic projection), which keeps the
file dependency-free and correct for the primitive scenes the format targets.
"""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

REPORT_SCHEMA = "scenario_report_html.v1"
_MAX_TRAJECTORY_SAMPLES = 240

# Colorblind-safe categorical hues assigned per simulator (Okabe-Ito subset).
_SIM_COLORS = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00"]


class ScenarioReportError(ValueError):
    ...


def build_run_report_html(run_dir: str | Path) -> str:
    run_path = Path(run_dir)
    run_manifest = _read_json(run_path / "run.json", "run.json")
    comparison = _read_json(run_path / "comparison.json", "comparison.json")
    world = _read_world(run_path)

    scene_objects = _scene_objects(world)
    movable_ids = [obj["id"] for obj in scene_objects if not obj["fixed"]]
    backends = comparison.get("backends", [])
    episodes = _collect_episodes(run_path, backends, movable_ids)

    payload = {
        "schema": REPORT_SCHEMA,
        "scenario_id": comparison.get("scenario_id", run_manifest.get("scenario_id", "scenario")),
        "backends": backends,
        "colors": {backend: _SIM_COLORS[i % len(_SIM_COLORS)] for i, backend in enumerate(backends)},
        "summary": comparison.get("summary", {}),
        "divergence": comparison.get("divergence", {}),
        "scene_objects": scene_objects,
        "movable_ids": movable_ids,
        "episodes": episodes,
        "environment": run_manifest.get("orchestrator_environment", {}),
    }
    return _render_html(payload)


def write_run_report_html(run_dir: str | Path, output_path: str | Path | None = None) -> Path:
    run_path = Path(run_dir)
    output = Path(output_path) if output_path is not None else run_path / "report.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(build_run_report_html(run_path), encoding="utf-8")
    return output


def _read_json(path: Path, label: str) -> dict:
    if not path.is_file():
        raise ScenarioReportError(f"run directory is missing {label}: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _read_world(run_path: Path) -> dict:
    scenario_dir = run_path / "scenario"
    if not scenario_dir.is_dir():
        raise ScenarioReportError(f"run directory has no staged scenario: {scenario_dir}")
    from backend.services.scenario_loader import load_scenario, resolve_scenario_asset_path

    scenario = load_scenario(scenario_dir)
    world_path = resolve_scenario_asset_path(scenario_dir, scenario.world.package)
    return json.loads(world_path.read_text(encoding="utf-8"))


def _scene_objects(world: dict) -> list[dict]:
    objects = []
    world_body = world.get("world", world)
    for world_object in world_body.get("objects", []):
        if not isinstance(world_object, dict):
            continue
        physics = world_object.get("physics") if isinstance(world_object.get("physics"), dict) else {}
        simulation = (
            world_object.get("simulation") if isinstance(world_object.get("simulation"), dict) else {}
        )
        fixed = bool(physics.get("fixed", simulation.get("fixed", True)))
        objects.append(
            {
                "id": str(world_object.get("id", "")),
                "type": str(world_object.get("type", "cube")),
                "position_xyz": [float(v) for v in world_object.get("position_xyz", (0, 0, 0))],
                "size_xyz": [float(v) for v in world_object.get("size_xyz", (0.1, 0.1, 0.1))],
                "color": str(world_object.get("color", "#9ca3af")),
                "fixed": fixed,
            }
        )
    return objects


def _collect_episodes(run_path: Path, backends: list[str], movable_ids: list[str]) -> list[dict]:
    episode_indices = _episode_indices(run_path, backends)
    episodes = []
    for episode_index in episode_indices:
        per_backend = {}
        for backend in backends:
            episode_dir = run_path / backend / f"episode-{episode_index}"
            report_path = episode_dir / "report.json"
            trace_path = episode_dir / "trace.ndjson"
            if not report_path.is_file():
                continue
            report = json.loads(report_path.read_text(encoding="utf-8"))
            per_backend[backend] = {
                "success": report.get("success"),
                "stop_reason": report.get("stop_reason"),
                "sim_time_s": report.get("sim_time_s"),
                "trajectory": _read_trajectory(trace_path, movable_ids),
            }
        if per_backend:
            episodes.append({"episode_index": episode_index, "backends": per_backend})
    return episodes


def _episode_indices(run_path: Path, backends: list[str]) -> list[int]:
    indices: set[int] = set()
    for backend in backends:
        backend_dir = run_path / backend
        if not backend_dir.is_dir():
            continue
        for episode_dir in backend_dir.glob("episode-*"):
            try:
                indices.add(int(episode_dir.name.removeprefix("episode-")))
            except ValueError:
                continue
    return sorted(indices)


def _read_trajectory(trace_path: Path, movable_ids: list[str]) -> dict:
    if not trace_path.is_file():
        return {"t_ms": [], "objects": {}}
    frames_t: list[int] = []
    frames_obj: dict[str, list[list[float]]] = {object_id: [] for object_id in movable_ids}
    for line in trace_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        if record.get("stream") != "objects":
            continue
        state = record.get("state", {})
        frames_t.append(int(record.get("t_ms", 0)))
        for object_id in movable_ids:
            pose = state.get(object_id, {})
            position = pose.get("position_xyz", [0.0, 0.0, 0.0])
            quat = pose.get("quat_wxyz", [1.0, 0.0, 0.0, 0.0])
            yaw = _yaw_from_quat(quat)
            frames_obj[object_id].append(
                [round(float(position[0]), 4), round(float(position[1]), 4),
                 round(float(position[2]), 4), round(yaw, 4)]
            )
    return _downsample({"t_ms": frames_t, "objects": frames_obj})


def _yaw_from_quat(quat: list[float]) -> float:
    import math

    w, x, y, z = (float(v) for v in (quat + [0, 0, 0, 0])[:4])
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def _downsample(trajectory: dict) -> dict:
    frame_count = len(trajectory["t_ms"])
    if frame_count <= _MAX_TRAJECTORY_SAMPLES:
        return trajectory
    step = frame_count / _MAX_TRAJECTORY_SAMPLES
    indices = sorted({int(i * step) for i in range(_MAX_TRAJECTORY_SAMPLES)} | {frame_count - 1})
    return {
        "t_ms": [trajectory["t_ms"][i] for i in indices],
        "objects": {
            object_id: [frames[i] for i in indices]
            for object_id, frames in trajectory["objects"].items()
        },
    }


def _render_html(payload: dict) -> str:
    data_json = json.dumps(payload, separators=(",", ":"))
    scenario = html.escape(payload["scenario_id"])
    return _HTML_TEMPLATE.replace("__SCENARIO_ID__", scenario).replace(
        "__REPORT_DATA__", data_json
    )


_HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scenario comparison — __SCENARIO_ID__</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --panel: #f5f6f8; --border: #d5d8de; --fg: #1a1d21;
    --muted: #5b616e; --ok: #1a7f37; --bad: #b42318; --grid: #e3e6ea;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --panel: #181b21; --border: #2a2f38; --fg: #e6e8ec;
      --muted: #9aa1ad; --ok: #3fb950; --bad: #f85149; --grid: #22262e;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px 48px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .chip { display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }
  .views { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
  @media (max-width: 760px) { .views { grid-template-columns: 1fr; } }
  .view { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px; }
  .view h3 { margin: 2px 4px 8px; font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  canvas { width: 100%; height: auto; display: block; background: var(--bg); border-radius: 4px; }
  .transport { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
  .transport button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); color: var(--fg); cursor: pointer; }
  .transport input[type=range] { flex: 1; accent-color: var(--ok); }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin: 6px 2px 0; color: var(--muted); font-size: 12px; }
  .clock { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 64px; text-align: right; }
  select { font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); color: var(--fg); }
  .env { color: var(--muted); font-size: 12px; }
  code { background: var(--panel); padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1 id="title">Scenario comparison</h1>
  <p class="sub" id="subtitle"></p>

  <div class="card">
    <table id="summary"></table>
  </div>

  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <strong>Playback</strong>
      <label>episode <select id="episode"></select></label>
    </div>
    <div class="views">
      <div class="view"><h3>Top view (X · Y)</h3><canvas id="top" width="500" height="360"></canvas></div>
      <div class="view"><h3>Side view (X · Z)</h3><canvas id="side" width="500" height="360"></canvas></div>
    </div>
    <div class="legend" id="legend"></div>
    <div class="transport">
      <button id="play">▶ Play</button>
      <input type="range" id="scrub" min="0" max="100" value="0">
      <span class="clock" id="clock">0.00 s</span>
    </div>
  </div>

  <div class="card" id="divchart-card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px">
      <strong>Divergence over time</strong>
      <span class="env" id="divsplit"></span>
    </div>
    <canvas id="divchart" width="1040" height="260"></canvas>
    <div class="legend" id="divlegend"></div>
  </div>

  <div class="card">
    <strong>Divergence</strong>
    <table id="divergence"></table>
  </div>

  <p class="env" id="env"></p>
</div>

<script id="report-data" type="application/json">__REPORT_DATA__</script>
<script>
"use strict";
const DATA = JSON.parse(document.getElementById("report-data").textContent);
const colorFor = (backend) => DATA.colors[backend] || "#888";

function hexToRgba(hex, alpha) {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0,2),16), g = parseInt(v.slice(2,4),16), b = parseInt(v.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

document.getElementById("title").textContent = "Scenario comparison — " + DATA.scenario_id;
document.getElementById("subtitle").textContent =
  DATA.backends.join(" vs ") + " · " + DATA.episodes.length + " episode(s)";

// --- summary table ---
(function renderSummary() {
  const t = document.getElementById("summary");
  const head = "<tr><th>simulator</th><th class=num>episodes</th><th class=num>success</th>"
    + "<th class=num>rate</th><th class=num>mean t (s)</th><th class=num>wall (s)</th></tr>";
  const rows = DATA.backends.map((b) => {
    const s = DATA.summary[b] || {};
    const mean = s.mean_time_to_success_s;
    const wall = s.mean_wall_time_s;
    return `<tr><td><span class=chip><span class=dot style="background:${colorFor(b)}"></span>${b}</td>`
      + `<td class=num>${s.completed ?? 0}</td><td class=num>${s.success_count ?? 0}</td>`
      + `<td class=num>${s.success_rate != null ? (s.success_rate*100).toFixed(0)+"%" : "–"}</td>`
      + `<td class=num>${mean != null ? mean.toFixed(2) : "–"}</td>`
      + `<td class=num>${wall != null ? wall.toFixed(2) : "–"}</td></tr>`;
  }).join("");
  t.innerHTML = head + rows;
})();

// --- divergence table ---
(function renderDivergence() {
  const t = document.getElementById("divergence");
  const pairs = Object.keys(DATA.divergence);
  if (!pairs.length) { t.innerHTML = "<tr><td>Single simulator — nothing to compare.</td></tr>"; return; }
  let html = "<tr><th>pair</th><th class=num>agreement</th><th>episode</th>"
    + "<th class=num>Δ pos (mm)</th><th class=num>Δ rot (°)</th><th class=num>joint RMSE (rad)</th></tr>";
  for (const pair of pairs) {
    const d = DATA.divergence[pair];
    const rate = d.success_agreement_rate;
    for (const ep of d.episodes) {
      const deltas = ep.final_object_pose_delta || {};
      const obj = Object.keys(deltas)[0];
      const dp = obj ? (deltas[obj].position_m*1000).toFixed(1) : "–";
      const dr = obj ? (deltas[obj].rotation_rad*180/Math.PI).toFixed(1) : "–";
      const rmse = ep.final_joint_rmse_rad != null ? ep.final_joint_rmse_rad.toFixed(4) : "–";
      html += `<tr><td>${pair.replace("_vs_"," vs ")}</td>`
        + `<td class=num>${rate != null ? (rate*100).toFixed(0)+"%" : "–"}</td>`
        + `<td>ep ${ep.episode_index}${obj?" · "+obj:""}</td>`
        + `<td class=num>${dp}</td><td class=num>${dr}</td><td class=num>${rmse}</td></tr>`;
    }
  }
  t.innerHTML = html;
})();

document.getElementById("env").innerHTML = "environment: " +
  Object.entries(DATA.environment.packages || {}).map(([k,v]) => `<code>${k} ${v}</code>`).join(" ");

// --- playback ---
const legend = document.getElementById("legend");
legend.innerHTML = DATA.backends.map((b) =>
  `<span class=chip><span class=dot style="background:${colorFor(b)}"></span>${b}</span>`).join("")
  + `<span class=chip style="color:var(--muted)">outline = static scene</span>`;

const episodeSelect = document.getElementById("episode");
DATA.episodes.forEach((ep) => {
  const opt = document.createElement("option");
  opt.value = ep.episode_index; opt.textContent = "episode " + ep.episode_index;
  episodeSelect.appendChild(opt);
});

const topCanvas = document.getElementById("top");
const sideCanvas = document.getElementById("side");
const scrub = document.getElementById("scrub");
const clock = document.getElementById("clock");
const playBtn = document.getElementById("play");

// World bounds from static + trajectory extents, with margin.
function computeBounds(episode) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  const consider = (x,y,z,sx,sy,sz)=>{
    minX=Math.min(minX,x-sx/2);maxX=Math.max(maxX,x+sx/2);
    minY=Math.min(minY,y-sy/2);maxY=Math.max(maxY,y+sy/2);
    minZ=Math.min(minZ,z-sz/2);maxZ=Math.max(maxZ,z+sz/2);
  };
  for (const o of DATA.scene_objects) consider(o.position_xyz[0],o.position_xyz[1],o.position_xyz[2],o.size_xyz[0],o.size_xyz[1],o.size_xyz[2]);
  for (const b of DATA.backends) {
    const bd = episode.backends[b]; if (!bd) continue;
    for (const id of DATA.movable_ids) {
      const size = (DATA.scene_objects.find(o=>o.id===id)||{size_xyz:[0.1,0.1,0.1]}).size_xyz;
      for (const f of (bd.trajectory.objects[id]||[])) consider(f[0],f[1],f[2],size[0],size[1],size[2]);
    }
  }
  const pad=0.08;
  return {minX:minX-pad,maxX:maxX+pad,minY:minY-pad,maxY:maxY+pad,minZ:minZ-pad,maxZ:maxZ+pad};
}

function makeProjector(canvas, bounds, ha, va, flipV) {
  // ha/va: which world axis maps to horizontal/vertical ('x','y','z')
  const get = (p, axis) => ({x:p[0],y:p[1],z:p[2]})[axis];
  const rng = (axis) => axis==='x'?[bounds.minX,bounds.maxX]:axis==='y'?[bounds.minY,bounds.maxY]:[bounds.minZ,bounds.maxZ];
  const [h0,h1]=rng(ha), [v0,v1]=rng(va);
  const W=canvas.width, H=canvas.height, m=28;
  const sx=(W-2*m)/(h1-h0||1), sy=(H-2*m)/(v1-v0||1), s=Math.min(sx,sy);
  const toPx=(p)=>{
    const h=get(p,ha), v=get(p,va);
    const px=m+(h-h0)*s;
    const py=flipV ? H-m-(v-v0)*s : m+(v-v0)*s;
    return [px,py];
  };
  return {toPx, s, ha, va, get};
}

function drawBox(ctx, proj, cx, cy, cz, sizeH, sizeV, yaw, stroke, fill) {
  // Draw a rotated rectangle in the projection plane (yaw only affects top view).
  const [px,py]=proj.toPx([cx,cy,cz]);
  const hw=sizeH*proj.s/2, hh=sizeV*proj.s/2;
  ctx.save();
  ctx.translate(px,py);
  if (proj.ha==='x' && proj.va==='y') ctx.rotate(-yaw);
  ctx.beginPath(); ctx.rect(-hw,-hh,hw*2,hh*2);
  if (fill){ctx.fillStyle=fill;ctx.fill();}
  ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke();
  ctx.restore();
}

function sizeForAxis(size, axis){ return axis==='x'?size[0]:axis==='y'?size[1]:size[2]; }

function render(episode, frameIndex, bounds) {
  for (const [canvas, ha, va, flip] of [[topCanvas,'x','y',true],[sideCanvas,'x','z',true]]) {
    const ctx=canvas.getContext("2d");
    const cssColor=getComputedStyle(document.body).getPropertyValue("--grid");
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const proj=makeProjector(canvas,bounds,ha,va,flip);
    // static objects as outlines
    for (const o of DATA.scene_objects) {
      if (!o.fixed) continue;
      drawBox(ctx,proj,o.position_xyz[0],o.position_xyz[1],o.position_xyz[2],
        sizeForAxis(o.size_xyz,ha),sizeForAxis(o.size_xyz,va),0,hexToRgba("#888888",0.9),null);
    }
    // movable objects per simulator
    for (const b of DATA.backends) {
      const bd=episode.backends[b]; if(!bd) continue;
      const color=colorFor(b);
      for (const id of DATA.movable_ids) {
        const frames=bd.trajectory.objects[id]||[]; if(!frames.length) continue;
        const size=(DATA.scene_objects.find(o=>o.id===id)||{size_xyz:[0.07,0.07,0.07]}).size_xyz;
        // path trail
        ctx.beginPath();ctx.strokeStyle=hexToRgba(color,0.35);ctx.lineWidth=1;
        frames.forEach((f,i)=>{const[px,py]=proj.toPx(f);i?ctx.lineTo(px,py):ctx.moveTo(px,py);});
        ctx.stroke();
        const f=frames[Math.min(frameIndex,frames.length-1)];
        drawBox(ctx,proj,f[0],f[1],f[2],sizeForAxis(size,ha),sizeForAxis(size,va),f[3],color,hexToRgba(color,0.28));
      }
    }
  }
}

// --- divergence-over-time chart ---
// Reads the per-episode `trajectory` section each divergence pair now carries
// (see scenario_trace_divergence): the point is to show *when* two simulators
// diverge, not just the final delta. Object position (mm, left axis, solid) and
// joint RMSE (rad, right axis, dashed) are drawn per pair, each normalized to
// its own global max; a vertical marker flags the split point.
const _PAIR_COLORS = ["#7c3aed", "#0891b2", "#db2777", "#65a30d"];

function _pairTrajectories(episodeIndex) {
  const out = [];
  Object.keys(DATA.divergence).forEach((pair, i) => {
    const ep = (DATA.divergence[pair].episodes || []).find(e => e.episode_index === episodeIndex);
    if (ep && ep.trajectory && ep.trajectory.series && ep.trajectory.series.length) {
      out.push({ pair, color: _PAIR_COLORS[i % _PAIR_COLORS.length], t: ep.trajectory });
    }
  });
  return out;
}

function renderDivergenceChart(episodeIndex) {
  const card = document.getElementById("divchart-card");
  const canvas = document.getElementById("divchart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const series = _pairTrajectories(episodeIndex);
  if (!series.length) { card.style.display = "none"; return; }
  card.style.display = "";

  const ml = 52, mr = 56, mt = 18, mb = 30;
  const plotW = W - ml - mr, plotH = H - mt - mb;
  const dur = Math.max(1, ...series.map(s => s.t.duration_ms));
  const posMaxMm = Math.max(1e-9, ...series.map(s => (s.t.object_position_delta_m.max || 0) * 1000));
  const jointMax = Math.max(1e-9, ...series.map(s => s.t.joint_rmse_rad.max || 0));
  const gridColor = getComputedStyle(document.body).getPropertyValue("--grid");
  const muted = getComputedStyle(document.body).getPropertyValue("--muted");
  const fg = getComputedStyle(document.body).getPropertyValue("--fg");
  const xOf = t => ml + (t / dur) * plotW;
  const yPos = mm => mt + plotH - (mm / posMaxMm) * plotH;
  const yJoint = rad => mt + plotH - (rad / jointMax) * plotH;

  // frame + gridlines
  ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
  ctx.strokeRect(ml, mt, plotW, plotH);
  ctx.beginPath();
  for (let k = 1; k < 4; k++) { const y = mt + (plotH * k) / 4; ctx.moveTo(ml, y); ctx.lineTo(ml + plotW, y); }
  ctx.stroke();

  // axis labels
  ctx.fillStyle = muted; ctx.font = "11px sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.fillText(posMaxMm.toFixed(1), ml - 6, mt);
  ctx.fillText("0", ml - 6, mt + plotH);
  ctx.textAlign = "left";
  ctx.fillText(jointMax.toFixed(3), ml + plotW + 6, mt);
  ctx.fillText("0", ml + plotW + 6, mt + plotH);
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillText("0.0 s", ml, mt + plotH + 6);
  ctx.fillText((dur / 1000).toFixed(1) + " s", ml + plotW, mt + plotH + 6);
  ctx.save();
  ctx.translate(14, mt + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("Δpos (mm)", 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(W - 12, mt + plotH / 2); ctx.rotate(Math.PI / 2);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("joint RMSE (rad)", 0, 0);
  ctx.restore();

  const drawLine = (pts, dashed) => {
    ctx.beginPath();
    ctx.setLineDash(dashed ? [5, 4] : []);
    pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.stroke();
    ctx.setLineDash([]);
  };

  for (const s of series) {
    ctx.lineWidth = 1.8; ctx.strokeStyle = s.color;
    drawLine(s.t.series.filter(p => p.object_position_delta_m != null)
      .map(p => [xOf(p.t_ms), yPos(p.object_position_delta_m * 1000)]), false);
    ctx.globalAlpha = 0.8;
    drawLine(s.t.series.filter(p => p.joint_rmse_rad != null)
      .map(p => [xOf(p.t_ms), yJoint(p.joint_rmse_rad)]), true);
    ctx.globalAlpha = 1;
    if (s.t.split) {
      const x = xOf(s.t.split.t_ms);
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, mt + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = s.color; ctx.textAlign = x > ml + plotW * 0.6 ? "right" : "left"; ctx.textBaseline = "bottom";
      ctx.fillText("split " + (s.t.split.t_ms / 1000).toFixed(2) + "s", x + (x > ml + plotW * 0.6 ? -4 : 4), mt + plotH - 4);
    }
  }

  document.getElementById("divlegend").innerHTML =
    series.map(s => `<span class=chip><span class=dot style="background:${s.color}"></span>${s.pair.replace("_vs_"," vs ")}</span>`).join("")
    + `<span class=chip style="color:var(--muted)">solid = Δpos · dashed = joint RMSE · vertical = split</span>`;
  document.getElementById("divsplit").innerHTML = series.map(s =>
    s.t.split
      ? `${s.pair.replace("_vs_"," vs ")}: diverges at <strong>${(s.t.split.t_ms/1000).toFixed(2)}s</strong> (${s.t.split.metric==="joint_rmse_rad"?"joints":"object"} crossed ${s.t.split.threshold}${s.t.split.metric==="joint_rmse_rad"?" rad":" m"})`
      : `${s.pair.replace("_vs_"," vs ")}: no divergence above threshold`
  ).join(" &nbsp;·&nbsp; ");
}

let current, bounds, maxFrames, playing=false, raf=null;

function loadEpisode(index) {
  current=DATA.episodes.find(e=>e.episode_index===index)||DATA.episodes[0];
  bounds=computeBounds(current);
  maxFrames=Math.max(1,...DATA.backends.map(b=>{
    const bd=current.backends[b]; return bd?(bd.trajectory.t_ms.length):0;
  }));
  scrub.max=maxFrames-1; scrub.value=0;
  setFrame(0);
  renderDivergenceChart(current.episode_index);
}

function frameClock(frameIndex) {
  let t=0;
  for (const b of DATA.backends){const bd=current.backends[b];if(bd&&bd.trajectory.t_ms.length){t=bd.trajectory.t_ms[Math.min(frameIndex,bd.trajectory.t_ms.length-1)];break;}}
  return (t/1000).toFixed(2)+" s";
}

function setFrame(i){ scrub.value=i; clock.textContent=frameClock(i); render(current,i,bounds); }

function tick(){
  if(!playing) return;
  let i=parseInt(scrub.value,10)+1;
  if(i>=maxFrames){ i=0; }
  setFrame(i);
  raf=requestAnimationFrame(()=>setTimeout(tick,33));
}

playBtn.onclick=()=>{ playing=!playing; playBtn.textContent=playing?"⏸ Pause":"▶ Play"; if(playing) tick(); };
scrub.oninput=()=>{ playing=false; playBtn.textContent="▶ Play"; setFrame(parseInt(scrub.value,10)); };
episodeSelect.onchange=()=>loadEpisode(parseInt(episodeSelect.value,10));

if (DATA.episodes.length) loadEpisode(DATA.episodes[0].episode_index);
else {
  document.querySelector(".views").innerHTML="<p class=sub>No episode trajectories recorded.</p>";
  document.getElementById("divchart-card").style.display="none";
}
</script>
</body>
</html>
"""
