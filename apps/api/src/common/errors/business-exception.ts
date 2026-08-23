import { HttpException } from "@nestjs/common";
import type { ErrorCode } from "@platform/types";

export class BusinessException extends HttpException {
  /**
   * `details` is OPTIONAL and deliberately narrow in practice.
   *
   * It is not a general channel to the client: the error envelope carries
   * whatever is put here, and the web app's `toUserFacingError` discards
   * `details` entirely unless a specific reader recognises both the error
   * code and the exact shape. Today the only such reader is
   * `readFailedChecks`, which accepts `PRODUCT_TECHNICAL_CHECK_FAILED`
   * paired with an array of codes from a closed vocabulary.
   *
   * Anything put here must therefore be a closed vocabulary too — never
   * an exception message, a field path, or a value the caller submitted.
   */
  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(details ? { code, message, details } : { code, message }, status);
  }
}
