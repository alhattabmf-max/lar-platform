import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { RequireTraderGuard } from "./require-trader.guard";

function contextWithSession(session: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ session }),
    }),
  } as unknown as ExecutionContext;
}

describe("RequireTraderGuard", () => {
  it("allows a TRADER session through", () => {
    const guard = new RequireTraderGuard();
    expect(guard.canActivate(contextWithSession({ accountType: "TRADER" }))).toBe(true);
  });

  it("rejects a SUPPLIER session", () => {
    const guard = new RequireTraderGuard();
    expect(() => guard.canActivate(contextWithSession({ accountType: "SUPPLIER" }))).toThrow(
      ForbiddenException
    );
  });

  it("rejects when no session is present", () => {
    const guard = new RequireTraderGuard();
    expect(() => guard.canActivate(contextWithSession(undefined))).toThrow(ForbiddenException);
  });
});
