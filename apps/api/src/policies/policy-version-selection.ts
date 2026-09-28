/**
 * WHICH POLICY VERSION IS IN FORCE — the one rule, in one place.
 *
 * A PUBLISHED VERSION IS PERMANENT. `policy_versions` carries a trigger
 * that raises on any update to a published row and on any delete of
 * one, so "in force" cannot be a flag somebody turns off. It is
 * whichever published version of a document is NEWEST, decided on every
 * read.
 *
 * THIS FILE EXISTS BECAUSE THAT RULE WAS WRITTEN TWICE AND OBEYED ONCE.
 * `PoliciesService` selected the newest per document and told a
 * registrant to accept exactly those — two boxes, one per document.
 * The checkout guard and the payment attempt asked instead for EVERY
 * published mandatory row, and the two answers stopped agreeing the
 * moment a second version of any document was published:
 *
 *   terms_of_service  placeholder-v0            published 23 Aug
 *   terms_of_service  check-…-edited            published 29 Aug
 *   terms_of_service  placeholder-v0-restored   published 29 Aug
 *   privacy_policy    placeholder-v0            published 23 Aug
 *
 * Registration asked for two of those four and recorded two. Checkout
 * demanded all four and refused every buyer on the platform — with
 * «يلزم قبول السياسات المحدّثة» and a reference number — for want of
 * consent to two superseded texts that no screen has ever offered and
 * that no trigger will let anybody withdraw. It was not a policy a
 * buyer had missed; it was a condition nobody could satisfy.
 *
 * A PURE FUNCTION, not a service method: the checkout guard runs inside
 * a transaction and reads its rows through `tx`, so what it needs is
 * the SELECTION, not another database client.
 */

/** The fields the selection needs. Anything wider is accepted. */
export interface PolicyVersionOrdering {
  id: string;
  policyDocumentId: string;
  publishedAt: Date | null;
  createdAt: Date;
}

/**
 * Ties break on `createdAt`, then on id: two rows published in the same
 * millisecond must still order the same way on every read, or a
 * registrant could be shown one version and have their acceptance
 * checked against the other.
 */
export function isNewerPolicyVersion(
  a: PolicyVersionOrdering,
  b: PolicyVersionOrdering,
): boolean {
  const at = a.publishedAt?.getTime() ?? 0;
  const bt = b.publishedAt?.getTime() ?? 0;
  if (at !== bt) return at > bt;
  const ac = a.createdAt.getTime();
  const bc = b.createdAt.getTime();
  if (ac !== bc) return ac > bc;
  return a.id > b.id;
}

/** One row per document: the most recently published. */
export function newestPolicyVersionPerDocument<T extends PolicyVersionOrdering>(
  rows: readonly T[],
): T[] {
  const newest = new Map<string, T>();
  for (const row of rows) {
    const held = newest.get(row.policyDocumentId);
    if (!held || isNewerPolicyVersion(row, held)) newest.set(row.policyDocumentId, row);
  }
  return [...newest.values()];
}
