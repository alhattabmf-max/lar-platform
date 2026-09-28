import { cookies } from "next/headers";
import type {
  CompanyRequirement,
  SupplierVerificationView,
} from "@platform/types";
import { apiClient } from "./api-client";
import { toUserFacingError, type UserFacingError } from "./error-messages";

/**
 * A company's own record, as both portals read and write it.
 *
 * ONE MODULE FOR TWO PORTALS, because it is one record. «بيانات
 * المنشأة» means the same thing to a buyer and to a supplier, it lives
 * at the same `companies/me/*` endpoints, and the API scopes every one
 * of them to the session's company. Two copies of these reads would be
 * two places for the shape to drift.
 *
 * NO ADMIN LOADER IS TOUCHED. Everything here is the signed-in
 * company's own data, read with the company `sid` cookie.
 *
 * NO COORDINATE IS DECLARED. The endpoints return stored latitude and
 * longitude; typing them here would invite a screen that prints a
 * latitude at somebody, which is not an address and is not something
 * anyone has to hand. A branch's position is a Google Maps link on the
 * way in and nothing at all on the way out.
 */

export type Loaded<T> =
  { ok: true; data: T } | { ok: false; error: UserFacingError };

/**
 * The session cookie, forwarded rather than read.
 *
 * A SERVER COMPONENT HAS NO COOKIE JAR of its own — `fetch` on the
 * server sends nothing unless the caller attaches it. Leaving this out
 * is silent: every read returns 401 and the section renders its error
 * state, which is exactly what it did on the first real request.
 *
 * The value is never parsed, decoded or inspected; it is copied from
 * the incoming request to the outgoing one.
 */
async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");
}

async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    return {
      ok: true,
      data: await apiClient.get<T>(path, {
        cache: "no-store",
        cookieHeader: await cookieHeader(),
      }),
    };
  } catch (error) {
    return { ok: false, error: toUserFacingError(error) };
  }
}

// ------------------------------------------------------------ branches

export interface CompanyBranch {
  id: string;
  regionId: string;
  /** Null when the branch names no city. */
  cityId: string | null;
  name: string;
  shortAddress: string;
  contactName: string;
  contactPhone: string;
  isDefault: boolean;
  /**
   * WHERE THE PIN OPENS. Present because the position is now CHOSEN on
   * a map rather than pasted as a link, and a person adjusting their
   * own branch has to see the map open on their own gate rather than
   * on the capital.
   */
  latitude: number;
  longitude: number;
}

/**
 * The company's branches, rebuilt field by field.
 *
 * THE COORDINATES ARE KEPT, and that reverses an earlier decision that
 * is worth stating rather than quietly overwriting. They used to be
 * stripped here, because the position was a Google Maps link and a
 * pair of numbers in the page's payload contradicted the one thing
 * that screen was built around. The position is now a pin the company
 * places itself, so the numbers ARE the answer, and withholding a
 * company's own branch coordinates from that company's own account
 * page would only mean the map could not open where the branch is.
 *
 * WHAT HAS NOT CHANGED: this is the company's own authenticated page,
 * it is nobody else's branches, and nothing here reaches a public
 * screen. Every other field is still rebuilt one by one, so anything
 * the endpoint adds later still has to be admitted deliberately.
 */
export async function loadCompanyBranches(): Promise<Loaded<CompanyBranch[]>> {
  const result = await load<(CompanyBranch & Record<string, unknown>)[]>(
    "/companies/me/locations",
  );
  if (!result.ok) return result;

  return {
    ok: true,
    data: result.data.map((row) => ({
      id: row.id,
      regionId: row.regionId,
      cityId: row.cityId ?? null,
      name: row.name,
      shortAddress: row.shortAddress,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      isDefault: row.isDefault,
      // Prisma sends a Decimal column as a string over JSON.
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    })),
  };
}

// ------------------------------------------------------------ contacts

/**
 * A named person to reach, beyond the number given at registration.
 *
 * REGISTRATION CREATES THE FIRST ONE — the company's own name against
 * its own number — so this list is never empty. What «جهة تواصل
 * إضافية» adds is a SECOND row with a person's name on it, and it is
 * entirely optional.
 */
export interface CompanyContact {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isActive: boolean;
}

export function loadCompanyContacts(): Promise<Loaded<CompanyContact[]>> {
  return load<CompanyContact[]>("/companies/me/contacts");
}

// -------------------------------------------------------- bank account

/**
 * The account a supplier is paid into.
 *
 * `ibanLast4` and nothing more, because that is all the API sends: the
 * stored IBAN is encrypted and neither its ciphertext nor its
 * fingerprint appears in a supplier-facing response. Declaring an
 * `iban` field would be a claim the endpoint does not honour — and the
 * kind of claim somebody later "fixes" by making it honour one.
 */
export interface CompanyBankAccount {
  id: string;
  accountHolderName: string;
  bankName: string;
  ibanLast4: string;
  verificationStatus: string;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export function loadCompanyBankAccounts(): Promise<
  Loaded<CompanyBankAccount[]>
> {
  return load<CompanyBankAccount[]>("/companies/me/bank-account");
}

// ----------------------------------------------------- where to go next

/**
 * Which part of «بيانات المنشأة» a missing requirement lives in.
 *
 * Derived from the requirement NAME rather than written out at each
 * call site, so the dashboard's banner, the sidebar's badge and the
 * section's own headings cannot point three different ways.
 */
/**
 * Where this supplier's verification stands.
 *
 * THE SERVER DECIDES THE STATE, not this file. The submit endpoint
 * refuses on the same value, so a card built from this cannot offer
 * a button the server rejects.
 */
export function loadVerificationView(): Promise<
  Loaded<SupplierVerificationView>
> {
  return load<SupplierVerificationView>("/companies/me/verification-request");
}

export function requirementAnchor(requirement: CompanyRequirement): string {
  return {
    companyDetails: "company-details",
    mainBranch: "company-branches",
    bankAccount: "company-bank-account",
    billingIdentity: "company-billing-identity",
  }[requirement];
}
