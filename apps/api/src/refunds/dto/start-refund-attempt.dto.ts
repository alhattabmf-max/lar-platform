import { IsString, MinLength } from "class-validator";

// Deliberately does NOT accept amount or currency — those are read
// exclusively from the frozen RefundObligation inside the service.
export class StartRefundAttemptDto {
  @IsString()
  @MinLength(1)
  providerCode!: string;
}
