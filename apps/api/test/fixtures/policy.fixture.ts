import type { PrismaClient } from "@prisma/client";

/**
 * ONE published mandatory policy, shared by every suite.
 *
 * Tests need a genuinely PUBLISHED mandatory policy to exercise the
 * registration success path and the checkout policy gate. This is
 * deliberately NOT the production seed (prisma/seed.ts only ever
 * creates DRAFT placeholders — see its header comment for why).
 *
 * IT USED TO PUBLISH A NEW POLICY DOCUMENT ON EVERY CALL, and that made
 * the whole shared-database test suite non-deterministic. The checkout
 * gate asks whether the buyer accepted «the newest mandatory version of
 * each document in force». A fixture accepts what is mandatory at the
 * moment it seeds; the instant any other spec — in another Jest worker,
 * milliseconds later — published a brand-new mandatory document, every
 * trader already seeded became non-compliant, and unrelated suites
 * failed with «You must accept the latest platform policy first» in
 * their payment, fulfilment and dispute paths. The documents also
 * accumulated in the database for ever, one per call, for ever.
 *
 * So it is now find-or-create on a FIXED code: the first run creates
 * the version, every run after reuses it, and no suite can invalidate
 * another's trader. A test that needs a trader who has NOT accepted the
 * policy in force asks for exactly that, with
 * `withdrawPolicyAcceptances` below, instead of moving the goalposts
 * for everyone.
 *
 * Publishing uses the two-step insert-then-flip that the immutability
 * trigger allows (false→true), exactly like a real legal-content
 * publish.
 */
const SHARED_TEST_POLICY_CODE = "test_policy_shared";

export async function publishTestPolicy(
  prisma: PrismaClient,
  code = SHARED_TEST_POLICY_CODE
): Promise<{ id: string; code: string }> {
  const existing = await prisma.policyVersion.findFirst({
    where: { isPublished: true, isMandatory: true, policyDocument: { code } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { id: existing.id, code };

  // Several workers reach this at once on a fresh database; `code` is
  // unique, so the losers read the winner's row back rather than fail.
  await prisma.$executeRaw`
    INSERT INTO policy_documents (code) VALUES (${code}) ON CONFLICT (code) DO NOTHING
  `;
  const document = await prisma.policyDocument.findUniqueOrThrow({ where: { code } });

  const version = await prisma.policyVersion.create({
    data: {
      policyDocumentId: document.id,
      versionLabel: "test-v1",
      textAr: "نص اختبار",
      textEn: "Test policy text",
      isPublished: false,
      isMandatory: true,
    },
  });

  await prisma.policyVersion.update({
    where: { id: version.id },
    data: { isPublished: true, publishedAt: new Date() },
  });

  return { id: version.id, code };
}

/**
 * Makes ONE company non-compliant, and nobody else.
 *
 * The state a policy-gate test needs is «this trader has not accepted
 * the mandatory policies in force». Removing that company's
 * acceptances produces it exactly, locally, and leaves every other
 * company in the shared database untouched — which publishing a new
 * mandatory document did not.
 *
 * Returns how many acceptances were removed, so a caller can assert it
 * actually changed something rather than testing a trader who never
 * accepted anything.
 */
export async function withdrawPolicyAcceptances(
  prisma: PrismaClient,
  companyId: string
): Promise<number> {
  const { count } = await prisma.policyAcceptance.deleteMany({ where: { companyId } });
  return count;
}
