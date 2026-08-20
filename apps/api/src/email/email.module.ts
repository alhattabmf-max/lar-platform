import { Module } from "@nestjs/common";
import { EMAIL_PROVIDER } from "./email-provider.interface";
import { MockEmailProvider } from "./mock-email.provider";

@Module({
  providers: [{ provide: EMAIL_PROVIDER, useClass: MockEmailProvider }],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
