import "reflect-metadata";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readdirSync, readFileSync } from "fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "os";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { runBackfill } from "../src/cli/backfill-financial-snapshots";
import { runVerificationGate } from "../src/cli/verify-financial-snapshots-gate";
import {
  createScratchDatabase,
  dropScratchDatabase,
  migrateInto,
  scratchUrl,
} from "./scratch-database";

const API_ROOT = join(__dirname, "..");
const ALL_MIGRATIONS_DIR = join(API_ROOT, "prisma", "migrations");
const SCHEMA_PATH = join(API_ROOT, "prisma", "schema.prisma");
/**
 * Built from `DATABASE_URL`, not written out here.
 *
 * The literals this replaces pinned host, port and credentials, so the
 * suite ignored the very redirection that keeps tests off the
 * development database.
 */
const DB_NAME = `platform_upgrade_regression_${Date.now()}`;
const DB_URL = scratchUrl(DB_NAME);

function listMigrationFolders(): string[] {
  return readdirSync(ALL_MIGRATIONS_DIR)
    .filter((f) => f !== "migration_lock.toml")
    .sort();
}

function ensureIsolatedSchema(workDir: string): void {
  mkdirSync(join(workDir, "migrations"), { recursive: true });
  cpSync(join(ALL_MIGRATIONS_DIR, "migration_lock.toml"), join(workDir, "migrations", "migration_lock.toml"));
  writeFileSync(join(workDir, "schema.prisma"), readFileSync(SCHEMA_PATH, "utf8"));
}

/** Copies migrations[fromIndex..toIndexExclusive) into the isolated dir and deploys — an explicit, bounded range, never "everything remaining". */
function deployRange(workDir: string, allMigrations: string[], fromIndex: number, toIndexExclusive: number): void {
  const migDir = join(workDir, "migrations");
  for (const name of allMigrations.slice(fromIndex, toIndexExclusive)) {
    cpSync(join(ALL_MIGRATIONS_DIR, name), join(migDir, name), { recursive: true });
  }
  migrateInto(DB_URL, { cwd: API_ROOT, schema: join(workDir, "schema.prisma") });
}

describe("Upgrade path regression: DB@63 -> Release A -> Backfill+Gate (current Prisma Client) -> remaining migrations to 87", () => {
  let workDir: string;
  let scopedPrisma: PrismaClient;
  let allMigrations: string[];
  let releaseAEndIndex: number; // exclusive — first Release B migration sits at this index

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "upgrade-regression-"));
    ensureIsolatedSchema(workDir);
    allMigrations = listMigrationFolders();
    releaseAEndIndex = allMigrations.findIndex((m) => m.includes("7e_expand_allow_backfill_columns")) + 1;
    expect(releaseAEndIndex).toBeGreaterThan(63);

    await createScratchDatabase(DB_NAME);

    // 1. DB at migration 63.
    deployRange(workDir, allMigrations, 0, 63);

    // Minimal real 7D data: one MasterOrder with a NON-ZERO shipping fee, at revision 63.
    const seedPrisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    try {
      await seedPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO regions (id, name_ar, name_en, updated_at) VALUES ('a1111111-1111-1111-1111-111111111111', 'ر', 'R', now())`;
        await tx.$executeRaw`INSERT INTO cities (id, region_id, name_ar, name_en, updated_at) VALUES ('a2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'م', 'C', now())`;
        await tx.$executeRaw`INSERT INTO taxonomy_nodes (id, name_ar, name_en, updated_at) VALUES ('a3333333-3333-3333-3333-333333333333', 'ف', 'Cat', now())`;
        await tx.$executeRaw`INSERT INTO companies (id, cr_number, legal_name, account_type, verification_status, updated_at) VALUES ('a4444444-4444-4444-4444-444444444444', 'CR-REGSUP', 'Reg Supplier', 'SUPPLIER', 'VERIFIED', now())`;
        await tx.$executeRaw`INSERT INTO companies (id, cr_number, legal_name, account_type, verification_status, updated_at) VALUES ('a5555555-5555-5555-5555-555555555555', 'CR-REGTRD', 'Reg Trader', 'TRADER', 'VERIFIED', now())`;
        await tx.$executeRaw`INSERT INTO users (id, company_id, email, password_hash, role, status, primary_mobile_1, primary_mobile_2, updated_at) VALUES ('a6666666-6666-6666-6666-666666666666', 'a4444444-4444-4444-4444-444444444444', 'reg-sup@x.com', 'x', 'OWNER', 'ACTIVE', '+966501110001', '+966501110002', now())`;
        await tx.$executeRaw`INSERT INTO users (id, company_id, email, password_hash, role, status, primary_mobile_1, primary_mobile_2, updated_at) VALUES ('a7777777-7777-7777-7777-777777777777', 'a5555555-5555-5555-5555-555555555555', 'reg-trd@x.com', 'x', 'OWNER', 'ACTIVE', '+966502220001', '+966502220002', now())`;
        await tx.$executeRaw`INSERT INTO company_locations (id, company_id, name, short_address, latitude, longitude, contact_name, contact_phone, city_id, updated_at) VALUES ('a8888888-8888-8888-8888-888888888888', 'a5555555-5555-5555-5555-555555555555', 'Branch', 'Addr', 24.7, 46.6, 'C', '+966503330001', 'a2222222-2222-2222-2222-222222222222', now())`;
        await tx.$executeRaw`INSERT INTO supplier_bank_accounts (id, company_id, account_holder_name, bank_name, iban_ciphertext, iban_fingerprint, iban_last4, verification_status, updated_at) VALUES ('a9999999-9999-9999-9999-999999999999', 'a4444444-4444-4444-4444-444444444444', 'H', 'B', 'ct', 'fp-reg', '1234', 'VERIFIED', now())`;
        await tx.$executeRaw`INSERT INTO products (id, company_id, taxonomy_node_id, sales_unit_name_ar, sales_unit_name_en, name_ar, name_en, weight_per_unit, length_cm, width_cm, height_cm, approval_status, updated_at) VALUES ('aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a4444444-4444-4444-4444-444444444444', 'a3333333-3333-3333-3333-333333333333', 'ق', 'P', 'م', 'Prod', 1, 1, 1, 1, 'APPROVED', now())`;
        await tx.$executeRaw`INSERT INTO product_approval_snapshots (id, product_id, snapshot, approval_source, approved_at) VALUES ('aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{}', 'AUTO', now())`;
        await tx.$executeRaw`INSERT INTO shipping_tariff_policy_versions (id, version, same_city_fee_amount, same_region_different_city_fee_amount, different_region_fee_amount, created_by) VALUES ('aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 10, 20, 30, 'a6666666-6666-6666-6666-666666666666')`;
        const [{ id: commissionPolicyId }] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO commission_policy_versions (id, version, rate_basis_points, created_by) VALUES (gen_random_uuid(), 999, 500, 'a6666666-6666-6666-6666-666666666666') RETURNING id`;
        const [{ id: shareTierId }] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM share_tier_policy_versions ORDER BY version DESC LIMIT 1`;

        await tx.$executeRaw`
          INSERT INTO opportunities (
            id, company_id, product_id, fulfillment_location_id, fulfillment_city_id, fulfillment_city_name_ar, fulfillment_city_name_en,
            fulfillment_region_id, fulfillment_region_name_ar, fulfillment_region_name_en, product_approval_snapshot_id,
            target_quantity, funded_quantity, unit_price_amount, start_at, end_at, expected_preparation_days, status,
            first_activated_at, sales_unit_name_ar, sales_unit_name_en, commission_policy_version_id, commission_rate_basis_points, updated_at,
            total_value_incl_tax_amount, share_tier_policy_version_id, share_tier_index, share_basis_points, share_quantity,
            tax_rate_percent, unit_price_excl_tax_amount, unit_tax_amount, tax_calculation_rule_code, tax_calculation_rule_version
          ) VALUES (
            'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a4444444-4444-4444-4444-444444444444', 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a8888888-8888-8888-8888-888888888888',
            'a2222222-2222-2222-2222-222222222222', 'م', 'C', 'a1111111-1111-1111-1111-111111111111', 'ر', 'R', 'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            100, 10, 33.33, now() - interval '30 days', now() + interval '30 days', 3, 'ACTIVE',
            now() - interval '30 days', 'ق', 'P', ${commissionPolicyId}::uuid, 500, now(),
            333.30, ${shareTierId}::uuid, 0, 10000, 100,
            15, 28.98, 4.35, 'STANDARD_VAT', 'v1'
          )
        `;

        await tx.$executeRaw`
          INSERT INTO checkout_sessions (id, opportunity_id, trader_company_id, status, locked_quantity, lock_created_at, lock_expires_at, lock_released_at, payment_deadline_at, captured_at, trader_company_snapshot, updated_at)
          VALUES ('aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5555555-5555-5555-5555-555555555555', 'PAID', 4, now() - interval '5 days', now() - interval '5 days' + interval '15 minutes', now() - interval '5 days', now() - interval '5 days' + interval '15 minutes', now() - interval '5 days', '{}', now())
        `;
        await tx.$executeRaw`
          INSERT INTO quote_snapshots (id, checkout_session_id, product_approval_snapshot_id, sales_unit_name_ar, sales_unit_name_en, quantity, share_quantity, share_percentage_readable,
            unit_price_incl_tax_amount, unit_price_excl_tax_amount, unit_tax_amount, tax_rate_percent, tax_calculation_rule_code, tax_calculation_rule_version,
            products_subtotal_excl_tax_amount, products_tax_amount, products_subtotal_incl_tax_amount, total_shipping_fee_amount, grand_total_amount,
            shipping_tariff_policy_version_id, shipping_provider_code, created_at)
          VALUES ('aaaaaaa6-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ق', 'P', 4, 4, 100,
            33.33, 28.98, 4.35, 15, 'STANDARD_VAT', 'v1',
            115.92, 17.40, 133.32, 15.00, 148.32,
            'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'MOCK', now() - interval '5 days')
        `;
        await tx.$executeRaw`
          INSERT INTO checkout_location_allocations (id, checkout_session_id, company_location_id, location_name_snapshot, city_name_ar_snapshot, city_name_en_snapshot,
            region_name_ar_snapshot, region_name_en_snapshot, address_snapshot, contact_name_snapshot, contact_phone_snapshot, quantity, shipping_tier_code, shipping_fee_amount, created_at)
          VALUES ('aaaaaaa7-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a8888888-8888-8888-8888-888888888888', 'Branch', 'م', 'C', 'ر', 'R', 'Addr', 'C', '+966503330001', 4, 'SAME_CITY', 15.00, now() - interval '5 days')
        `;
        await tx.$executeRaw`
          INSERT INTO payment_attempts (id, checkout_session_id, status, provider_code, provider_reference, idempotency_key, amount, currency, provider_captured_at, provider_captured_amount, created_at, updated_at)
          VALUES ('aaaaaaa8-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SUCCEEDED', 'MOCK', 'prov-ref-reg', 'reg-idem-1', 148.32, 'SAR', now() - interval '5 days', 148.32, now() - interval '5 days', now())
        `;
        await tx.$executeRaw`
          INSERT INTO master_orders (id, checkout_session_id, opportunity_id, trader_company_id, supplier_company_id, payment_attempt_id, supplier_bank_account_id,
            status, total_amount, commission_base, commission_rate_basis_points, commission_amount, commission_tax_rate, commission_tax_rule_code, commission_tax_rule_version,
            commission_tax_amount, supplier_payable_amount, supplier_legal_name_snapshot, supplier_cr_number_snapshot, supplier_tax_profile_snapshot, supplier_invoicing_profile_snapshot,
            paid_at, created_at)
          VALUES ('aaaaaaa9-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5555555-5555-5555-5555-555555555555', 'a4444444-4444-4444-4444-444444444444',
            'aaaaaaa8-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a9999999-9999-9999-9999-999999999999',
            'FULFILLED', 148.32, 115.92, 500, 5.80, 5, 'STANDARD_VAT', 'v1', 0.29, 142.23, 'Reg Supplier', 'CR-REGSUP', '{"isVatRegistered":false}', '{"invoicingLegalName":"Reg Supplier"}',
            now() - interval '5 days', now() - interval '5 days')
        `;
        await tx.$executeRaw`
          INSERT INTO order_allocations (id, master_order_id, checkout_location_allocation_id, status, expected_preparation_days, preparation_due_at,
            preparation_started_at, ready_to_ship_at, shipped_at, delivered_at, created_at)
          VALUES ('aaaaaaba-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa9-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaa7-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DELIVERED', 3,
            now() - interval '4 days', now() - interval '4 days', now() - interval '3 days', now() - interval '2 days', now() - interval '1 days', now() - interval '5 days')
        `;
        await tx.$executeRaw`INSERT INTO shipment_tracking (id, order_allocation_id, carrier_code, tracking_number, shipped_by_user_id) VALUES ('aaaaaabb-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaba-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'MOCK', 'REG-TRACK', 'a6666666-6666-6666-6666-666666666666')`;
        await tx.$executeRaw`INSERT INTO delivery_confirmations (id, order_allocation_id, confirmed_by_source, confirmed_at, confirmed_by_user_id) VALUES ('aaaaaabc-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaba-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TRADER_CONFIRMATION', now() - interval '1 days', 'a7777777-7777-7777-7777-777777777777')`;
      });
    } finally {
      await seedPrisma.$disconnect();
    }

    // 2. Apply Release A ONLY (bounded range, never "everything remaining").
    deployRange(workDir, allMigrations, 63, releaseAEndIndex);

    scopedPrisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  }, 120_000);

  afterAll(async () => {
    await scopedPrisma?.$disconnect();
    await dropScratchDatabase(DB_NAME);
    rmSync(workDir, { recursive: true, force: true });
  }, 60_000);

  it("Backfill (via the current generated Prisma Client) succeeds against a DB at Release A only — never attempting to read Release B columns", async () => {
    const report = await runBackfill(scopedPrisma, { dryRun: false, batchSize: 50 });
    expect(report.failures).toEqual([]);
    expect(report.processedMasterOrderIds).toHaveLength(1);
  }, 30_000);

  it("Gate passes, and the non-zero-shipping formula holds exactly: SUM(supplierPayableShareAmount) = MasterOrder.supplierPayableAmount - SUM(shippingFeeAmount)", async () => {
    const failures = await runVerificationGate(scopedPrisma);
    expect(failures).toEqual([]);

    const snapshot = await scopedPrisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: "aaaaaaba-aaaa-aaaa-aaaa-aaaaaaaaaaaa" } });
    const order = await scopedPrisma.masterOrder.findUniqueOrThrow({ where: { id: "aaaaaaa9-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }, select: { supplierPayableAmount: true } });
    expect(Number(snapshot.shippingFeeAmount)).toBeGreaterThan(0);
    expect(Number(snapshot.supplierPayableShareAmount)).toBe(Math.round((Number(order.supplierPayableAmount) - Number(snapshot.shippingFeeAmount)) * 100) / 100);
  }, 15_000);

  it("re-running Backfill is a true no-op: same snapshot count, same values, nothing reprocessed", async () => {
    const before = await scopedPrisma.orderAllocationFinancialSnapshot.findMany({ orderBy: { orderAllocationId: "asc" } });
    const report = await runBackfill(scopedPrisma, { dryRun: false, batchSize: 50 });
    expect(report.processedMasterOrderIds).toEqual([]);
    expect(report.failures).toEqual([]);
    const after = await scopedPrisma.orderAllocationFinancialSnapshot.findMany({ orderBy: { orderAllocationId: "asc" } });
    expect(after).toEqual(before);
  }, 15_000);

  it("applying the remaining migrations (Release B through the latest) succeeds against the backfilled data", () => {
    expect(() => deployRange(workDir, allMigrations, releaseAEndIndex, allMigrations.length)).not.toThrow();
  }, 60_000);

  it("Zero Drift: the fully-upgraded database matches the current schema.prisma exactly — no diff script", async () => {
    // THE SHADOW DATABASE IS MADE THE SAME WAY AS EVERY OTHER ONE HERE:
    // a statement over a connection, not `psql` on a command line. This
    // test never once reached its own assertion on this project's
    // machine, because there is no Postgres client on the host at all —
    // the server runs in a container — and the failure said nothing
    // about drift.
    const shadowDbName = `${DB_NAME}_shadow`;
    const shadowUrl = await createScratchDatabase(shadowDbName);
    try {
      const diffOutput = execFileSync(
        "npx",
        [
          "prisma",
          "migrate",
          "diff",
          "--from-migrations",
          "./prisma/migrations",
          "--to-schema-datamodel",
          "./prisma/schema.prisma",
          "--shadow-database-url",
          shadowUrl,
          "--script",
        ],
        {
          cwd: API_ROOT,
          env: { ...process.env, DATABASE_URL: DB_URL },
          stdio: "pipe",
          shell: process.platform === "win32",
        }
      ).toString();
      // AN EXACT MATCH PRODUCES ONLY THE EMPTY-MIGRATION COMMENT. Any
      // other statement means the upgraded database and schema.prisma
      // have diverged — EXCEPT for the divergences named below, each of
      // which is a deliberate one this repository has decided to carry.
      //
      // NAMED ONE BY ONE, never matched by a loose pattern. A rule like
      // "ignore every DropIndex" would hide the next real one.
      //
      // 1-4. THE FOUR TRIGRAM INDEXES. `USING GIN (... gin_trgm_ops)`
      //      cannot be written in Prisma's schema language at all, so
      //      they live in their migrations alone and this diff asks to
      //      drop them on every run. They are what makes `ILIKE
      //      '%term%'` an index lookup instead of a sequential scan on
      //      the two registers; see
      //      20260915100200_trigram_index_on_the_column_the_query_names
      //      and 20260915110000_index_the_product_register.
      //
      // 5.   `company_locations.city_id`. The migrated constraint and
      //      the schema's disagree about the delete rule, and that is
      //      RECORDED DEBT, not news: the database refuses what the
      //      service supports, and correcting it needs its own
      //      migration. See docs/gaps.
      const ACCEPTED = [
        'DROP INDEX "companies_cr_number_trgm_idx";',
        'DROP INDEX "companies_legal_name_trgm_idx";',
        'DROP INDEX "products_name_ar_trgm_idx";',
        'DROP INDEX "products_name_en_trgm_idx";',
        'ALTER TABLE "company_locations" DROP CONSTRAINT "company_locations_city_id_fkey";',
        'ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
      ];

      // What is left after removing them, comments and blank lines
      // aside. The VALUE carries the leftovers, so a failure names the
      // statement that drifted rather than only saying a string was
      // missing.
      const remaining = diffOutput
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("--"))
        .filter((line) => !ACCEPTED.includes(line));

      expect({ remaining }).toEqual({ remaining: [] });
    } finally {
      await dropScratchDatabase(shadowDbName);
    }
  }, 30_000);
});
