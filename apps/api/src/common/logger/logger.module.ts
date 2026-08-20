import { Global, Module } from "@nestjs/common";
import pino, { type Logger } from "pino";
import pinoHttp from "pino-http";
import type { Env } from "@platform/config";
import { genReqId, REQUEST_ID_HEADER } from "./request-id.util";

export const PINO_LOGGER = Symbol("PINO_LOGGER");

/**
 * Builds the pino-http Express middleware. Called directly from
 * `main.ts` via `app.use(...)` so it is guaranteed to run as the very
 * first middleware — before Nest routing, guards, pipes, and
 * controllers — per the Request ID strategy in docs/architecture.md.
 */
export function createHttpLogger(_env: Env, logger: Logger) {
  return pinoHttp({
    logger,
    genReqId,
    customProps: (req) => ({ requestId: (req as { id?: string }).id }),
  });
}

/**
 * Mirrors the resolved request id onto the `X-Request-ID` response
 * header for every response (success and error alike), so the client
 * can always correlate a response back to server-side logs.
 */
export function requestIdResponseHeaderMiddleware(
  req: { id?: string },
  res: { setHeader: (name: string, value: string) => void },
  next: () => void,
) {
  if (req.id) {
    res.setHeader(
      REQUEST_ID_HEADER === "x-request-id" ? "X-Request-ID" : REQUEST_ID_HEADER,
      req.id,
    );
  }
  next();
}

@Global()
@Module({
  providers: [
    {
      provide: PINO_LOGGER,
      useFactory: (): Logger =>
        pino({
          level: process.env.LOG_LEVEL ?? "info",
          base: undefined,
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
        }),
    },
  ],
  exports: [PINO_LOGGER],
})
export class LoggerModule {}
