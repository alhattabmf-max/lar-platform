import { AdminReasonBodyDto } from "../../../common/contracts/admin-reason.dto";

/**
 * The reason an administrator gives for acting on another's access.
 *
 * The bounds and the trim behaviour moved to
 * `common/contracts/admin-reason.dto.ts` once five other administrative
 * denials needed exactly the same rule. A per-module copy is how one of
 * them ends up with a different minimum.
 *
 * Re-exported under its original name so the controllers that reference
 * it do not have to care where the rule lives.
 */
export class AdminReasonDto extends AdminReasonBodyDto {}

export { ADMIN_REASON_MAX, ADMIN_REASON_MIN } from "../../../common/contracts/admin-reason.constants";
