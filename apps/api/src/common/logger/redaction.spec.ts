import pino from "pino";

function buildTestLogger(stream: NodeJS.WritableStream) {
  return pino(
    {
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          "req.body.password",
          "req.body.newPassword",
          "req.body.token",
          "req.body.iban",
          "res.headers['set-cookie']",
        ],
        censor: "[REDACTED]",
      },
    },
    stream as never,
  );
}

function captureOutput(logFn: (logger: pino.Logger) => void): string {
  let captured = "";
  const stream = {
    write: (chunk: string) => {
      captured += chunk;
      return true;
    },
  };
  const logger = buildTestLogger(stream as unknown as NodeJS.WritableStream);
  logFn(logger);
  return captured;
}

describe("HTTP logger redaction (same config as logger.module.ts)", () => {
  it("redacts req.body.password from the log line entirely", () => {
    const secret = "super-secret-password-value-123";
    const output = captureOutput((logger) =>
      logger.info(
        { req: { body: { password: secret, crNumber: "CR-1" } } },
        "login attempt",
      ),
    );

    expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("CR-1"); // non-sensitive fields still logged
  });

  it("redacts req.body.token and req.body.newPassword", () => {
    const token = "a".repeat(64);
    const newPassword = "brand-new-secret-999";
    const output = captureOutput((logger) =>
      logger.info({ req: { body: { token, newPassword } } }, "password reset"),
    );

    expect(output).not.toContain(token);
    expect(output).not.toContain(newPassword);
  });

  it("redacts raw bank IBAN values", () => {
    const iban = "SA0380000000608010167519";
    const output = captureOutput((logger) =>
      logger.info(
        { req: { body: { iban, bankName: "Test Bank" } } },
        "bank account submission",
      ),
    );

    expect(output).not.toContain(iban);
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("Test Bank");
  });

  it("redacts the Cookie and Authorization headers", () => {
    const cookieValue = "sid=abcdef1234567890";
    const output = captureOutput((logger) =>
      logger.info(
        {
          req: {
            headers: {
              cookie: cookieValue,
              authorization: "Bearer secret-token",
            },
          },
        },
        "request",
      ),
    );

    expect(output).not.toContain(cookieValue);
    expect(output).not.toContain("secret-token");
  });
});
