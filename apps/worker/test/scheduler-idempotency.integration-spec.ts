import { loadEnv } from "@platform/config";
import { createBullMqRedisConnection } from "../src/redis-connection";
import {
  OPPORTUNITY_SWEEP_JOB_NAME,
  createOpportunitySweepQueue,
  scheduleOpportunitySweepJob,
} from "../src/sweep-scheduler";

const env = loadEnv(process.env);

describe("Opportunity sweep Job Scheduler — idempotent registration (integration, real Redis)", () => {
  it("calling the scheduler three times in a row on the same Redis leaves exactly ONE Job Scheduler registered, same name and pattern", async () => {
    const connection = createBullMqRedisConnection(env);
    await connection.connect();
    const queue = createOpportunitySweepQueue(connection);
    await queue.obliterate({ force: true }).catch(() => undefined);

    await scheduleOpportunitySweepJob(queue);
    const afterFirst = await queue.getJobSchedulers();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].name).toBe(OPPORTUNITY_SWEEP_JOB_NAME);
    expect(afterFirst[0].pattern).toBe("* * * * *");
    const keyAfterFirst = afterFirst[0].key;

    await scheduleOpportunitySweepJob(queue);
    const afterSecond = await queue.getJobSchedulers();
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].key).toBe(keyAfterFirst);

    await scheduleOpportunitySweepJob(queue);
    const afterThird = await queue.getJobSchedulers();
    expect(afterThird).toHaveLength(1);
    expect(afterThird[0].key).toBe(keyAfterFirst);
    expect(afterThird[0].name).toBe(OPPORTUNITY_SWEEP_JOB_NAME);
    expect(afterThird[0].pattern).toBe("* * * * *");

    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    connection.disconnect();
  }, 30_000);
});
