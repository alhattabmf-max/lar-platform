import { Injectable, Logger } from "@nestjs/common";
import type {
  VerificationProvider,
  VerificationResult,
  VerificationSubject,
} from "./verification-provider.interface";

@Injectable()
export class MockVerificationProvider implements VerificationProvider {
  private readonly logger = new Logger(MockVerificationProvider.name);

  async verify(subject: VerificationSubject): Promise<VerificationResult> {
    this.logger.log(
      `[mock] auto-approving company ${subject.companyId} (CR ${subject.crNumber})`
    );
    return { approved: true };
  }
}
