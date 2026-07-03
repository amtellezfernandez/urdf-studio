type WorkerTaskOptions<TRequest, TResponse> = {
  transfer?: Transferable[];
  signal?: AbortSignal;
  shouldUseWorker?: (request: TRequest) => boolean;
  fallback?: (request: TRequest) => Promise<TResponse> | TResponse;
  shouldFallback?: (response: TResponse) => boolean;
};

type WorkerTaskBroker<TRequest, TResponse> = {
  run: (request: TRequest, options?: WorkerTaskOptions<TRequest, TResponse>) => Promise<TResponse | null>;
  terminate: () => void;
};

type BrokerTask<TRequest, TResponse> = {
  id: number;
  request: TRequest;
  options: WorkerTaskOptions<TRequest, TResponse>;
  resolve: (response: TResponse | null) => void;
  canceled: boolean;
};

type WorkerTaskBrokerOptions = {
  concurrency?: number;
};

export const createWorkerTaskBroker = <
  TRequest extends Record<string, unknown>,
  TResponse extends { id: number }
>(
  createWorker: () => Worker | null,
  options: WorkerTaskBrokerOptions = {}
): WorkerTaskBroker<TRequest, TResponse> => {
  let worker: Worker | null = null;
  let nextId = 0;
  const queue: Array<BrokerTask<TRequest, TResponse>> = [];
  const inFlight = new Map<number, BrokerTask<TRequest, TResponse>>();
  const maxConcurrent = Math.max(1, options.concurrency ?? 1);

  const resolveWithFallback = (task: BrokerTask<TRequest, TResponse>) => {
    if (!task.options.fallback) {
      task.resolve(null);
      return;
    }
    Promise.resolve(task.options.fallback(task.request))
      .then((result) => task.resolve(result))
      .catch(() => task.resolve(null));
  };

  const resolveCompletedTask = (
    task: BrokerTask<TRequest, TResponse>,
    response: TResponse,
  ) => {
    if (task.canceled) {
      task.resolve(null);
      return;
    }
    if (task.options.shouldFallback?.(response) && task.options.fallback) {
      resolveWithFallback(task);
      return;
    }
    task.resolve(response);
  };

  const flush = () => {
    const pendingTasks = [...queue, ...inFlight.values()];
    queue.length = 0;
    inFlight.clear();
    worker?.terminate();
    worker = null;
    pendingTasks.forEach(resolveWithFallback);
  };

  const getWorker = () => {
    if (!worker) {
      const instance = createWorker();
      if (!instance) return null;

      instance.onmessage = (event: MessageEvent<TResponse>) => {
        const response = event.data;
        const task = inFlight.get(response.id);
        if (!task) return;
        inFlight.delete(response.id);
        resolveCompletedTask(task, response);
        pump();
      };

      instance.onerror = () => {
        flush();
      };

      worker = instance;
    }

    return worker;
  };

  const startTask = (task: BrokerTask<TRequest, TResponse>) => {
    if (task.canceled) {
      task.resolve(null);
      return;
    }

    const instance = getWorker();
    if (!instance) {
      resolveWithFallback(task);
      return;
    }

    inFlight.set(task.id, task);
    instance.postMessage({ id: task.id, ...task.request }, task.options.transfer ?? []);
  };

  const pump = () => {
    while (inFlight.size < maxConcurrent && queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      startTask(next);
    }
  };

  const run = async (
    request: TRequest,
    taskOptions: WorkerTaskOptions<TRequest, TResponse> = {}
  ): Promise<TResponse | null> => {
    if (taskOptions.signal?.aborted) {
      return null;
    }

    if (taskOptions.shouldUseWorker && !taskOptions.shouldUseWorker(request)) {
      if (taskOptions.fallback) {
        return taskOptions.fallback(request);
      }
      return null;
    }

    const id = nextId;
    nextId += 1;

    return new Promise((resolve) => {
      const task: BrokerTask<TRequest, TResponse> = {
        id,
        request,
        options: taskOptions,
        resolve,
        canceled: false,
      };

      if (taskOptions.signal) {
        const abortHandler = () => {
          task.canceled = true;
          if (inFlight.has(task.id)) {
            return;
          }
          const index = queue.findIndex((queued) => queued.id === task.id);
          if (index >= 0) {
            queue.splice(index, 1);
            resolve(null);
          }
        };
        taskOptions.signal.addEventListener("abort", abortHandler, { once: true });
      }

      queue.push(task);
      pump();
    });
  };

  return {
    run,
    terminate: flush,
  };
};
