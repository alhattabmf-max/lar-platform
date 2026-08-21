import {
  OUTBOX_RELAY_JOB_NAME,
  OUTBOX_RELAY_QUEUE_NAME,
  scheduleOutboxRelayJob,
} from "./outbox-relay-scheduler";
import {
  OPPORTUNITY_SWEEP_QUEUE_NAME,
  OPPORTUNITY_SWEEP_JOB_NAME,
} from "./sweep-scheduler";
import { CHECKOUT_LOCK_EXPIRY_QUEUE_NAME } from "./checkout-lock-expiry-scheduler";
import { PAYMENT_PENDING_EXPIRY_QUEUE_NAME } from "./payment-pending-expiry-scheduler";

function fakeQueue() {
  // Typed with rest parameters so `mock.calls[0][2]` is a real element
  // rather than an index into an empty tuple.
  const add = jest.fn((..._args: unknown[]) => Promise.resolve());
  return { queue: { add } as never, add };
}

describe("the relay has its own queue and job", () => {
  it("does not share a queue with any lifecycle sweep", () => {
    const others = [
      OPPORTUNITY_SWEEP_QUEUE_NAME,
      CHECKOUT_LOCK_EXPIRY_QUEUE_NAME,
      PAYMENT_PENDING_EXPIRY_QUEUE_NAME,
    ];

    expect(others).not.toContain(OUTBOX_RELAY_QUEUE_NAME);
    expect(new Set([...others, OUTBOX_RELAY_QUEUE_NAME]).size).toBe(4);
  });

  it("does not share a job name with the opportunity sweep", () => {
    expect(OUTBOX_RELAY_JOB_NAME).not.toBe(OPPORTUNITY_SWEEP_JOB_NAME);
  });
});

describe("scheduling is idempotent across restarts and replicas", () => {
  it("pins a fixed jobId so re-registering cannot duplicate the schedule", async () => {
    const { queue, add } = fakeQueue();

    await scheduleOutboxRelayJob(queue);

    expect(add.mock.calls[0][2]).toMatchObject({ jobId: OUTBOX_RELAY_JOB_NAME });
  });

  it("registers identical options every time it is called", async () => {
    const { queue, add } = fakeQueue();

    await scheduleOutboxRelayJob(queue);
    await scheduleOutboxRelayJob(queue);

    // BullMQ derives its repeat key from (name + repeat options), so
    // identical registrations collapse to one schedule.
    expect(add.mock.calls[0]).toEqual(add.mock.calls[1]);
  });

  it("runs every minute", async () => {
    const { queue, add } = fakeQueue();

    await scheduleOutboxRelayJob(queue);

    expect(add.mock.calls[0][2]).toMatchObject({ repeat: { pattern: "* * * * *" } });
  });

  it("carries an empty payload — the pass reads its work from the database", async () => {
    const { queue, add } = fakeQueue();

    await scheduleOutboxRelayJob(queue);

    expect(add.mock.calls[0][1]).toEqual({});
  });
});

describe("BullMQ must not add a second retry loop", () => {
  it("uses attempts: 1", async () => {
    const { queue, add } = fakeQueue();

    await scheduleOutboxRelayJob(queue);

    // The relay's retry policy lives in the database — next_attempt_at
    // with backoff, bounded by MAX_ATTEMPTS. A BullMQ retry would start
    // a SECOND pass while the first may still hold leases.
    expect(add.mock.calls[0][2]).toMatchObject({ attempts: 1 });
  });

  it("configures no job-level backoff", async () => {
    const { queue, add } = fakeQueue();

    await scheduleOutboxRelayJob(queue);

    expect(add.mock.calls[0][2]).not.toHaveProperty("backoff");
  });

  it("bounds retained job history", async () => {
    const { queue, add } = fakeQueue();

    await scheduleOutboxRelayJob(queue);
    const options = add.mock.calls[0][2] as Record<string, unknown>;

    expect(options.removeOnComplete).toEqual({ count: 100 });
    expect(options.removeOnFail).toEqual({ count: 100 });
  });
});
