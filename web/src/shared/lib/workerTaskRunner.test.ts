import { describe, expect, it } from "vitest";

import { createWorkerTaskBroker } from "@/shared/lib/workerTaskRunner";

type TestRequest = {
  value: number;
};

type TestResponse = {
  id: number;
  value: number;
};

type PostedMessage = {
  id: number;
  value: number;
};

type FakeWorker = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror"> & {
  messages: PostedMessage[];
  reply: (response: TestResponse) => void;
  terminated: boolean;
};

const createFakeWorker = (): FakeWorker => {
  const worker = {
    messages: [] as PostedMessage[],
    onerror: null,
    onmessage: null,
    terminated: false,
    postMessage(message: PostedMessage) {
      worker.messages.push(message);
    },
    reply(response: TestResponse) {
      worker.onmessage?.call(worker as unknown as Worker, {
        data: response,
      } as MessageEvent<TestResponse>);
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker as FakeWorker;
};

describe("workerTaskRunner", () => {
  it("clamps worker concurrency to at least one", async () => {
    const worker = createFakeWorker();
    const broker = createWorkerTaskBroker<TestRequest, TestResponse>(
      () => worker as unknown as Worker,
      { concurrency: 0 }
    );

    const first = broker.run({ value: 1 });
    const second = broker.run({ value: 2 });

    expect(worker.messages).toEqual([{ id: 0, value: 1 }]);

    worker.reply({ id: 0, value: 10 });
    await expect(first).resolves.toEqual({ id: 0, value: 10 });

    expect(worker.messages).toEqual([
      { id: 0, value: 1 },
      { id: 1, value: 2 },
    ]);

    worker.reply({ id: 1, value: 20 });
    await expect(second).resolves.toEqual({ id: 1, value: 20 });
  });

  it("uses fallback when a worker cannot be created", async () => {
    const broker = createWorkerTaskBroker<TestRequest, TestResponse>(() => null);

    await expect(
      broker.run(
        { value: 3 },
        {
          fallback: (request) => ({ id: 99, value: request.value * 2 }),
        }
      )
    ).resolves.toEqual({ id: 99, value: 6 });
  });
});
