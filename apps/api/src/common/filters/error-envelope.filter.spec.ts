import { ArgumentsHost, BadRequestException, NotFoundException } from "@nestjs/common";
import { ErrorEnvelopeFilter } from "./error-envelope.filter";

function buildHost(request: Record<string, unknown>) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe("ErrorEnvelopeFilter", () => {
  let filter: ErrorEnvelopeFilter;

  beforeEach(() => {
    filter = new ErrorEnvelopeFilter();
  });

  it("maps BadRequestException to VALIDATION_FAILED with 400", () => {
    const { host, status, json } = buildHost({ id: "req-1" });

    filter.catch(new BadRequestException("bad input"), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "VALIDATION_FAILED" }),
        requestId: "req-1",
      })
    );
  });

  it("collects class-validator array messages into details.validationErrors", () => {
    const { host, json } = buildHost({ id: "req-2" });

    filter.catch(
      new BadRequestException({
        message: ["name should not be empty", "email must be an email"],
      }),
      host
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "VALIDATION_FAILED",
          message: "Validation failed",
          details: {
            validationErrors: ["name should not be empty", "email must be an email"],
          },
        }),
      })
    );
  });

  it("maps NotFoundException to NOT_FOUND with 404", () => {
    const { host, status, json } = buildHost({ id: "req-3" });

    filter.catch(new NotFoundException(), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: "NOT_FOUND" }) })
    );
  });

  it("maps unknown/non-HTTP exceptions to INTERNAL_ERROR with 500 and logs them", () => {
    const errorLog = jest.fn();
    const { host, status, json } = buildHost({ id: "req-4", log: { error: errorLog } });

    filter.catch(new Error("boom"), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
        requestId: "req-4",
      })
    );
    expect(errorLog).toHaveBeenCalled();
  });

  it("always includes an ISO timestamp", () => {
    const { host, json } = buildHost({ id: "req-5" });

    filter.catch(new Error("boom"), host);

    const envelope = json.mock.calls[0][0];
    expect(new Date(envelope.timestamp).toISOString()).toBe(envelope.timestamp);
  });

  it("maps a Multer LIMIT_FILE_SIZE error to 413 VALIDATION_FAILED instead of a generic 500", () => {
    const { host, status, json } = buildHost({ id: "req-6" });

    const multerError = Object.assign(new Error("File too large"), { code: "LIMIT_FILE_SIZE" });
    filter.catch(multerError, host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: "VALIDATION_FAILED" }) })
    );
  });
});
