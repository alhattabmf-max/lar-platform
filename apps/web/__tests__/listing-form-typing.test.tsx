import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TaxonomyNodeItem } from "@platform/types";

/**
 * TYPING A WHOLE WORD, which is the only test that would have caught it.
 *
 * The add-product form declared its `Group` layout component inside
 * `ListingForm`, so React saw a new component type on every render and
 * remounted the subtree — destroying the input holding the caret. A
 * reader typed one letter and had to click the field again for the
 * second.
 *
 * EVERY EXISTING TEST PASSED. They rendered once and asserted; the bug
 * needs a SECOND keystroke to appear, which is the thing a test rarely
 * does and a person always does. So this one types a word and checks
 * both that the value survived and that the caret never left.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const { ListingForm } = await import("@/components/supplier/listing-form");

const TAXONOMY: TaxonomyNodeItem[] = [
  { id: "11111111-1111-4111-8111-111111111111", parentId: null, nameAr: "أغذية", nameEn: "Food", iconUrl: null, sortOrder: 0 },
];

const LOCATIONS = [
  { id: "22222222-2222-4222-8222-222222222222", cityId: "c1", name: "الفرع الرئيسي", shortAddress: "RRRD6060", contactName: "م", contactPhone: "+966500000000", isDefault: true },
];

/**
 * BOTH SCOPES, because the remount bug is in the shared field helper
 * and would show up in whichever half of the form happened to be on
 * screen. The product scope asks the names; the offer scope asks the
 * price, and neither asks the other's questions.
 */
function renderForm(scope: "product" | "offer" = "product") {
  return render(
    <ListingForm
      scope={scope}
      locale="ar-SA"
      taxonomy={TAXONOMY}
      locations={LOCATIONS}
      productId="33333333-3333-4333-8333-333333333333"
      backHref="/ar-SA/supplier/products"
    />,
  );
}

describe("typing into the add-product form", () => {
  it("KEEPS THE CARET after the first character", async () => {
    const user = userEvent.setup();
    renderForm();

    const field = screen.getByLabelText(/fields.nameAr/) as HTMLInputElement;
    await user.click(field);
    await user.keyboard("أدوات");

    // The whole word, not its first letter.
    expect(field.value).toBe("أدوات");
    // And the element still holding it is still the focused one — a
    // remount would have replaced the node under the caret.
    expect(document.activeElement).toBe(field);
  });

  it("keeps every OTHER field's value while one is being typed into", async () => {
    const user = userEvent.setup();
    renderForm();

    const arabic = screen.getByLabelText(/fields.nameAr/) as HTMLInputElement;
    const english = screen.getByLabelText(/fields.nameEn/) as HTMLInputElement;

    await user.click(arabic);
    await user.keyboard("مفك");
    await user.click(english);
    await user.keyboard("Screwdriver");

    expect(arabic.value).toBe("مفك");
    expect(english.value).toBe("Screwdriver");
  });

  it("types into a NUMBER field without losing it either", async () => {
    const user = userEvent.setup();
    // The price is an OFFER's question, so that is the scope that has it.
    renderForm("offer");

    const price = screen.getByLabelText(/fields.unitPriceAmount/) as HTMLInputElement;
    await user.click(price);
    await user.keyboard("125.50");

    // `125.5`, not `125.50`: an `input[type=number]` normalises a
    // trailing zero, which is the browser being a number field and not
    // this form losing anything. What is being checked is that SIX
    // keystrokes all landed in the same element — five would mean the
    // node under the caret had been replaced.
    expect(price.value).toBe("125.5");
    expect(document.activeElement).toBe(price);
  });
});
