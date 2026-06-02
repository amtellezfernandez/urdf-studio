import type { IkSolveRequest, IkSolveResponse } from "./types";

type BrokerTask = {
  request: IkSolveRequest;
  resolve: (response: IkSolveResponse) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
};

const MAX_CONCURRENT = 2;
const MAIN_THREAD_TIMEOUT_BUFFER_MS = 1500;

class IkBroker {
  private worker: Worker | null = null;
  private queue: BrokerTask[] = [];
  private inFlight = new Map<string, BrokerTask>();

  private getWorker() {
    if (this.worker) {
      return this.worker;
    }

    if (typeof Worker === "undefined") {
      return null;
    }

    const worker = new Worker(new URL("./ikWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<IkSolveResponse>) => {
      const response = event.data;
      const task = this.inFlight.get(response.requestId);
      if (!task) return;
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      this.inFlight.delete(response.requestId);
      task.resolve(response);
      this.pump();
    };
    worker.onerror = () => {
      this.flush("worker_error");
    };

    this.worker = worker;
    return worker;
  }

  private flush(status: IkSolveResponse["status"]) {
    const pending = [...this.queue, ...this.inFlight.values()];
    this.queue = [];
    this.inFlight.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    pending.forEach((task) => {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      task.resolve({
        requestId: task.request.requestId,
        ok: false,
        error: "IK worker unavailable",
        status,
      });
    });
  }

  private pump() {
    while (this.inFlight.size < MAX_CONCURRENT && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      this.start(next);
    }
  }

  private start(task: BrokerTask) {
    const worker = this.getWorker();
    if (!worker) {
      task.resolve({
        requestId: task.request.requestId,
        ok: false,
        error: "IK worker unavailable",
        status: "worker_error",
      });
      return;
    }

    this.inFlight.set(task.request.requestId, task);
    const timeoutMs = task.request.timeoutMs + MAIN_THREAD_TIMEOUT_BUFFER_MS;
    task.timeoutId = setTimeout(() => {
      this.cancel(task.request.requestId);
      task.resolve({
        requestId: task.request.requestId,
        ok: false,
        error: "IK solve timed out",
        status: "timeout",
      });
    }, timeoutMs);

    worker.postMessage({ type: "solve", request: task.request });
  }

  solve(request: IkSolveRequest) {
    return new Promise<IkSolveResponse>((resolve) => {
      this.queue.push({ request, resolve });
      this.pump();
    });
  }

  cancel(requestId: string) {
    const queuedIndex = this.queue.findIndex((task) => task.request.requestId === requestId);
    if (queuedIndex >= 0) {
      const [task] = this.queue.splice(queuedIndex, 1);
      task.resolve({
        requestId,
        ok: false,
        error: "IK solve cancelled",
        status: "cancelled",
      });
      return;
    }

    const task = this.inFlight.get(requestId);
    if (task?.timeoutId) {
      clearTimeout(task.timeoutId);
    }
    this.inFlight.delete(requestId);
    this.worker?.postMessage({ type: "cancel", requestId });
  }
}

export const ikBroker = new IkBroker();
