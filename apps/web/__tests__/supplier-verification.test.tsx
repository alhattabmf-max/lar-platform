import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/ar-SA.json";
import en from "@/messages/en-SA.json";
import {
  SUPPLIER_VERIFICATION_STATES,
  supplierVerificationView,
  type SupplierVerificationView,
} from "@platform/types";
import { VerificationRequestCard } from "@/components/company/verification-request-card";

/**
 * The supplier's own side of being verified.
 *
 * THE CARD RENDERS WHAT THE SERVER DECIDED. It does not work out the
 * state, which is the point: the same function the submit endpoint
 * refuses on produces this view, so the card cannot show a button the
 * server would reject.
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));

const post = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}));

function labelsFrom(catalogue: typeof messages) {
  const v = catalogue.company.verification;
  return {
    title: v.title,
    states: v.state,
    descriptions: v.description,
    submit: v.submit,
    working: catalogue.common.loading,
    missingTitle: v.missingTitle,
    requirements: catalogue.company.completeness.requirement,
    reasonTitle: v.reasonTitle,
    submittedAt: v.submittedAt,
    lockedNotice: v.locked,
    requestIdLabel: catalogue.states.requestIdLabel,
  };
}

function wrap(view: SupplierVerificationView, missing: string[] = []) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <VerificationRequestCard
        view={view}
        missing={missing as never}
        submittedAtLabel={view.latestRequest ? "١ أغسطس ٢٠٢٦" : null}
        labels={labelsFrom(messages) as never}
      />
    </NextIntlClientProvider>,
  );
}

const PENDING = "PENDING_VERIFICATION" as const;

beforeEach(() => {
  post.mockReset();
  refresh.mockReset();
  post.mockResolvedValue({});
});

// =====================================================================
// Every state has words in both languages
// =====================================================================
describe("the six states", () => {
  it("names and explains each one in Arabic and in English", () => {
    for (const state of SUPPLIER_VERIFICATION_STATES) {
      for (const catalogue of [messages, en]) {
        const v = catalogue.company.verification as unknown as Record<
          string,
          Record<string, string>
        >;
        // A state with no words renders an empty card, which is worse
        // than the ambiguity it was meant to remove.
        expect(v.state[state]).toBeTruthy();
        expect(v.description[state]).toBeTruthy();
      }
    }
  });

  it("offers the button in exactly the two states that can send", () => {
    const sendable = SUPPLIER_VERIFICATION_STATES.filter((state) => {
      const view = supplierVerificationView({
        companyStatus:
          state === "VERIFIED"
            ? "VERIFIED"
            : state === "REJECTED"
              ? "REJECTED"
              : PENDING,
        latestRequest:
          state === "UNDER_REVIEW"
            ? {
                id: "r",
                status: "UNDER_REVIEW",
                submittedAt: "2026-08-01T00:00:00.000Z",
                decidedAt: null,
                decisionReason: null,
              }
            : state === "NEEDS_COMPLETION"
              ? {
                  id: "r",
                  status: "RETURNED_FOR_COMPLETION",
                  submittedAt: "2026-08-01T00:00:00.000Z",
                  decidedAt: "2026-08-02T00:00:00.000Z",
                  decisionReason: "أضف الحساب البنكي",
                }
              : null,
        profileComplete: state !== "INCOMPLETE",
      });
      return view.canSubmit;
    });

    expect(sendable.sort()).toEqual(["NEEDS_COMPLETION", "READY_TO_SUBMIT"]);
  });
});

// =====================================================================
// What the card actually shows
// =====================================================================
describe("the card", () => {
  it("names the missing items instead of a bare «غير مكتملة»", () => {
    wrap(
      {
        state: "INCOMPLETE",
        reason: null,
        canSubmit: false,
        dataLocked: false,
        latestRequest: null,
      },
      ["bankAccount"],
    );

    expect(
      screen.getByText(messages.company.completeness.requirement.bankAccount),
    ).toBeTruthy();
    // Nothing to press: pressing it could not succeed.
    expect(
      screen.queryByRole("button", {
        name: messages.company.verification.submit,
      }),
    ).toBeNull();
  });

  it("offers no button of its own any more — the foot of the page has it", () => {
    wrap({
      state: "READY_TO_SUBMIT",
      reason: null,
      canSubmit: true,
      dataLocked: false,
      latestRequest: null,
    });

    expect(
      screen.queryByRole("button", {
        name: messages.company.verification.submit,
      }),
    ).toBeNull();
  });

  it("says the data is locked while a request is open, and offers nothing", () => {
    wrap({
      state: "UNDER_REVIEW",
      reason: null,
      canSubmit: false,
      dataLocked: true,
      latestRequest: {
        id: "r",
        status: "UNDER_REVIEW",
        submittedAt: "2026-08-01T00:00:00.000Z",
        decidedAt: null,
        decisionReason: null,
      },
    });

    expect(screen.getByText(messages.company.verification.locked)).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: messages.company.verification.submit,
      }),
    ).toBeNull();
  });

  it("shows a returned request's reason verbatim and lets it be sent again", () => {
    wrap({
      state: "NEEDS_COMPLETION",
      reason: "رقم السجل التجاري غير مطابق",
      canSubmit: true,
      dataLocked: false,
      latestRequest: {
        id: "r",
        status: "RETURNED_FOR_COMPLETION",
        submittedAt: "2026-08-01T00:00:00.000Z",
        decidedAt: "2026-08-02T00:00:00.000Z",
        decisionReason: "رقم السجل التجاري غير مطابق",
      },
    });

    // Verbatim: paraphrasing is how a supplier fixes the wrong thing.
    expect(screen.getByText("رقم السجل التجاري غير مطابق")).toBeTruthy();
  });
  /**
   * THE SEND, where it lives now.
   *
   * It used to be a button on THIS card, which put the page's last
   * step above everything it is the last step of. It moved to the foot
   * of the one company card, and its three rules moved with it — it
   * appears only when the server says the send can succeed, it posts
   * to the one endpoint, and the new state is re-read rather than
   * assumed. Those are exercised where the button is, in
   * `company-profile.test.tsx`; what is pinned HERE is that this card
   * no longer owns it and no longer claims to.
   */
  it("hands the send to the one company card, and keeps none of it", () => {
    const source = read("components/company/verification-request-card.tsx");
    const card = read("components/company/company-record-card.tsx");

    // No request, no state, no button — which is also what let this
    // component go back to being a Server Component.
    //
    // THE DIRECTIVE IS CHECKED BY POSITION, not by search: `"use
    // client"` only does anything as the FIRST thing in a file, and
    // the doc comment inside this one explains its absence in those
    // very words. Searching would find the explanation.
    expect(source.trimStart().startsWith('"use client"')).toBe(false);
    expect(source).not.toContain("apiClient.");
    expect(source).not.toContain("/companies/me/verification-request");

    // And the card that took it does post to the one endpoint.
    expect(card).toContain('apiClient.post("/companies/me/verification-request")');
    expect(card).toContain('data-testid="record-submit"');
  });

  it("shows the send only where `canSubmit` allows it, on that card", () => {
    const card = read("components/company/company-record-card.tsx");

    // The server's own verdict gates it — never a rule re-derived in
    // the browser from the missing list.
    expect(card).toContain("canSubmit ? (");
    expect(card).not.toMatch(/missing\.length === 0/);
  });

  it("gives a refused supplier the reason and no way to send again", () => {
    wrap({
      state: "REJECTED",
      reason: "السجل التجاري منتهٍ",
      canSubmit: false,
      dataLocked: false,
      latestRequest: {
        id: "r",
        status: "REJECTED",
        submittedAt: "2026-08-01T00:00:00.000Z",
        decidedAt: "2026-08-02T00:00:00.000Z",
        decisionReason: "السجل التجاري منتهٍ",
      },
    });

    expect(screen.getByText("السجل التجاري منتهٍ")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: messages.company.verification.submit,
      }),
    ).toBeNull();
  });

  it("offers a verified supplier nothing to do", () => {
    wrap({
      state: "VERIFIED",
      reason: null,
      canSubmit: false,
      dataLocked: false,
      latestRequest: null,
    });

    expect(
      screen.getByText(messages.company.verification.state.VERIFIED),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: messages.company.verification.submit,
      }),
    ).toBeNull();
  });
});

// =====================================================================
// The section that mounts it
// =====================================================================
describe("«بيانات المنشأة»", () => {
  // COLLAPSED, because these assert WHAT the section does, not how it
  // happens to be wrapped this week. A line break inside a JSX prop is
  // not a behaviour change, and a test that fails on one teaches people
  // to stop trusting it.
  const collapse = (source: string) => source.split(/\s+/).join(" ");
  const SECTION = collapse(read("components/company/company-profile-section.tsx"));

  it("asks for the view only for a supplier", () => {
    // A buyer is never verified; the endpoint refuses one, so calling it
    // would be a guaranteed 403 on every load of a buyer's own page.
    expect(SECTION).toContain("isSupplier ? loadVerificationView()");
  });

  it("passes a formatted date, never a formatter", () => {
    // React refuses to serialise a function across into a Client
    // Component, and neither tsc nor the build catches it — only a real
    // request does.
    expect(SECTION).toContain("submittedAtLabel={");
    expect(SECTION).toContain(
      collapse("formatDate(verification.data.latestRequest.submittedAt, locale)"),
    );
  });

  it("reads the missing list from the session, not from a second count", () => {
    // The same list the sidebar badges. Two answers to "what is
    // missing" is how a badge and a button come to disagree.
    expect(SECTION).toContain("missing={session.profile.missing}");
  });
});
