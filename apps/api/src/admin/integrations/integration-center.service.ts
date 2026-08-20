import { Injectable } from "@nestjs/common";
import type { Env } from "@platform/config";

export type ConfigState = "ENABLED" | "DISABLED";
export type HealthState = "UNKNOWN" | "NOT_CHECKED" | "HEALTHY" | "UNHEALTHY";

export interface IntegrationStatus {
  name: string;
  provider: string;
  mode: "MANUAL" | "AUTOMATIC";
  configState: ConfigState;
  /**
   * Deliberately NOT "HEALTHY" for any provider in Phase 3 — no real
   * connectivity/health check exists yet for Email or Maps. Reporting
   * "Healthy" without ever having tested the connection would be a
   * false claim. This becomes HEALTHY/UNHEALTHY only once a real
   * "Test Connection" mechanism is built (Blueprint §55) — Phase 3
   * explicitly ships the skeleton, not that mechanism.
   */
  healthState: HealthState;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
}

@Injectable()
export class IntegrationCenterService {
  list(env: Env): IntegrationStatus[] {
    return [
      {
        name: "Email",
        provider: env.EMAIL_PROVIDER_MODE === "mock" ? "Mock" : env.EMAIL_PROVIDER_MODE,
        mode: "MANUAL",
        configState: "ENABLED",
        healthState: "NOT_CHECKED",
        lastSuccessAt: null,
        lastErrorAt: null,
      },
      {
        name: "Maps / Geocoding",
        provider: env.MAP_PROVIDER_MODE === "manual" ? "Manual coordinates" : env.MAP_PROVIDER_MODE,
        mode: "MANUAL",
        configState: "ENABLED",
        healthState: "UNKNOWN",
        lastSuccessAt: null,
        lastErrorAt: null,
      },
    ];
  }
}
