import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { RedisService } from "../../common/redis/redis.service";

export type LoginTicketStage = "AWAITING_2FA_SETUP" | "AWAITING_2FA_VERIFY";

export interface LoginTicketData {
  adminUserId: string;
  stage: LoginTicketStage;
  /**
   * Only present while stage=AWAITING_2FA_SETUP: the encrypted secret
   * and recovery-code hashes are held here, NOT written to admin_users,
   * until the operator proves control by confirming one valid code.
   * This avoids persisting a 2FA secret that was never actually
   * verified to work.
   */
  pendingSecretEncrypted?: string;
  pendingRecoveryCodeHashes?: string[];
}

const TICKET_KEY_PREFIX = "admin_login_ticket:";
const TICKET_TTL_SECONDS = 5 * 60; // 5 minutes

@Injectable()
export class AdminLoginTicketService {
  constructor(private readonly redis: RedisService) {}

  async create(data: LoginTicketData): Promise<string> {
    const ticket = randomBytes(32).toString("hex");
    await this.redis
      .getClient()
      .set(TICKET_KEY_PREFIX + ticket, JSON.stringify(data), "EX", TICKET_TTL_SECONDS);
    return ticket;
  }

  async get(ticket: string): Promise<LoginTicketData | null> {
    const raw = await this.redis.getClient().get(TICKET_KEY_PREFIX + ticket);
    if (!raw) return null;
    return JSON.parse(raw) as LoginTicketData;
  }

  async update(ticket: string, data: LoginTicketData): Promise<void> {
    await this.redis
      .getClient()
      .set(TICKET_KEY_PREFIX + ticket, JSON.stringify(data), "KEEPTTL");
  }

  async consume(ticket: string): Promise<void> {
    await this.redis.getClient().del(TICKET_KEY_PREFIX + ticket);
  }
}
