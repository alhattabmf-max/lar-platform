import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { RedisService } from "../redis/redis.service";

export interface SessionData {
  userId: string;
  companyId: string;
  accountType: "TRADER" | "SUPPLIER";
}

const SESSION_KEY_PREFIX = "session:";
const USER_SESSIONS_INDEX_PREFIX = "user_sessions:";

/**
 * Default session lifetime. Hardcoded for Phase 2 — becomes an
 * admin-configurable `system_settings` value once the Admin Portal
 * ships (Blueprint §62 pattern), same as other operational durations
 * (hold duration, dispute window, etc.).
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

@Injectable()
export class SessionService {
  constructor(private readonly redis: RedisService) {}

  async create(data: SessionData): Promise<string> {
    const sessionId = randomBytes(32).toString("hex");
    const client = this.redis.getClient();

    await client.set(
      SESSION_KEY_PREFIX + sessionId,
      JSON.stringify(data),
      "EX",
      SESSION_TTL_SECONDS
    );
    await client.sadd(USER_SESSIONS_INDEX_PREFIX + data.userId, sessionId);

    return sessionId;
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const raw = await this.redis.getClient().get(SESSION_KEY_PREFIX + sessionId);
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  }

  async revoke(sessionId: string): Promise<void> {
    const data = await this.get(sessionId);
    const client = this.redis.getClient();
    await client.del(SESSION_KEY_PREFIX + sessionId);
    if (data) {
      await client.srem(USER_SESSIONS_INDEX_PREFIX + data.userId, sessionId);
    }
  }

  /**
   * Revokes every session belonging to a user — used after a password
   * reset/change, per the security rule that changing a credential
   * invalidates all previously issued sessions.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    const client = this.redis.getClient();
    const indexKey = USER_SESSIONS_INDEX_PREFIX + userId;
    const sessionIds = await client.smembers(indexKey);

    if (sessionIds.length > 0) {
      await client.del(...sessionIds.map((id) => SESSION_KEY_PREFIX + id));
    }
    await client.del(indexKey);
  }
}
