import type { Request } from "express";
import { getRequestId } from "../common/logger/request-id.util";

/**
 * WHO ASKED, FROM WHERE — the three fields every audited write carries.
 *
 * IT LIVES HERE RATHER THAN IN A CONTROLLER because two controllers in
 * this module now need it: `auth.controller` for registration and the
 * password and verification flows, and `me.controller` for the email
 * change. A second copy would be a second place for the request id to
 * be read differently, which is exactly how an audit trail comes to
 * disagree with the logs about the same request.
 */
export function ctxFrom(req: Request) {
  return {
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}
