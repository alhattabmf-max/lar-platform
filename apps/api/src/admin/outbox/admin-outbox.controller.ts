import { Controller, Get, UseGuards } from "@nestjs/common";
import type { OutboxStats } from "@platform/types";
import { AdminOutboxService } from "./admin-outbox.service";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";

/**
 * Relay health.
 *
 * One GET, read-only, so no `CsrfGuard`. There is deliberately no retry
 * and no delete: a manual retry on a table with a lease and a backoff is
 * a way to race the relay, and a delete loses an intent that was written
 * inside a business transaction. Both are deferred beyond Phase 8.
 */
@Controller("admin/outbox")
@UseGuards(AdminSessionAuthGuard)
export class AdminOutboxController {
  constructor(private readonly outbox: AdminOutboxService) {}

  @Get("stats")
  stats(): Promise<OutboxStats> {
    return this.outbox.stats();
  }
}
