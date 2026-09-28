import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { SESSION_COOKIE_NAME } from "./session-cookie.constants";
import { ADMIN_SESSION_COOKIE_NAME } from "../../admin/admin-auth/admin-session-cookie.constants";

/**
 * WHO THE RATE LIMIT IS COUNTING — the visitor, not the web server.
 *
 * THE DEFECT THIS FIXES. The stock guard buckets by `req.ip`, and on
 * this platform almost nothing arrives from a visitor's own address:
 * the pages are rendered on the server, so the reads that fill a
 * screen are made BY the Next.js process and arrive from 127.0.0.1.
 * Every signed-in supplier, buyer and administrator was therefore
 * sharing ONE budget of 100 requests a minute — and a single product
 * page spends four of them while the catalogue spends one per row.
 *
 * The owner met the result as «تعذّر إتمام الطلب» on a page that was
 * working perfectly: a 429 that no user had earned, produced by the
 * traffic of everyone else on the platform.
 *
 * THE SESSION IS THE VISITOR. When a request carries a session cookie
 * that cookie identifies exactly one signed-in person, whatever
 * address the request reached us from, and it is the honest unit to
 * count. Anonymous traffic keeps the IP, which is all there is to
 * count it by.
 *
 * THE COOKIE IS HASHED, NEVER USED RAW. The tracker's return value
 * becomes a Redis key — it is stored, and it can be read by anybody
 * who can read the keyspace. A session id in that position is a
 * credential in a place credentials must not be. SHA-256 gives a
 * stable bucket per session and reveals nothing.
 *
 * WHAT THIS DOES NOT LOOSEN. The login and password-reset limits
 * (5/min, set at their controllers) are the ones that matter for
 * abuse, and they are reached WITHOUT a session — so they keep the IP
 * bucket exactly as before. Nothing about them changes.
 *
 * AND IT DOES NOT WEAKEN THE GLOBAL LIMIT EITHER: 100 a minute per
 * signed-in visitor is stricter per person than 100 shared, not
 * looser. What went away is one visitor being refused because of
 * another's browsing.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    // The admin cookie first: an operator's browser may hold both, and
    // the console is the surface whose reads are heaviest.
    const session = cookies?.[ADMIN_SESSION_COOKIE_NAME] ?? cookies?.[SESSION_COOKIE_NAME];

    if (typeof session === "string" && session.length > 0) {
      return `s:${createHash("sha256").update(session).digest("hex")}`;
    }

    // NOT VALIDATED HERE, and it does not need to be. A forged cookie
    // buys its holder their own bucket and nothing else; the session
    // guard refuses the request a moment later either way.
    return `ip:${req.ip ?? "unknown"}`;
  }
}
