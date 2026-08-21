import {
  assertEmailDeliveryConfigured,
  deliveryIsSimulated,
  isSimulatedProviderMode,
  type EmailDeliveryConfig,
} from "./email-delivery";

type NodeEnv = EmailDeliveryConfig["NODE_ENV"];

const NODE_ENVS: NodeEnv[] = ["development", "test", "production"];
const REQUIRED = [true, false];

function config(NODE_ENV: NodeEnv, EMAIL_REQUIRED: boolean): EmailDeliveryConfig {
  return { NODE_ENV, EMAIL_REQUIRED, EMAIL_PROVIDER_MODE: "mock" };
}

/**
 * The complete truth table.
 *
 * `EMAIL_PROVIDER_MODE` accepts only "mock" today, so the third axis is
 * currently degenerate and the table is 3 x 2. Exactly one cell refuses
 * to boot.
 */
describe("assertEmailDeliveryConfigured — full truth table", () => {
  const table = NODE_ENVS.flatMap((nodeEnv) =>
    REQUIRED.map((required) => ({
      nodeEnv,
      required,
      shouldThrow: nodeEnv === "production" && required,
    }))
  );

  it("covers every combination of the two live axes", () => {
    expect(table).toHaveLength(6);
    expect(table.filter((row) => row.shouldThrow)).toHaveLength(1);
  });

  it.each(table)(
    "NODE_ENV=$nodeEnv EMAIL_REQUIRED=$required mode=mock -> throws=$shouldThrow",
    ({ nodeEnv, required, shouldThrow }) => {
      const run = () => assertEmailDeliveryConfigured(config(nodeEnv, required));

      if (shouldThrow) expect(run).toThrow();
      else expect(run).not.toThrow();
    }
  );
});

describe("the one refusing combination", () => {
  const failing = config("production", true);

  it("refuses to start", () => {
    expect(() => assertEmailDeliveryConfigured(failing)).toThrow(/Refusing to start/);
  });

  it("names both variables an operator has to change", () => {
    expect(() => assertEmailDeliveryConfigured(failing)).toThrow(/EMAIL_REQUIRED/);
    expect(() => assertEmailDeliveryConfigured(failing)).toThrow(/EMAIL_PROVIDER_MODE/);
  });

  it("says plainly that no mail is delivered", () => {
    expect(() => assertEmailDeliveryConfigured(failing)).toThrow(/delivers no mail/);
  });

  it("offers both ways out — a real provider, or acknowledging the gap", () => {
    expect(() => assertEmailDeliveryConfigured(failing)).toThrow(/EMAIL_REQUIRED=false/);
  });
});

describe("the permitted combinations, each for its own reason", () => {
  it("allows production when the deployment declares email is not required", () => {
    // The default. It is an acknowledgement, not an oversight.
    expect(() => assertEmailDeliveryConfigured(config("production", false))).not.toThrow();
  });

  it.each(["development", "test"] as const)(
    "allows %s even when email is marked required",
    (nodeEnv) => {
      expect(() => assertEmailDeliveryConfigured(config(nodeEnv, true))).not.toThrow();
    }
  );
});

describe("simulated delivery is reported, not inferred", () => {
  it("identifies mock as simulated", () => {
    expect(isSimulatedProviderMode("mock")).toBe(true);
  });

  it("does not treat an unknown mode as simulated", () => {
    expect(isSimulatedProviderMode("ses")).toBe(false);
  });

  it("reports simulated delivery for the current configuration", () => {
    // PUBLISHED on an outbox row means the configured provider accepted
    // the command. With mock, that acceptance is a log line and nothing
    // was delivered — which is why this flag travels with the stats.
    expect(deliveryIsSimulated({ EMAIL_PROVIDER_MODE: "mock" })).toBe(true);
  });
});
