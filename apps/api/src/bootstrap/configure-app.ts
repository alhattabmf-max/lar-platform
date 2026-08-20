import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import type { Logger } from "pino";
import type { Env } from "@platform/config";
import { APP_ENV } from "../config/app-config.module";
import {
  createHttpLogger,
  requestIdResponseHeaderMiddleware,
  PINO_LOGGER,
} from "../common/logger/logger.module";

/**
 * Applies every process-wide concern (request logging + X-Request-ID,
 * security headers, CORS, validation, API prefix) to a Nest
 * application instance. Called from both `main.ts` (real process
 * bootstrap) and every e2e test's `beforeAll`, so the two can never
 * drift apart — a test that builds the app without this function would
 * silently miss the X-Request-ID / Error Envelope behavior it's
 * supposed to verify.
 */
export function configureApp(app: INestApplication): { env: Env; logger: Logger } {
  const env = app.get<Env>(APP_ENV);
  const logger = app.get<Logger>(PINO_LOGGER);

  // pino-http is mounted first, before Nest routing, guards, pipes, and
  // controllers, so every request/response — and every error — is
  // logged and carries the same X-Request-ID (docs/architecture.md
  // Request ID strategy).
  app.use(createHttpLogger(env, logger));
  app.use(requestIdResponseHeaderMiddleware);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: env.CORS_ALLOWED_ORIGINS.length > 0 ? env.CORS_ALLOWED_ORIGINS : false,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );

  // REST API under /api/v1 (Blueprint §2). Health/readiness endpoints
  // stay unprefixed — orchestrators and load balancers expect them at
  // a fixed, well-known path.
  app.setGlobalPrefix("api/v1", { exclude: ["health", "ready"] });

  return { env, logger };
}
