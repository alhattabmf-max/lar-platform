import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

/**
 * Reads directly from system_settings on every call — deliberately
 * uncached, so an admin change takes effect immediately without a
 * redeploy.
 *
 * Fail-safe contract (deliberate, not an oversight):
 *   - Key absent entirely → this is a normal, expected bootstrap state
 *     (nothing has configured it yet). Returns `fallback` silently.
 *   - Key present but the stored value is the wrong type (data
 *     corruption, a bad manual edit, a bug elsewhere) → this is NOT
 *     the same as "unset". It is logged as an error and thrown, so a
 *     security-relevant setting (e.g. email_verification_enabled)
 *     never silently resolves to a default the operator never chose.
 *   - A database failure while reading is never swallowed into
 *     `fallback` either — it propagates as a real error after being
 *     logged, so a caller relying on this for a security decision
 *     fails loudly instead of proceeding on an assumed value.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.readRow(key);
    if (!row) return fallback;

    if (typeof row.value !== "boolean") {
      this.logger.error(
        `system_settings["${key}"] is not a boolean (got ${JSON.stringify(row.value)}) — refusing to silently fall back`
      );
      throw new Error(`system_settings["${key}"] has a malformed value`);
    }
    return row.value;
  }

  async getString(key: string, fallback: string): Promise<string> {
    const row = await this.readRow(key);
    if (!row) return fallback;

    if (typeof row.value !== "string") {
      this.logger.error(
        `system_settings["${key}"] is not a string (got ${JSON.stringify(row.value)}) — refusing to silently fall back`
      );
      throw new Error(`system_settings["${key}"] has a malformed value`);
    }
    return row.value;
  }

  /**
   * Deliberately different fail-safe contract from getBoolean/getString
   * above — used ONLY for settings where losing protection (e.g. a
   * rate limit silently disabling because its config row is malformed)
   * is worse than serving a hardcoded safe default. Never throws:
   * a missing key, a malformed value, AND a database failure all
   * resolve to `fallback`, each logged at error level so the problem
   * is never silent. This is intentionally NOT the default behavior
   * for settings in general — see SecuritySettingsService for exactly
   * which settings use it and why.
   */
  async getJsonSafe<T>(key: string, validate: (value: unknown) => T | null, fallback: T): Promise<T> {
    let row: { value: unknown } | null;
    try {
      row = await this.prisma.systemSetting.findUnique({ where: { key } });
    } catch (err) {
      this.logger.error(
        `[fail-safe] Failed to read system_settings["${key}"], using hardcoded default: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
      return fallback;
    }

    if (!row) return fallback;

    const validated = validate(row.value);
    if (validated === null) {
      this.logger.error(
        `[fail-safe] system_settings["${key}"] failed validation (got ${JSON.stringify(
          row.value
        )}), using hardcoded default`
      );
      return fallback;
    }
    return validated;
  }

  private async readRow(key: string) {
    try {
      return await this.prisma.systemSetting.findUnique({ where: { key } });
    } catch (err) {
      this.logger.error(
        `Failed to read system_settings["${key}"] from the database: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
      throw err;
    }
  }
}
