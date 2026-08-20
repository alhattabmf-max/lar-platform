import { Global, Module } from "@nestjs/common";
import { loadEnv, type Env } from "@platform/config";

export const APP_ENV = Symbol("APP_ENV");

@Global()
@Module({
  providers: [
    {
      provide: APP_ENV,
      useFactory: (): Env => loadEnv(process.env),
    },
  ],
  exports: [APP_ENV],
})
export class AppConfigModule {}
