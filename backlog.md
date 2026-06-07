# RobotOps Backlog

Status values: `to do`, `on going`, `done`

| Epic | Checkbox | Task | Description | Status | Comments |
|---|---|---|---|---|---|
| Product foundation | [ ] | Define RobotOps product contract | Make RobotOps a UI-first lifecycle for embodied AI: dataset, versioning, training, evaluation, deployment/export, and monitoring. | to do | Keep architecture lightweight and avoid heavy workflow frameworks. |
| Product foundation | [ ] | Stabilize current RobotOps branch | Fix current integration gaps before adding new cloud features. | to do | Current branch is `feature/robotops-training` with existing WIP changes. |
| Product foundation | [ ] | Remove DVC from scope | Use S3-compatible storage for artifact and dataset snapshot storage instead of DVC. | done | Confirmed product decision. |
| Product foundation | [ ] | Define compute adapter interface | Standardize `preflight`, `estimate_cost`, `submit`, `status`, `logs`, `cancel`, `artifacts`, and `cleanup`. | to do | All compute backends should implement this contract. |
| Artifact storage | [ ] | Make S3 first-class artifact store | Store configs, logs, checkpoints, final models, evaluation outputs, videos, and lineage JSON in S3-compatible storage. | to do | Local storage remains dev fallback only. |
| Artifact storage | [ ] | Support MinIO for local development | Keep Docker Compose MinIO as the local S3-compatible test target. | on going | Compose already includes MinIO. |
| Artifact storage | [ ] | Add artifact indexing on training completion | Upload and index all training artifacts when a job completes. | to do | Needed for UI artifact browser and reproducibility. |
| Artifact storage | [ ] | Add immutable artifact paths | Ensure every run writes artifacts under stable run-scoped paths. | to do | Include run id and artifact type in path. |
| Dataset management | [ ] | Support HuggingFace LeRobot datasets | Let users select HF LeRobot datasets from the UI. | on going | Dataset browser exists, but flow needs validation and training integration. |
| Dataset management | [ ] | Pin HF dataset revisions | Resolve HF dataset refs to commit SHAs for reproducibility. | on going | Backend resolver exists. |
| Dataset management | [ ] | Support local LeRobot datasets | Let users select and validate local LeRobot dataset folders. | on going | Existing local dataset support needs better training wizard integration. |
| Dataset management | [ ] | Add S3 dataset source | Allow datasets to live in S3-compatible storage. | to do | Later than local/HF, but aligned with no-DVC decision. |
| Dataset management | [ ] | Add dataset validation | Validate format, robot type, episodes, modalities, action/state shapes, and missing files before training. | to do | Should be a required wizard step. |
| Experiments and runs | [ ] | Fix experiment ID persistence | Persist `experiment_id` from training request into job storage and link job to experiment. | to do | Current request has field but job info does not persist it. |
| Experiments and runs | [ ] | Make experiments the primary workflow | Training wizard should start from select/create experiment. | to do | Current UI is job-centric. |
| Experiments and runs | [ ] | Keep unassigned runs visible | Existing runs without experiment should remain visible and attachable. | to do | Useful for migration and backward compatibility. |
| Experiments and runs | [ ] | Store full run lineage | Record dataset version, robot/URDF hash, model provider, Docker image digest, git SHA, compute, tracker, seed, timestamps, and artifacts. | to do | Core reproducibility requirement. |
| Training runtime | [ ] | Dockerize local training jobs | Replace product-path raw Python subprocess training with Docker-based training. | to do | Raw subprocess can remain dev-only. |
| Training runtime | [ ] | Standardize trainer image contract | Use one trainer image across local, SSH, EC2, and managed cloud. | to do | Inputs are config JSON and dataset refs; outputs are artifacts. |
| Training runtime | [ ] | Add trainer image validation | Verify the selected trainer image can import torch/LeRobot, see CUDA when requested, read the dataset source, and write artifacts before launch. | to do | L40S validation showed Docker/NVIDIA runtime checks must be explicit in the UI. |
| Training runtime | [ ] | Add tiny paid-compute smoke launch | Let users run a bounded `max_steps` smoke job from the UI before starting a long training run. | to do | Use the same artifact, metric, and log paths as full training. |
| Training runtime | [ ] | Fix policy ID mismatch | Normalize IDs such as `diffusion_policy` and `vq_bet` across backend, UI, and LeRobot adapter. | to do | Current training script expects different names. |
| Training runtime | [ ] | Fix logs and metrics paths | Make writer and reader paths consistent for progress, metrics, and logs. | to do | Current service reads paths that training does not always write. |
| Training runtime | [ ] | Add cancellation handling | Ensure Docker jobs can be cancelled cleanly and status persisted. | to do | Applies to local, SSH, and cloud. |
| Compute: local | [ ] | Add local preflight checks | Detect Docker, NVIDIA runtime, CUDA GPUs, CPU fallback, disk, and memory. | to do | UI should show pass/fail and remediation. |
| Compute: local | [ ] | Add Docker storage preflight | Detect Docker root directory free space and recommend/allow a data directory override when the default disk is full. | to do | AWS L40S test needed Docker moved from `/var/lib/docker` to `/scratch/docker`. |
| Compute: local | [ ] | Add local Docker compute adapter | Run trainer container locally with proper mounts and environment. | to do | First production compute backend. |
| Compute: local | [ ] | Support direct Docker fallback | Provide commands/API behavior that do not require Docker Compose when the compose plugin is missing. | to do | EC2 instance had Docker installed but no Compose plugin. |
| Compute: SSH | [ ] | Add generic SSH Docker adapter | Let users train on any remote machine with SSH and Docker. | to do | Works for EC2, lab machines, rented GPU pods, and workstations. |
| Compute: SSH | [ ] | Add SSH preflight | Check SSH login, Docker, NVIDIA runtime, visible GPUs, disk, S3 write, and trainer image access. | to do | Must happen before launch; show exact failed command and remediation. |
| Compute: SSH | [ ] | Add existing-machine setup wizard | Let users register any reachable GPU/CPU machine with host, user, auth method, work directory, artifact directory, and optional Docker data-root hint. | to do | This is the flexible product path; EC2 is one provider-specific discovery layer on top. |
| Compute: SSH | [ ] | Add SSH log streaming | Stream container logs back to RobotOps UI. | to do | Required for monitoring. |
| Compute: AWS EC2 | [ ] | Add AWS credentials/profile setup UI | Let users configure AWS profile, region, S3 bucket, and IAM assumptions from UI. | to do | Product must not depend on local private guides. |
| Compute: AWS EC2 | [ ] | List existing EC2 instances | Show user-owned instances and GPU metadata where possible. | to do | Start with existing instance flow. |
| Compute: AWS EC2 | [ ] | Run training on existing EC2 | Use EC2 as a specialization of SSH Docker for first AWS product path. | to do | UI should discover instance IP/AZ/profile, then reuse the generic SSH Docker adapter. |
| Compute: AWS EC2 | [ ] | Add auto-stop/max runtime guardrails | Require runtime limit and optional auto-stop for costly GPU instances. | to do | Important cost-safety feature. |
| Compute: AWS EC2 | [ ] | Add managed EC2 launch flow | Launch temporary GPU instances from UI. | to do | Later than existing-instance support. |
| Compute: managed cloud | [ ] | Evaluate AWS Batch adapter | Add queue-based GPU jobs after Docker/S3 contract is proven. | to do | Good for production multi-job usage. |
| Compute: managed cloud | [ ] | Evaluate SageMaker Training adapter | Add managed AWS training option for users who want less infrastructure. | to do | Later adapter. |
| Compute: managed cloud | [ ] | Evaluate GCP Vertex AI adapter | Add GCP custom Docker training jobs as optional provider. | to do | Later adapter. |
| Compute: managed cloud | [ ] | Hide stubbed Modal/RunPod | Remove or hide fake compute backends until they launch jobs, stream logs, and sync artifacts. | to do | Avoid misleading users. |
| Monitoring | [ ] | Keep RobotOps-native monitoring | UI should show status, progress, logs, metrics curves, artifacts, runtime, and cost. | on going | Existing dashboard needs contract fixes. |
| Monitoring | [ ] | Support MLflow tracker | Log params, metrics, artifacts, lineage, and tracker URL. | on going | Tracker exists, but duplicate run handling needs fix. |
| Monitoring | [ ] | Support W&B tracker | Log params, metrics, artifacts, lineage, and tracker URL. | on going | Tracker exists, but connection validation and run handling need work. |
| Monitoring | [ ] | Avoid duplicate tracker runs | Create/resume a single tracker run per training job. | to do | Current orchestration and subprocess can both initialize. |
| Monitoring | [ ] | Make tracker failures non-fatal | Training should continue if MLflow/W&B fails. | to do | Store tracker error in job metadata. |
| Evaluation | [ ] | Support checkpoint selection | Let user evaluate final/latest/best/explicit checkpoint. | to do | UI and backend should use artifact index. |
| Evaluation | [ ] | Persist evaluation metrics | Store aggregate and per-episode metrics in DB. | on going | Evaluation persistence exists but needs full artifact linkage. |
| Evaluation | [ ] | Store evaluation videos in S3 | Save video artifacts to S3 and expose them in UI. | to do | Existing video paths are local. |
| Evaluation | [ ] | Add evaluation playback UI | Show metrics, per-episode details, and video player. | on going | Basic evaluation panel exists. |
| Evaluation | [ ] | Add future 3D rollout playback | Replay policy actions in the 3D URDF viewer. | to do | Deferred after video-first evaluation. |
| Model providers | [ ] | Keep built-in LeRobot provider | Support ACT, Diffusion Policy, TD-MPC, and VQ-BeT. | on going | Registry exists, IDs need cleanup. |
| Model providers | [ ] | Add provider discovery API | Return available policies, schemas, defaults, modalities, and provider metadata. | on going | Existing policies API needs integration with training UI. |
| Model providers | [ ] | Add custom provider manifest | Let users add model providers through a validated manifest. | to do | Avoid arbitrary backend code injection. |
| Model providers | [ ] | Render custom config forms | Generate UI forms from provider `config_schema`. | to do | Needed for custom models. |
| Model providers | [ ] | Validate custom provider runtime | Check Docker image, train command, eval command, inputs, outputs, and artifact paths. | to do | Must happen before provider is usable. |
| Deployment and export | [ ] | Export checkpoints to S3 | Provide explicit model/checkpoint export from run artifacts. | to do | S3 artifact store should already hold them. |
| Deployment and export | [ ] | Export model to HuggingFace Hub | Generate model card with lineage and upload model artifacts. | on going | Existing HF export code/UI exists. |
| Deployment and export | [ ] | Load checkpoint for viewer inference | Let evaluation/viewer load a trained checkpoint. | to do | Initial deployment target is local/sim inference. |
| Deployment and export | [ ] | Add simulation deployment target | Register and run policies in simulation environments. | to do | Later than training/evaluation. |
| Deployment and export | [ ] | Add robot deployment target | Track model deployed to real robot runtime. | to do | Later product phase. |
| UI | [ ] | Redesign RobotOps navigation | Include Experiments, Datasets, Training, Runs, Metrics, Evaluation, Artifacts, and Settings. | to do | Current page has partial navigation. |
| UI | [ ] | Build experiment-first training wizard | Steps: experiment, dataset, validation, model, hyperparameters, tracker, compute, preflight, review, launch. | to do | Core product workflow. |
| UI | [ ] | Add compute preflight panel | Show checks, failures, remediation, and launch readiness. | to do | Required for user-owned compute; include Docker, CUDA, disk, S3, dataset, and image checks. |
| UI | [ ] | Add cloud training review screen | Before launch, show dataset, model, hyperparameters, selected machine, GPU, disk target, Docker image, S3 artifact target, tracker, max runtime, and estimated cost. | to do | This should make paid cloud launches deliberate and auditable. |
| UI | [ ] | Add artifact browser | Browse and download run artifacts from S3/local fallback. | on going | Current PR exposes per-run local artifacts in the job details UI. |
| UI | [ ] | Fix frontend DTO mapping | Convert backend snake_case responses to frontend camelCase models. | to do | Current JobList stores raw backend jobs. |
| Quality and tests | [ ] | Fix lint ignore config | Ignore `.uv-cache`, vendored generated code, and irrelevant external sources. | to do | Current lint fails because cache code is scanned. |
| Quality and tests | [ ] | Add API contract tests | Test training job list/status DTOs and frontend mappers. | to do | Prevent snake_case/camelCase regressions. |
| Quality and tests | [ ] | Add compute adapter unit tests | Test preflight, status mapping, logs, cancellation, and artifact sync. | to do | Use fake adapter first. |
| Quality and tests | [ ] | Add Docker local smoke test | Launch a tiny training/smoke job through local Docker. | to do | Should be a PR gate when Docker is available. |
| Quality and tests | [ ] | Add S3/MinIO artifact round-trip test | Upload, list, download, and verify artifact checksum. | to do | Can run against local MinIO. |
| Quality and tests | [ ] | Add AWS EC2 manual test checklist | Document manual test using user-owned AWS resources. | to do | Product docs, not private local guide. |
