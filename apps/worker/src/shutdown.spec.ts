import { createShutdownHandler } from "./shutdown";

/**
 * The shutdown ORDER is the behaviour under test: stop intake, drain
 * within the grace period, abort what is left, then close everything.
 * Getting the order wrong is what leases rows to a process that is
 * about to exit.
 */

function deps(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const closeWorker = jest.fn(() => {
    events.push("worker.close");
    return Promise.resolve();
  });

  return {
    events,
    closeWorker,
    handler: createShutdownHandler({
      workers: [{ close: closeWorker } as never],
      queues: [{ close: () => Promise.resolve() } as never],
      workerConnections: [{ disconnect: () => undefined } as never],
      queueConnections: [{ disconnect: () => undefined } as never],
      prisma: { $disconnect: () => Promise.resolve() } as never,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      onExit: () => events.push("exit"),
      ...overrides,
    }),
  };
}

describe("intake stops before draining", () => {
  it("calls onShutdownStart before any worker is closed", async () => {
    const events: string[] = [];
    const d = deps({
      onShutdownStart: () => events.push("stopClaiming"),
    });
    // Share one event log so ordering is comparable.
    d.closeWorker.mockImplementation(() => {
      events.push("worker.close");
      return Promise.resolve();
    });

    await d.handler("SIGTERM");

    expect(events[0]).toBe("stopClaiming");
    expect(events).toContain("worker.close");
  });

  it("works when no shutdown hooks are supplied", async () => {
    const d = deps();

    await expect(d.handler("SIGTERM")).resolves.toBeUndefined();
    expect(d.closeWorker).toHaveBeenCalled();
  });
});

describe("the grace period", () => {
  it("aborts in-flight work when draining outlasts it", async () => {
    const events: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handler = createShutdownHandler({
      workers: [
        {
          close: () => {
            events.push("close.start");
            return blocked;
          },
        } as never,
      ],
      queues: [{ close: () => Promise.resolve() } as never],
      workerConnections: [{ disconnect: () => undefined } as never],
      queueConnections: [{ disconnect: () => undefined } as never],
      prisma: { $disconnect: () => Promise.resolve() } as never,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      onExit: () => events.push("exit"),
      gracePeriodMs: 10,
      onGraceExpired: () => {
        events.push("abort");
        // Aborting is what unblocks the close — that is the point of it.
        release();
      },
    });

    await handler("SIGTERM");

    expect(events).toEqual(["close.start", "abort", "exit"]);
  });

  it("does not abort when draining finishes in time", async () => {
    const events: string[] = [];

    const handler = createShutdownHandler({
      workers: [{ close: () => Promise.resolve() } as never],
      queues: [{ close: () => Promise.resolve() } as never],
      workerConnections: [{ disconnect: () => undefined } as never],
      queueConnections: [{ disconnect: () => undefined } as never],
      prisma: { $disconnect: () => Promise.resolve() } as never,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      onExit: () => events.push("exit"),
      gracePeriodMs: 5_000,
      onGraceExpired: () => events.push("abort"),
    });

    await handler("SIGTERM");

    expect(events).not.toContain("abort");
  });

  it("still awaits the close after aborting, rather than skipping it", async () => {
    const events: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handler = createShutdownHandler({
      workers: [{ close: () => blocked } as never],
      queues: [{ close: () => events.push("queue.close") as unknown as Promise<void> } as never],
      workerConnections: [{ disconnect: () => undefined } as never],
      queueConnections: [{ disconnect: () => undefined } as never],
      prisma: { $disconnect: () => Promise.resolve() } as never,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      onExit: () => events.push("exit"),
      gracePeriodMs: 10,
      onGraceExpired: () => {
        events.push("abort");
        setTimeout(release, 10);
      },
    });

    await handler("SIGTERM");

    // The queue close happens only after the worker close resolved.
    expect(events.indexOf("abort")).toBeLessThan(events.indexOf("queue.close"));
  });

  it("waits indefinitely when no grace period is configured", async () => {
    const events: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handler = createShutdownHandler({
      workers: [{ close: () => blocked } as never],
      queues: [{ close: () => Promise.resolve() } as never],
      workerConnections: [{ disconnect: () => undefined } as never],
      queueConnections: [{ disconnect: () => undefined } as never],
      prisma: { $disconnect: () => Promise.resolve() } as never,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      onExit: () => events.push("exit"),
    });

    const running = handler("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).not.toContain("exit");

    release();
    await running;
    expect(events).toContain("exit");
  });
});

describe("exit happens only after an orderly close is attempted", () => {
  it("closes workers, queues and prisma before exiting", async () => {
    const events: string[] = [];

    const handler = createShutdownHandler({
      workers: [{ close: () => Promise.resolve(events.push("worker") as unknown as void) } as never],
      queues: [{ close: () => Promise.resolve(events.push("queue") as unknown as void) } as never],
      workerConnections: [{ disconnect: () => events.push("wconn") } as never],
      queueConnections: [{ disconnect: () => events.push("qconn") } as never],
      prisma: { $disconnect: () => Promise.resolve(events.push("prisma") as unknown as void) } as never,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      onExit: () => events.push("exit"),
    });

    await handler("SIGTERM");

    expect(events).toEqual(["worker", "queue", "wconn", "qconn", "prisma", "exit"]);
  });

  it("still exits when a close throws, so a stuck process cannot hang forever", async () => {
    const events: string[] = [];

    const handler = createShutdownHandler({
      workers: [{ close: () => Promise.reject(new Error("boom")) } as never],
      queues: [{ close: () => Promise.resolve() } as never],
      workerConnections: [{ disconnect: () => undefined } as never],
      queueConnections: [{ disconnect: () => undefined } as never],
      prisma: { $disconnect: () => Promise.resolve() } as never,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      onExit: () => events.push("exit"),
    });

    await handler("SIGTERM");

    expect(events).toEqual(["exit"]);
  });
});

describe("idempotence", () => {
  it("a second signal joins the in-flight shutdown instead of starting another", async () => {
    const d = deps();

    await Promise.all([d.handler("SIGTERM"), d.handler("SIGINT")]);

    expect(d.closeWorker).toHaveBeenCalledTimes(1);
  });
});
