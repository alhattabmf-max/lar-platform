import type { PrismaClient } from "@prisma/client";

/**
 * Integration tests need a genuinely PUBLISHED mandatory policy to
 * exercise the registration success path. This is deliberately NOT
 * the production seed (prisma/seed.ts only ever creates DRAFT
 * placeholders — see its header comment for why). Publishing here
 * uses raw SQL for the initial insert to bypass the immutability
 * trigger correctly (insert as unpublished, then flip once — the
 * trigger allows the false→true transition, exactly like a real
 * legal-content publish would).
 */
export async function publishTestPolicy(
  prisma: PrismaClient,
  code = `test_policy_${Date.now()}_${Math.random().toString(36).slice(2)}`
): Promise<{ id: string; code: string }> {
  const document = await prisma.policyDocument.create({ data: { code } });

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
