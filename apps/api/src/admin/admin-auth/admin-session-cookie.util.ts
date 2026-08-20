import type { CookieOptions } from "express";
import type { Env } from "@platform/config";

export function buildAdminSessionCookieOptions(env: Env, maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}

export function buildClearAdminSessionCookieOptions(env: Env): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}
