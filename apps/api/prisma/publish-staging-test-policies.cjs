/**
 * One-time staging registration fixture. Run only against the staging database:
 * STAGING_TEST_POLICIES=publish node prisma/publish-staging-test-policies.cjs
 * Never called by migrations, application startup, or the standard seed.
 */
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

if (process.env.STAGING_TEST_POLICIES !== 'publish') {
  throw new Error('Staging only: set STAGING_TEST_POLICIES=publish explicitly.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required; verify that it points to staging.');
}

const prisma = new PrismaClient();
const documents = [
  {
    code: 'terms_of_service',
    textAr: 'نسخة تجريبية لاختبار التسجيل في منصة لار فقط. لا تنشئ هذه النسخة طلب شراء أو التزامًا تجاريًا فعليًا.',
    textEn: 'Test version for registration on the LAR staging platform only. It does not create a real purchase order or commercial commitment.',
  },
  {
    code: 'privacy_policy',
    textAr: 'تُستخدم المعلومات المدخلة في هذه النسخة لاختبار وظائف المنصة فقط. يرجى عدم إدخال بيانات شخصية حقيقية أثناء التجربة.',
    textEn: 'Information entered here is used only to test the staging platform. Please do not enter real personal information during testing.',
  },
];

async function main() {
  for (const item of documents) {
    const result = await prisma.$transaction(async (tx) => {
      const document = await tx.policyDocument.upsert({
        where: { code: item.code },
        create: { code: item.code },
        update: {},
      });
      const active = await tx.policyVersion.findFirst({
        where: { policyDocumentId: document.id, isPublished: true },
      });
      if (active) return 'already published; left unchanged';

      const version = await tx.policyVersion.create({
        data: {
          policyDocumentId: document.id,
          versionLabel: 'staging-test-v1',
          textAr: item.textAr,
          textEn: item.textEn,
          isMandatory: true,
          isPublished: true,
          publishedAt: new Date(),
          requiresReacceptance: false,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'POLICY_VERSION_PUBLISHED',
          entityType: 'policy_version',
          entityId: version.id,
          requestId: randomUUID(),
          reason: 'Explicit staging-only registration test fixture',
          afterData: { documentCode: item.code, versionLabel: version.versionLabel },
        },
      });
      return 'test version published';
    });
    console.log(`${item.code}: ${result}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
