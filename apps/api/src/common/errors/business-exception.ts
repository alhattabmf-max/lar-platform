import { HttpException } from "@nestjs/common";
import type { ErrorCode } from "@platform/types";

export class BusinessException extends HttpException {
  constructor(status: number, code: ErrorCode, message: string) {
    super({ code, message }, status);
  }
}
