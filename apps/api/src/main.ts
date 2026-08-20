import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap/configure-app";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  const { env, logger } = configureApp(app);

  await app.listen(env.PORT);
  logger.info(`API listening on port ${env.PORT}`);
}

bootstrap();
