export type WorkerTaskRunner<TRequest, TResponse> = {
  run: (request: Omit<TRequest, "id">, transfer?: Transferable[]) => Promise<TResponse | null>;
  terminate: () => void;
};

export const createWorkerTaskRunner = <
  TRequest extends { id: number },
  TResponse extends { id: number }
>(
  createWorker: () => Worker | null
): WorkerTaskRunner<TRequest, TResponse> => {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<number, (response: TResponse | null) => void>();

  const flush = () => {
    const resolvers = Array.from(pending.values());
    pending.clear();
    worker?.terminate();
    worker = null;
    resolvers.forEach((resolve) => resolve(null));
  };

  const getWorker = () => {
    if (!worker) {
      const instance = createWorker();
      if (!instance) return null;

      instance.onmessage = (event: MessageEvent<TResponse>) => {
        const response = event.data;
        const resolver = pending.get(response.id);
        if (!resolver) return;
        pending.delete(response.id);
        resolver(response);
      };
      instance.onerror = () => {
        flush();
      };

      worker = instance;
    }

    return worker;
  };

  const run = async (
    request: Omit<TRequest, "id">,
    transfer: Transferable[] = []
  ): Promise<TResponse | null> => {
    const instance = getWorker();
    if (!instance) return null;
    const id = nextId;
    nextId += 1;

    return new Promise((resolve) => {
      pending.set(id, resolve);
      instance.postMessage({ id, ...request } as TRequest, transfer);
    });
  };

  return {
    run,
    terminate: flush,
  };
};
