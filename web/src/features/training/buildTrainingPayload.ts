import type {
  ComputeConfig,
  DatasetConfig,
  ModelConfig,
  TrackerConfig,
  TrainingParams,
} from "./types";

interface BuildTrainingPayloadArgs {
  datasetConfig: DatasetConfig;
  modelConfig: ModelConfig;
  trainingParams: TrainingParams;
  trackerConfig: TrackerConfig;
  computeConfig: ComputeConfig;
  overrides?: {
    training?: Partial<TrainingParams>;
  };
}

export function buildTrainingPayload({
  datasetConfig,
  modelConfig,
  trainingParams,
  trackerConfig,
  computeConfig,
  overrides,
}: BuildTrainingPayloadArgs) {
  const effectiveTraining = {
    ...trainingParams,
    ...overrides?.training,
  };

  return {
    dataset: {
      source: datasetConfig.source,
      repo_id: datasetConfig.repoId,
      local_path: datasetConfig.localPath,
      version: datasetConfig.version,
    },
    model: {
      architecture: modelConfig.architecture,
      config: modelConfig.config,
      pretrained_path: modelConfig.pretrainedPath,
    },
    training: {
      batch_size: effectiveTraining.batchSize,
      learning_rate: effectiveTraining.learningRate,
      epochs: effectiveTraining.epochs,
      max_steps: effectiveTraining.maxSteps,
      seed: effectiveTraining.seed,
      gradient_accumulation_steps: effectiveTraining.gradientAccumulationSteps,
      max_grad_norm: effectiveTraining.maxGradNorm,
      weight_decay: effectiveTraining.weightDecay,
      lr_scheduler: effectiveTraining.lrScheduler,
      warmup_steps: effectiveTraining.warmupSteps,
      checkpoint_interval: effectiveTraining.checkpointInterval,
      keep_last_n_checkpoints: effectiveTraining.keepLastNCheckpoints,
      early_stopping_patience: effectiveTraining.earlyStoppingPatience,
      output_dir: effectiveTraining.outputDir,
      run_name: effectiveTraining.runName,
    },
    tracker: {
      type: trackerConfig.type,
      tracking_uri: trackerConfig.trackingUri,
      experiment_name: trackerConfig.experimentName,
      project: trackerConfig.project,
      entity: trackerConfig.entity,
    },
    compute: {
      type: computeConfig.type,
      gpu: computeConfig.gpu,
      device: computeConfig.device,
      api_key: computeConfig.apiKey,
      use_spot: computeConfig.useSpot,
      timeout_hours: computeConfig.timeoutHours,
      ssh_host: computeConfig.sshHost,
      ssh_user: computeConfig.sshUser,
      ssh_port: computeConfig.sshPort,
      ssh_key_path: computeConfig.sshKeyPath,
      ssh_work_dir: computeConfig.sshWorkDir,
      remote_output_dir: computeConfig.remoteOutputDir,
      docker_image: computeConfig.dockerImage,
      docker_args: computeConfig.dockerArgs,
      ssh_options: computeConfig.sshOptions,
    },
  };
}
