import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds DRAFT (unpublished) placeholder policy content only.
 *
 * This is deliberate: registration is fail-closed when zero mandatory
 * PUBLISHED policies exist (see PoliciesService.assertMandatoryPoliciesAccepted),
 * so seeding these as published would let the system silently accept
 * registrations against placeholder legal text. Publishing a policy
 * version is a separate, explicit, authorized action — not something
 * this seed script (or any automated process) performs.
 */
async function main(): Promise<void> {
  const documents = [
    { code: "terms_of_service", label: "Terms of Service" },
    { code: "privacy_policy", label: "Privacy Policy" },
  ];

  for (const doc of documents) {
    const policyDocument = await prisma.policyDocument.upsert({
      where: { code: doc.code },
      create: { code: doc.code },
      update: {},
    });

    const existingDraft = await prisma.policyVersion.findFirst({
      where: { policyDocumentId: policyDocument.id, versionLabel: "placeholder-v0" },
    });

    if (!existingDraft) {
      await prisma.policyVersion.create({
        data: {
          policyDocumentId: policyDocument.id,
          versionLabel: "placeholder-v0",
          textAr: `[Placeholder — ${doc.label} — بانتظار المراجعة القانونية قبل النشر]`,
          textEn: `[Placeholder — ${doc.label} — pending legal review before publishing]`,
          isPublished: false,
          isMandatory: true,
          requiresReacceptance: false,
        },
      });
      console.log(`Seeded DRAFT placeholder for "${doc.code}" (unpublished).`);
    }
  }

  console.log(
    "Seed complete. No policy is published — registration will remain fail-closed until an authorized action publishes real, legally-reviewed content."
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
