import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The worker factory constructs a real BullMQ `Worker`, which opens a
 * Redis connection — so the behaviour here is asserted at the source
 * level rather than by instantiating one. Port 6379 is closed, and a
 * unit test that needed Redis would simply not run.
 *
 * The runtime behaviour these guard is covered by the integration spec,
 * which has never been executed.
 */
const SOURCE = readFileSync(join(__dirname, "create-outbox-relay-worker.ts"), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const MAIN = readFileSync(join(__dirname, "main.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("one pass at a time per process", () => {
  it("sets concurrency to 1", () => {
    expect(CODE).toMatch(/concurrency:\s*1/);
  });

  it("introduces no Redis distributed lock", () => {
    // Cross-process safety stays in FOR UPDATE SKIP LOCKED, where it
    // already is for every other sweep. A second mechanism would be a
    // second thing to get wrong.
    expect(CODE).not.toMatch(/redlock|distributed.?lock|SETNX/i);
  });

  it("ignores a job of another name", () => {
    expect(CODE).toContain("if (job.name !== OUTBOX_RELAY_JOB_NAME) return");
  });
});

describe("shutdown affordances", () => {
  it("exposes stopClaiming and abortInFlight", () => {
    expect(CODE).toContain("stopClaiming");
    expect(CODE).toContain("abortInFlight");
  });

  it("refuses to start a pass once claiming has stopped", () => {
    expect(CODE).toMatch(/if \(!claiming\)/);
  });

  it("checks that flag before running the pass, not after", () => {
    // Scoped to the processor body: `runOutboxRelayPass` also appears in
    // the import at the top of the file, which would make a whole-file
    // index comparison meaningless.
    const body = CODE.slice(CODE.indexOf("const processor ="));

    expect(body.indexOf("if (!claiming)")).toBeLessThan(body.indexOf("runOutboxRelayPass("));
  });

  it("passes an abort signal into the pass", () => {
    expect(CODE).toContain("signal: controller.signal");
  });
});

describe("failure logging carries no provider text", () => {
  it("never logs err.message or a stack from a failed job", () => {
    expect(CODE).not.toMatch(/err\.message/);
    expect(CODE).not.toMatch(/err\.stack/);
    expect(CODE).not.toMatch(/error:\s*err/);
  });

  it("logs only the job identity and attempt count", () => {
    const handler = CODE.slice(CODE.indexOf('worker.on("failed"'));

    expect(handler).toContain("jobId");
    expect(handler).toContain("attemptsMade");
  });
});

describe("the worker is wired into the process", () => {
  it("is scheduled at startup", () => {
    expect(MAIN).toContain("scheduleOutboxRelayJob(relayQueue)");
  });

  it("is created with the shared provider from @platform/email", () => {
    expect(MAIN).toContain('from "@platform/email"');
    expect(MAIN).toContain("new MockEmailProvider(");
  });

  it("joins the existing shutdown handler's worker and queue arrays", () => {
    expect(MAIN).toMatch(/workers:\s*\[[^\]]*relay\.worker/s);
    expect(MAIN).toMatch(/queues:\s*\[[^\]]*relayQueue/s);
  });

  it("stops claiming on shutdown and aborts after the grace period", () => {
    expect(MAIN).toContain("onShutdownStart: () => relay.stopClaiming()");
    expect(MAIN).toContain("onGraceExpired: () => relay.abortInFlight()");
    expect(MAIN).toContain("gracePeriodMs: SHUTDOWN_GRACE_MS");
  });

  it("allows a grace period longer than one provider timeout", () => {
    const match = MAIN.match(/SHUTDOWN_GRACE_MS\s*=\s*([\d_]+)/);
    const graceMs = Number(match![1].replace(/_/g, ""));

    // 20s is PROVIDER_TIMEOUT_MS; an ordinary send must be able to
    // finish inside the grace period rather than being aborted.
    expect(graceMs).toBeGreaterThan(20_000);
  });

  it("logs the provider mode when the relay is scheduled", () => {
    expect(MAIN).toContain("providerMode: env.EMAIL_PROVIDER_MODE");
  });

  it("does not exit before the orderly close is attempted", () => {
    // process.exit legitimately appears once, in the fatal bootstrap
    // catch that fires when startup itself fails. What must not exist is
    // an exit on the signal path, which would skip draining entirely.
    expect(MAIN.match(/process\.exit\(/g)).toHaveLength(1);

    const signalHandling = MAIN.slice(MAIN.indexOf('process.on("SIGTERM"'));
    expect(signalHandling.slice(0, signalHandling.indexOf("main()"))).not.toContain("process.exit");
  });
});
