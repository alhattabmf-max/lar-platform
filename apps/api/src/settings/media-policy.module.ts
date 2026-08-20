import { Module } from "@nestjs/common";
import { MediaPolicyService } from "./media-policy.service";

@Module({
  providers: [MediaPolicyService],
  exports: [MediaPolicyService],
})
export class MediaPolicyModule {}
