import { ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import type { Env } from "@platform/config";
import { OriginRefererCsrfProtection } from "./origin-referer-csrf.provider";

function fakeEnv(allowedOrigins: string[]): Env {
  return { CORS_ALLOWED_ORIGINS: allowedOrigins } as Env;
}

function fakeRequest(method: string, headers: Record<string, string>): Request {
  return { method, headers } as unknown as Request;
}

describe("OriginRefererCsrfProtection", () => {
  it("allows safe methods (GET) regardless of Origin", () => {
    const csrf = new OriginRefererCsrfProtection(fakeEnv(["https://app.example.com"]));
    expect(() => csrf.assertValid(fakeRequest("GET", {}))).not.toThrow();
  });

  it("allows a POST with an Origin in the allow-list", () => {
    const csrf = new OriginRefererCsrfProtection(fakeEnv(["https://app.example.com"]));
    const req = fakeRequest("POST", { origin: "https://app.example.com" });
    expect(() => csrf.assertValid(req)).not.toThrow();
  });

  it("rejects a POST with an Origin NOT in the allow-list", () => {
    const csrf = new OriginRefererCsrfProtection(fakeEnv(["https://app.example.com"]));
    const req = fakeRequest("POST", { origin: "https://evil.example.com" });
    expect(() => csrf.assertValid(req)).toThrow(ForbiddenException);
  });

  it("rejects a POST with no Origin and no Referer", () => {
    const csrf = new OriginRefererCsrfProtection(fakeEnv(["https://app.example.com"]));
    expect(() => csrf.assertValid(fakeRequest("POST", {}))).toThrow(ForbiddenException);
  });

  it("falls back to Referer when Origin is absent", () => {
    const csrf = new OriginRefererCsrfProtection(fakeEnv(["https://app.example.com"]));
    const req = fakeRequest("POST", { referer: "https://app.example.com/some/page" });
    expect(() => csrf.assertValid(req)).not.toThrow();
  });
});
