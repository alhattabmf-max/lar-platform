/**
 * Bootstrap the first Admin user. Operational CLI only — there is no
 * HTTP self-registration path for admins anywhere in the codebase.
 *
 * Usage:
 *   ADMIN_BOOTSTRAP_EMAIL=ops@example.com \
 *   ADMIN_BOOTSTRAP_PASSWORD='<strong password from your password manager>' \
 *   node dist/cli/bootstrap-admin.js
 *
 * Idempotent: if an admin with this email already exists, the script
 * reports that and exits 0 without changing anything (it never
 * silently resets an existing admin's password).
 *
 * Deliberately reads ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD
 * directly from process.env rather than through packages/config's
 * loadEnv() — those two variables are only relevant to this one-off
 * script, and requiring every environment (including the running API
 * process, tests, and CI) to define them would be a needless
 * dependency for something that runs once per deployment.
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../common/security/argon2.util";

const MIN_PASSWORD_LENGTH = 12;

async function main(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!email) {
    console.error("ADMIN_BOOTSTRAP_EMAIL is required and was not set. Aborting.");
    process.exitCode = 1;
    return;
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `ADMIN_BOOTSTRAP_PASSWORD is required and must be at least ${MIN_PASSWORD_LENGTH} characters. Aborting.`
    );
    process.exitCode = 1;
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("ADMIN_BOOTSTRAP_EMAIL is not a valid email address. Aborting.");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();

  try {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      console.log(
        `Admin "${email}" already exists (id=${existing.id}, status=${existing.status}). No action taken.`
      );
      return;
    }

    const passwordHash = await hashPassword(password);
    const admin = await prisma.adminUser.create({
      data: { email, passwordHash },
    });

    console.log(`Created admin "${email}" (id=${admin.id}).`);
    console.log(
      "2FA is NOT yet enrolled for this account — it will be required on first login " +
        "(POST /api/v1/admin/auth/login will return stage=SETUP_REQUIRED)."
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Bootstrap failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
