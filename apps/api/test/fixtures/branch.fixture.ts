import type { Agent } from "supertest";
import type { PrismaClient } from "@prisma/client";
import type { TestPlace } from "./city.fixture";
import { uniqueMobile } from "./unique";

/**
 * REGISTRATION NO LONGER CREATES A BRANCH, so tests create one.
 *
 * `RegisterCompanyDto` asks for six things — registration number, legal
 * name, email, password, one mobile, the accepted policies — and its
 * own comment says why the branch is not among them: a branch has a
 * region, an address and a contact, and inventing a default one from an
 * address typed into a signup form produced branches nobody meant to
 * create. The company signs up first and adds its branches afterwards.
 *
 * The E2E suites predate that change. They sent the old address fields
 * with the registration and then read
 * `GET /companies/me/locations` expecting the invented default to be
 * there; with the fields gone the list is empty and the next line fails
 * on `body[0].id`. That is the suite being out of date, not the
 * platform misbehaving — so they ask for the branch, through the same
 * endpoint a real company would use.
 *
 * Returns the created branch as the API shapes it; `id` is what the
 * checkout and fulfilment payloads need.
 */
export async function createBranch(
  agent: Agent,
  origin: string,
  place: TestPlace,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; [key: string]: unknown }> {
  const res = await agent
    .post("/api/v1/companies/me/locations")
    .set("Origin", origin)
    .send({
      regionId: place.regionId,
      cityId: place.cityId,
      name: "Main Branch",
      shortAddress: "Riyadh, King Fahd Rd",
      latitude: 24.7136,
      longitude: 46.6753,
      contactName: "Branch Contact",
      contactPhone: uniqueMobile(),
      isDefault: true,
      ...overrides,
    });

  if (res.status !== 201) {
    throw new Error(
      `createBranch: expected 201, got ${res.status} — ${JSON.stringify(res.body)}`
    );
  }
  return res.body;
}

/**
 * Puts the company back to VERIFIED after its setup.
 *
 * ADDING A BRANCH SENDS A VERIFIED SUPPLIER BACK UNDER REVIEW — see
 * `CompaniesService.addLocation`: a new branch is a new place to sell
 * and ship from, and publishing anything new waits until somebody has
 * looked at it. The same is true of changing the bank account, the tax
 * profile or the invoicing name.
 *
 * That is the platform working. A suite whose subject is publishing,
 * discovery or checkout still needs a supplier that IS verified at the
 * end of its setup, which in real life is the admin approving the
 * review the change opened. These tests state that in one line instead
 * of driving the whole review UI.
 */
export async function markSupplierVerified(
  prisma: PrismaClient,
  companyId: string
): Promise<void> {
  await prisma.company.update({
    where: { id: companyId },
    data: { verificationStatus: "VERIFIED" },
  });
}

/**
 * Takes a supplier through the review that makes it VERIFIED.
 *
 * THE OLD SHORTCUT NO LONGER EXISTS. These suites used to approve a
 * bank account at `POST /admin/bank-accounts/:id/approve` and set
 * `verificationStatus` straight in the database. That endpoint was
 * removed with `admin-bank-accounts.controller.ts`: activating the
 * account is now PART OF approving the company, and a company becomes
 * verified exactly one way — it submits its record, and an
 * administrator decides.
 *
 * So the suites do that. The supplier must already be complete —
 * company details, a branch, a bank account, an invoicing name and an
 * answered VAT question — or `submit` refuses with
 * `VERIFICATION_NOT_SUBMITTABLE`, naming what is missing.
 *
 * Everything downstream depends on this: an unverified supplier may not
 * submit a product for approval and may not publish an offer.
 */
export async function verifySupplierThroughReview(
  supplierAgent: Agent,
  adminAgent: Agent,
  origin: string,
  companyId: string
): Promise<void> {
  const submitted = await supplierAgent
    .post("/api/v1/companies/me/verification-request")
    .set("Origin", origin);
  if (submitted.status !== 201) {
    throw new Error(
      `verifySupplierThroughReview: submit expected 201, got ${submitted.status} — ${JSON.stringify(submitted.body)}`
    );
  }

  const approved = await adminAgent
    .post(`/api/v1/admin/operations/suppliers/${companyId}/approve`)
    .set("Origin", origin);
  if (approved.status !== 201 && approved.status !== 200) {
    throw new Error(
      `verifySupplierThroughReview: approve expected 200/201, got ${approved.status} — ${JSON.stringify(approved.body)}`
    );
  }
}
