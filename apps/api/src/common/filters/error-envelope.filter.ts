import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ERROR_CODES, type ErrorCode, type ErrorEnvelope } from "@platform/types";
import { getRequestId } from "../logger/request-id.util";

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ERROR_CODES.VALIDATION_FAILED,
  401: ERROR_CODES.UNAUTHORIZED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  429: ERROR_CODES.RATE_LIMITED,
  503: ERROR_CODES.SERVICE_UNAVAILABLE,
};

interface Resolved {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Catches every exception thrown anywhere in the request lifecycle and
 * converts it into the Error Envelope contract:
 *
 *   { error: { code, message, details }, requestId, timestamp }
 *
 * `code` is the only field the web app's i18n layer may key off to pick
 * the localized (ar-SA / en-SA) message. `message` is an English,
 * developer-facing default — never rendered directly to end users.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const resolved = this.resolve(exception);

    if (resolved.status >= 500) {
      const log = (request as unknown as { log?: { error: (obj: unknown, msg?: string) => void } }).log;
      log?.error({ err: exception }, "Unhandled exception");
    }

    const envelope: ErrorEnvelope = {
      error: {
        code: resolved.code,
        message: resolved.message,
        ...(resolved.details ? { details: resolved.details } : {}),
      },
      requestId: getRequestId(request),
      timestamp: new Date().toISOString(),
    };

    response.status(resolved.status).json(envelope);
  }

  private resolve(exception: unknown): Resolved {
    // Multer errors are plain Error subclasses (not HttpException) with
    // a fixed `.code` string. LIMIT_FILE_SIZE specifically means the
    // upload exceeded the infrastructure hard ceiling
    // (MEDIA_SIZE_HARD_CEILING_BYTES) before ever reaching
    // MediaPolicyService's own validation — surface it as a clear,
    // expected client error rather than a generic 500.
    if (this.isMulterFileSizeError(exception)) {
      return {
        status: 413,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Uploaded file exceeds the maximum allowed size",
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const code = STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR;

      if (typeof body === "string") {
        return { status, code, message: body };
      }

      if (typeof body === "object" && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        const rawMessage = bodyObj.message;
        const explicitCode = bodyObj.code;
        const resolvedCode =
          typeof explicitCode === "string" && this.isKnownCode(explicitCode)
            ? (explicitCode as ErrorCode)
            : code;

        if (Array.isArray(rawMessage)) {
          // class-validator's ValidationPipe produces an array of
          // human-readable messages — keep them as structured details
          // instead of collapsing them into a single string.
          return {
            status,
            code: resolvedCode,
            message: "Validation failed",
            details: { validationErrors: rawMessage },
          };
        }

        // A BusinessException may carry `details` — a CLOSED vocabulary
        // it chose to expose, such as the product technical-check codes.
        // Passed through as-is; nothing here composes or derives it, so
        // the exception is the only thing that decides what is in it.
        const explicitDetails = bodyObj.details;

        return {
          status,
          code: resolvedCode,
          message: typeof rawMessage === "string" ? rawMessage : exception.message,
          ...(typeof explicitDetails === "object" && explicitDetails !== null
            ? { details: explicitDetails as Record<string, unknown> }
            : {}),
        };
      }

      return { status, code, message: exception.message };
    }

    return {
      status: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "Internal server error",
    };
  }

  private isMulterFileSizeError(exception: unknown): boolean {
    return (
      typeof exception === "object" &&
      exception !== null &&
      "code" in exception &&
      (exception as { code?: unknown }).code === "LIMIT_FILE_SIZE"
    );
  }

  private isKnownCode(value: string): value is ErrorCode {
    return (Object.values(ERROR_CODES) as string[]).includes(value);
  }
}
