import type { TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { configureApp } from "../../src/bootstrap/configure-app";

/**
 * The SINGLE way any E2E test may construct its Nest application.
 * Always passes { rawBody: true } — without it, req.rawBody is
 * undefined in every test (Nest only wires raw-body capture when
 * this option is explicitly set), so any webhook signature
 * verification silently fails with 401 no matter how correct the
 * signing code is. This bit every webhook-related E2E test until it
 * was centralized here.
 *
 * Always applies exactly the same configureApp() that main.ts uses
 * for the real process (global prefix, ValidationPipe, cookie
 * parser, CORS, security headers, request-ID logging) — so E2E tests
 * exercise the real HTTP surface, not an approximation of it.
 * APP_FILTER (ErrorEnvelopeFilter) and APP_GUARD (ThrottlerGuard) are
 * registered inside AppModule's own providers array, so they apply
 * automatically to any app built from AppModule — no extra wiring
 * needed here.
 */
export async function createE2eApplication(moduleRef: TestingModule): Promise<INestApplication> {
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  return app;
}
