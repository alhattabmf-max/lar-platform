import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/ar-SA.json";
import { BillingIdentityCard } from "@/components/company/billing-identity-card";

/**
 * «الفوترة والضريبة» — one card, two states.
 *
 * The supplier fills it in before asking to be approved, and reads it
 * back on the same card afterwards. What this file holds:
 *
 *   · the VAT number is checked against the rule the SERVER enforces,
 *     beside the field, before a save is attempted;
 *   · «not registered» is an answer, and reads as one;
 *   · a number is never sent alongside «not registered», because the
 *     server refuses that and a stale number would reach a document;
 *   · read mode offers ONE control, and none at all while the record is
 *     under review.
 */

const put = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: { put: (...args: unknown[]) => put(...args) },
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}));

const billing = messages.company.billing as Record<string, string>;

const LABELS = {
  ...billing,
  working: "جارٍ…",
  required: "(مطلوب)",
  errorTitle: "خطأ",
  requestIdLabel: "المرجع",
} as React.ComponentProps<typeof BillingIdentityCard>["labels"];

const EMPTY = {
  invoicingLegalName: null,
  isVatRegistered: null,
  vatNumber: null,
};

const ANSWERED = {
  invoicingLegalName: "مؤسسة الإمداد",
  isVatRegistered: true,
  vatNumber: "310123456700003",
};

function renderCard(
  props: Partial<React.ComponentProps<typeof BillingIdentityCard>> = {},
) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <BillingIdentityCard
        current={EMPTY}
        labels={LABELS}
        startOpen
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  put.mockReset().mockResolvedValue({});
  refresh.mockReset();
});

describe("before anything has been entered", () => {
  it("opens as a form rather than behind an edit button", () => {
    // A supplier assembling their record should not have to press
    // "edit" to reach a field that has never been filled.
    renderCard();

    expect(screen.getByTestId("billing-name")).toBeInTheDocument();
    expect(screen.queryByTestId("billing-edit")).toBeNull();
  });

  it("says it is still required", () => {
    renderCard();

    expect(screen.getByText(billing.requiredPill)).toBeInTheDocument();
  });

  it("offers no way out, because there is nothing to go back to", () => {
    // Cancelling to an empty card would leave the supplier looking at a
    // requirement with no control to meet it.
    renderCard();

    expect(screen.queryByTestId("billing-cancel")).toBeNull();
  });
});

describe("the VAT number is checked against the server's own rule", () => {
  it("asks for a number only once the company says it is registered", async () => {
    const user = userEvent.setup();
    renderCard();

    // A number field beside «no» is a question with no answer.
    expect(screen.queryByTestId("vat-number")).toBeNull();

    await user.click(screen.getByTestId("vat-yes"));
    expect(screen.getByTestId("vat-number")).toBeInTheDocument();

    await user.click(screen.getByTestId("vat-no"));
    expect(screen.queryByTestId("vat-number")).toBeNull();
  });

  /**
   * "TOO LONG" IS NOT IN THIS LIST, and that is a fact about the field
   * rather than a gap: `maxLength={15}` stops a sixteenth character
   * from being typed at all, so the case cannot be reached from the
   * keyboard. The server still refuses one, which is what matters for
   * anything that does not come from this form.
   */
  it.each([
    ["too short", "31012345670000"],
    ["with letters", "31012345670000A"],
    ["with spaces inside", "310 1234567 000"],
  ])("refuses a number that is %s, beside the field", async (_label, value) => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByTestId("vat-yes"));
    await user.type(screen.getByTestId("billing-name"), "مؤسسة");
    await user.type(screen.getByTestId("vat-number"), value);

    expect(screen.getByText(billing.vatNumberInvalid)).toBeInTheDocument();
    expect(screen.getByTestId("billing-save")).toBeDisabled();
  });

  it("accepts exactly fifteen digits", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByTestId("vat-yes"));
    await user.type(screen.getByTestId("billing-name"), "مؤسسة");
    await user.type(screen.getByTestId("vat-number"), "310123456700003");

    expect(screen.queryByText(billing.vatNumberInvalid)).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("billing-save")).toBeEnabled(),
    );
  });

  it("will not save without a billing name, whatever the VAT answer", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByTestId("vat-no"));

    expect(screen.getByTestId("billing-save")).toBeDisabled();
  });
});

describe("what it sends", () => {
  it("writes both profiles on one press, the name first", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByTestId("billing-name"), "مؤسسة الإمداد");
    await user.click(screen.getByTestId("vat-yes"));
    await user.type(screen.getByTestId("vat-number"), "310123456700003");
    await user.click(screen.getByTestId("billing-save"));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[0]).toEqual([
      "/companies/me/invoicing-profile",
      { invoicingLegalName: "مؤسسة الإمداد" },
    ]);
    expect(put.mock.calls[1]).toEqual([
      "/companies/me/tax-profile",
      { isVatRegistered: true, vatNumber: "310123456700003" },
    ]);
  });

  /**
   * THE SERVER REFUSES A NUMBER ALONGSIDE «NOT REGISTERED», and that is
   * the right refusal: a company that says it does not charge VAT has
   * no number to record, and a stale one would reach a document.
   */
  it("sends no number at all when the company is not registered", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByTestId("billing-name"), "مؤسسة");
    await user.click(screen.getByTestId("vat-yes"));
    await user.type(screen.getByTestId("vat-number"), "310123456700003");
    // Changed their mind.
    await user.click(screen.getByTestId("vat-no"));
    await user.click(screen.getByTestId("billing-save"));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1][1]).toEqual({ isVatRegistered: false });
    expect(put.mock.calls[1][1]).not.toHaveProperty("vatNumber");
  });

  it("trims what it sends", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByTestId("billing-name"), "  مؤسسة  ");
    await user.click(screen.getByTestId("vat-no"));
    await user.click(screen.getByTestId("billing-save"));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][1]).toEqual({ invoicingLegalName: "مؤسسة" });
  });
});

describe("once it has been answered", () => {
  it("reads back rather than opening a form", () => {
    renderCard({ current: ANSWERED, startOpen: true });

    expect(screen.queryByTestId("billing-name")).toBeNull();
    expect(screen.getByText("مؤسسة الإمداد")).toBeInTheDocument();
    expect(screen.getByText("310123456700003")).toBeInTheDocument();
    expect(screen.getByText(billing.completePill)).toBeInTheDocument();
  });

  it("offers exactly ONE control to change it", () => {
    renderCard({ current: ANSWERED });

    expect(screen.getByTestId("billing-edit")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: billing.edit }),
    ).toHaveLength(1);
  });

  it("turns the values into fields inside the SAME card", async () => {
    const user = userEvent.setup();
    renderCard({ current: ANSWERED });

    await user.click(screen.getByTestId("billing-edit"));

    // The card is the same element; what changed is what is inside it.
    expect(screen.getByTestId("billing-identity-card")).toBeInTheDocument();
    expect(screen.getByTestId("billing-name")).toHaveValue("مؤسسة الإمداد");
    expect(screen.getByTestId("vat-number")).toHaveValue("310123456700003");
    expect(screen.getByText(billing.saveChanges)).toBeInTheDocument();
    expect(screen.getByTestId("billing-cancel")).toBeInTheDocument();
  });

  it("puts back what was there when the edit is cancelled", async () => {
    const user = userEvent.setup();
    renderCard({ current: ANSWERED });

    await user.click(screen.getByTestId("billing-edit"));
    await user.clear(screen.getByTestId("billing-name"));
    await user.type(screen.getByTestId("billing-name"), "شيء آخر");
    await user.click(screen.getByTestId("billing-cancel"));

    expect(screen.getByText("مؤسسة الإمداد")).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("reads «not registered» as an answer, not as an empty field", () => {
    renderCard({
      current: {
        invoicingLegalName: "مؤسسة",
        isVatRegistered: false,
        vatNumber: null,
      },
    });

    expect(screen.getByText(billing.notRegistered)).toBeInTheDocument();
    expect(screen.getByText(billing.completePill)).toBeInTheDocument();
  });
});

describe("while the record is under review", () => {
  it("offers no way to change it", () => {
    // The platform closes the whole record to edits then, and a button
    // that only produces a refusal is worse than no button.
    renderCard({ current: ANSWERED, locked: true });

    expect(screen.queryByTestId("billing-edit")).toBeNull();
    expect(screen.getByText("مؤسسة الإمداد")).toBeInTheDocument();
  });
});

describe("the commercial registration is not here", () => {
  it("offers no field for it", () => {
    // It is verified, it is the company's identity, and it is shown
    // read-only on the details card. A second place to type it would be
    // a second answer to a question that already has one.
    renderCard();

    expect(screen.queryByTestId("cr-number")).toBeNull();
    expect(screen.queryByText(/السجل التجاري/)).toBeNull();
  });
});
