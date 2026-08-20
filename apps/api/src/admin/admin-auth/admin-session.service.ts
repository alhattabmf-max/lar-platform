import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { RedisService } from "../../common/redis/redis.service";

export interface AdminSessionData {
  adminUserId: string;
}

const ADMIN_SESSION_KEY_PREFIX = "admin_session:";
const ADMIN_USER_SESSIONS_INDEX_PREFIX = "admin_user_sessions:";

@Injectable()
export class AdminSessionService {
  constructor(private readonly redis: RedisService) {}

  async create(data: AdminSessionData, ttlSeconds: number): Promise<string> {
    const sessionId = randomBytes(32).toString("hex");
    const client = this.redis.getClient();

    await client.set(
      ADMIN_SESSION_KEY_PREFIX + sessionId,
      JSON.stringify(data),
      "EX",
      ttlSeconds
    );
    await client.sadd(ADMIN_USER_SESSIONS_INDEX_PREFIX + data.adminUserId, sessionId);

    return sessionId;
  }

  async get(sessionId: string): Promise<AdminSessionData | null> {
    const raw = await this.redis.getClient().get(ADMIN_SESSION_KEY_PREFIX + sessionId);
    if (!raw) return null;
    return JSON.parse(raw) as AdminSessionData;
  }

  async revoke(sessionId: string): Promise<void> {
    const data = await this.get(sessionId);
    const client = this.redis.getClient();
    await client.del(ADMIN_SESSION_KEY_PREFIX + sessionId);
    if (data) {
      await client.srem(ADMIN_USER_SESSIONS_INDEX_PREFIX + data.adminUserId, sessionId);
    }
  }

  async revokeAllForAdmin(adminUserId: string): Promise<void> {
    const client = this.redis.getClient();
    const indexKey = ADMIN_USER_SESSIONS_INDEX_PREFIX + adminUserId;
    const sessionIds = await client.smembers(indexKey);
    if (sessionIds.length > 0) {
      await client.del(...sessionIds.map((id: string) => ADMIN_SESSION_KEY_PREFIX + id));
    }
    await client.del(indexKey);
  }
}
