import { runBounded } from "./bounded-pool";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("the pool never exceeds its ceiling", () => {
  it("keeps at most `concurrency` tasks in flight", async () => {
    let peak = 0;
    const gates = Array.from({ length: 20 }, deferred);

    const running = runBounded(
      gates,
      async (gate) => {
        await gate.promise;
      },
      { concurrency: 5, onInFlightChange: (n) => (peak = Math.max(peak, n)) }
    );

    // Release in waves so the ceiling is exercised, not just the tail.
    for (const gate of gates) {
      gate.resolve();
      await Promise.resolve();
    }
    await running;

    expect(peak).toBeLessThanOrEqual(5);
  });

  it("actually reaches the ceiling rather than running serially", async () => {
    let peak = 0;
    const gates = Array.from({ length: 10 }, deferred);

    const running = runBounded(gates, (gate) => gate.promise, {
      concurrency: 5,
      onInFlightChange: (n) => (peak = Math.max(peak, n)),
    });

    await Promise.resolve();
    const observed = peak;
    gates.forEach((gate) => gate.resolve());
    await running;

    expect(observed).toBe(5);
  });

  it("never starts more runners than there are items", async () => {
    let peak = 0;

    await runBounded([1, 2], async (n) => n, {
      concurrency: 10,
      onInFlightChange: (n) => (peak = Math.max(peak, n)),
    });

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("refills a slot as soon as one task finishes", async () => {
    const order: number[] = [];
    const gates = Array.from({ length: 4 }, deferred);

    const running = runBounded(
      gates,
      async (gate, index) => {
        await gate.promise;
        order.push(index);
      },
      { concurrency: 2 }
    );

    gates[0].resolve();
    await Promise.resolve();
    gates[1].resolve();
    gates[2].resolve();
    gates[3].resolve();
    await running;

    expect(order).toHaveLength(4);
  });
});

describe("one failure does not abandon the batch", () => {
  it("continues past a rejected task", async () => {
    const results = await runBounded(
      [1, 2, 3, 4, 5],
      async (n) => {
        if (n === 3) throw new Error("boom");
        return n * 2;
      },
      { concurrency: 2 }
    );

    expect(results).toHaveLength(5);
    expect(results[2].status).toBe("rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
  });

  it("never rejects, whatever the tasks do", async () => {
    await expect(
      runBounded([1, 2, 3], async () => {
        throw new Error("always");
      }, { concurrency: 2 })
    ).resolves.toHaveLength(3);
  });

  it("keeps results positionally aligned with the input", async () => {
    const results = await runBounded(
      ["a", "b", "c"],
      async (value, index) => {
        if (index === 1) throw new Error("no");
        return value.toUpperCase();
      },
      { concurrency: 3 }
    );

    expect(results[0]).toEqual({ status: "fulfilled", value: "A" });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: "C" });
  });

  it("runs every item exactly once", async () => {
    const seen: number[] = [];

    await runBounded(Array.from({ length: 25 }, (_, i) => i), async (n) => {
      seen.push(n);
    }, { concurrency: 5 });

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });
});

describe("degenerate inputs", () => {
  it("returns immediately for an empty list", async () => {
    await expect(runBounded([], async () => 1, { concurrency: 5 })).resolves.toEqual([]);
  });

  it("treats a concurrency below one as one", async () => {
    let peak = 0;

    await runBounded([1, 2, 3], async (n) => n, {
      concurrency: 0,
      onInFlightChange: (n) => (peak = Math.max(peak, n)),
    });

    expect(peak).toBe(1);
  });
});
