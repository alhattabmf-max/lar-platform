import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SalesUnitItem, TaxonomyNodeItem } from "@platform/types";
import { EMPTY_PRODUCT_FORM, type ProductFormValues } from "@/lib/product-form";
import type { ProductFormLabels } from "@/components/supplier/product-form";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const NODE = "11111111-1111-4111-8111-111111111111";
const CHILD = "33333333-3333-4333-8333-333333333333";
const ORPHAN = "44444444-4444-4444-8444-444444444444";
const UNIT = "22222222-2222-4222-8222-222222222222";

const TAXONOMY: TaxonomyNodeItem[] = [
  { id: NODE, parentId: null, nameAr: "أغذية", nameEn: "Food", iconUrl: null, sortOrder: 0 },
  { id: CHILD, parentId: NODE, nameAr: "زيوت", nameEn: "Oils", iconUrl: null, sortOrder: 1 },
  // An active child of a DEACTIVATED parent: its parentId points outside
  // the list. Real data, and it must still be selectable.
  { id: ORPHAN, parentId: "99999999-9999-4999-8999-999999999999", nameAr: "يتيم", nameEn: "Orphan", iconUrl: null, sortOrder: 2 },
];

const SALES_UNITS: SalesUnitItem[] = [
  { id: UNIT, nameAr: "كرتون", nameEn: "Carton", sortOrder: 0 },
];

const LABELS: ProductFormLabels = {
  sections: { identity: "بيانات", classification: "تصنيف", packaging: "عبوة", dimensions: "أبعاد" },
  fields: {
    taxonomyNodeId: "التصنيف",
    salesUnitId: "وحدة البيع",
    salesUnitNameAr: "وحدة عربي",
    salesUnitNameEn: "وحدة إنجليزي",
    nameAr: "الاسم عربي",
    nameEn: "الاسم إنجليزي",
    descriptionAr: "الوصف عربي",
    descriptionEn: "الوصف إنجليزي",
    weightPerUnit: "الوزن",
    lengthCm: "الطول",
    widthCm: "العرض",
    heightCm: "الارتفاع",
    packageContentQuantity: "الكمية",
    packageContentUnitNameAr: "وحدة المحتوى عربي",
    packageContentUnitNameEn: "وحدة المحتوى إنجليزي",
  },
  placeholderTaxonomy: "اختر تصنيفًا",
  placeholderSalesUnit: "بدون اختيار",
  required: "(مطلوب)",
  optional: "(اختياري)",
  submitCreate: "حفظ المنتج",
  submitEdit: "حفظ التغييرات",
  submitting: "جارٍ الحفظ…",
  cancel: "إلغاء",
  cancelPrompt: "تغييرات غير محفوظة",
  errorSummaryTitle: "راجع الحقول",
  checkSummaryTitle: "لا يجتاز الفحص",
  errorTitle: "تعذّر",
  requestIdLabel: "المرجع",
  noChanges: "لا تغييرات",
};

const FILLED: ProductFormValues = {
  taxonomyNodeId: NODE,
  salesUnitId: "",
  salesUnitNameAr: "كرتون",
  salesUnitNameEn: "Carton",
  nameAr: "زيت",
  nameEn: "Oil",
  descriptionAr: "",
  descriptionEn: "",
  weightPerUnit: "12.5",
  lengthCm: "30",
  widthCm: "20",
  heightCm: "15",
  packageContentQuantity: "",
  packageContentUnitNameAr: "",
  packageContentUnitNameEn: "",
};

const pushMock = vi.fn();
const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: refreshMock }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const { ProductForm } = await import("@/components/supplier/product-form");

let fetchMock: ReturnType<typeof vi.fn>;

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  refreshMock.mockReset();
  fetchMock = vi.fn().mockResolvedValue(ok({ id: "created-1" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderForm(
  overrides: Partial<React.ComponentProps<typeof ProductForm>> = {}
) {
  return render(
    <ProductForm
      mode="create"
      locale="ar-SA"
      initialValues={EMPTY_PRODUCT_FORM}
      taxonomy={TAXONOMY}
      salesUnits={SALES_UNITS}
      backHref="/ar-SA/supplier/products"
      labels={LABELS}
      {...overrides}
    />
  );
}

const body = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

// ------------------------------------------------------------ pickers

describe("the pickers offer only real options", () => {
  it("lists every active node, including one whose parent is missing", () => {
    // `isActive` is filtered per node, not cascaded, so an orphan is real
    // data. Dropping it would hide a category that still holds products.
    renderForm();
    const select = screen.getByLabelText(/التصنيف/) as HTMLSelectElement;

    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toContain(NODE);
    expect(values).toContain(CHILD);
    expect(values).toContain(ORPHAN);
  });

  it("makes every node selectable — there is no leaf-only rule", () => {
    renderForm();
    const select = screen.getByLabelText(/التصنيف/) as HTMLSelectElement;

    for (const option of Array.from(select.options)) {
      expect(option.disabled).toBe(false);
    }
  });

  it("starts with no category chosen, and offers no fabricated default", () => {
    renderForm();
    const select = screen.getByLabelText(/التصنيف/) as HTMLSelectElement;

    expect(select.value).toBe("");
    expect(select.options[0].value).toBe("");
    expect(select.options[0].text).toBe(LABELS.placeholderTaxonomy);
  });

  it("offers no free-text id anywhere", () => {
    const code = strip(read("components/supplier/product-form.tsx"));

    // Ids come from a <select> over real reference data; there is no
    // input a uuid could be typed into.
    expect(code).not.toMatch(/type="text"[^>]*taxonomyNodeId/);
    expect(code).toContain("<Select");
  });
});

describe("choosing a sales unit", () => {
  it("fills BOTH snapshot names from the reference row", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText(/وحدة البيع/), { target: { value: UNIT } });

    expect((screen.getByLabelText(/وحدة عربي/) as HTMLInputElement).value).toBe("كرتون");
    expect((screen.getByLabelText(/وحدة إنجليزي/) as HTMLInputElement).value).toBe("Carton");
  });

  it("leaves the names EDITABLE, because they are snapshot names", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/وحدة البيع/), { target: { value: UNIT } });

    const arabic = screen.getByLabelText(/وحدة عربي/) as HTMLInputElement;
    expect(arabic.readOnly).toBe(false);
    expect(arabic.disabled).toBe(false);

    fireEvent.change(arabic, { target: { value: "صندوق" } });
    expect(arabic.value).toBe("صندوق");
  });

  it("clears the reference while keeping the names", () => {
    renderForm({ initialValues: { ...FILLED, salesUnitId: UNIT } });

    fireEvent.change(screen.getByLabelText(/وحدة البيع/), { target: { value: "" } });

    expect((screen.getByLabelText(/وحدة البيع/) as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText(/وحدة عربي/) as HTMLInputElement).value).toBe("كرتون");
  });
});

// ---------------------------------------------------------- validation

describe("submitting an invalid form", () => {
  it("sends nothing, lists every problem and focuses the first", async () => {
    renderForm();

    fireEvent.click(screen.getByText(LABELS.submitCreate));

    const summary = await screen.findByText(LABELS.errorSummaryTitle);
    expect(fetchMock).not.toHaveBeenCalled();

    const list = summary.parentElement!.querySelector("ul")!;
    // Nine required fields are empty.
    expect(within(list).getAllByRole("listitem")).toHaveLength(9);

    await waitFor(() =>
      expect(document.activeElement?.id).toBe("product-field-nameAr")
    );
  });

  it("marks the field invalid and links its message", async () => {
    renderForm();
    fireEvent.click(screen.getByText(LABELS.submitCreate));

    const input = await screen.findByLabelText(/الاسم عربي/);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));

    const describedBy = input.getAttribute("aria-describedby")!;
    expect(describedBy).toBe("product-field-nameAr-error");
    expect(document.getElementById(describedBy)).toHaveAttribute("role", "alert");
  });

  it("clears a field's error as soon as it is edited", async () => {
    renderForm();
    fireEvent.click(screen.getByText(LABELS.submitCreate));

    const input = await screen.findByLabelText(/الاسم عربي/);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));

    fireEvent.change(input, { target: { value: "زيت" } });
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("refuses a partly-filled package group", async () => {
    renderForm({ initialValues: { ...FILLED, packageContentQuantity: "6" } });

    fireEvent.click(screen.getByText(LABELS.submitCreate));

    await screen.findByText(LABELS.errorSummaryTitle);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------- create

describe("creating", () => {
  it("posts the create body and navigates to the SERVER's id", async () => {
    renderForm({ initialValues: FILLED });

    fireEvent.click(screen.getByText(LABELS.submitCreate));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/companies/me/products");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(body()).toEqual({
      taxonomyNodeId: NODE,
      salesUnitNameAr: "كرتون",
      salesUnitNameEn: "Carton",
      nameAr: "زيت",
      nameEn: "Oil",
      weightPerUnit: 12.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
    });

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/ar-SA/supplier/products/created-1")
    );
  });

  it("guards against a double submit", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));

    renderForm({ initialValues: FILLED });
    const button = screen.getByText(LABELS.submitCreate);

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(ok({ id: "created-1" }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------- edit

describe("editing", () => {
  const editProps = {
    mode: "edit" as const,
    productId: "p-1",
    initialValues: FILLED,
    backHref: "/ar-SA/supplier/products/p-1",
  };

  it("disables save until something changes", () => {
    renderForm(editProps);

    expect(screen.getByText(LABELS.submitEdit).closest("button")).toBeDisabled();
    expect(screen.getByText(LABELS.noChanges)).toBeInTheDocument();
  });

  it("PATCHes only the field that changed", async () => {
    renderForm(editProps);

    fireEvent.change(screen.getByLabelText(/الاسم عربي/), { target: { value: "زيت جديد" } });
    fireEvent.click(screen.getByText(LABELS.submitEdit));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(body()).toEqual({ nameAr: "زيت جديد" });
  });

  it("sends null to clear a description that was emptied", async () => {
    renderForm({ ...editProps, initialValues: { ...FILLED, descriptionAr: "وصف" } });

    fireEvent.change(screen.getByLabelText(/الوصف عربي/), { target: { value: "" } });
    fireEvent.click(screen.getByText(LABELS.submitEdit));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(body()).toEqual({ descriptionAr: null });
  });

  it("returns to the product and refreshes, without claiming a status", async () => {
    renderForm(editProps);
    fireEvent.change(screen.getByLabelText(/الطول/), { target: { value: "31" } });
    fireEvent.click(screen.getByText(LABELS.submitEdit));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/ar-SA/supplier/products/p-1"));
    expect(refreshMock).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------- failures

describe("when the request fails", () => {
  const editProps = { mode: "edit" as const, productId: "p-1", initialValues: FILLED };

  it("keeps every value the reader typed", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderForm(editProps);
    fireEvent.change(screen.getByLabelText(/الاسم عربي/), { target: { value: "قيمة ثمينة" } });
    fireEvent.change(screen.getByLabelText(/الوصف عربي/), { target: { value: "وصف طويل" } });
    fireEvent.click(screen.getByText(LABELS.submitEdit));

    await screen.findByText(LABELS.errorTitle);

    expect((screen.getByLabelText(/الاسم عربي/) as HTMLInputElement).value).toBe("قيمة ثمينة");
    expect((screen.getByLabelText(/الوصف عربي/) as HTMLTextAreaElement).value).toBe("وصف طويل");
  });

  it("shows a closed message, never the API's English text", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: "weightPerUnit must not be greater than 9999999.999" },
          requestId: "req-4",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );

    renderForm(editProps);
    fireEvent.change(screen.getByLabelText(/الوزن/), { target: { value: "13" } });
    fireEvent.click(screen.getByText(LABELS.submitEdit));

    const alert = await screen.findByText("errors.codes.VALIDATION_FAILED");
    expect(alert).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("must not be greater than");
    expect(document.body.textContent).toContain("req-4");
  });

  it("maps PRODUCT_TECHNICAL_CHECK_FAILED onto the fields and focuses the first", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "PRODUCT_TECHNICAL_CHECK_FAILED",
            message: "Product cannot be auto-approved yet",
            details: { failedChecks: ["MAIN_IMAGE_REQUIRED", "NAME_EN_REQUIRED"] },
          },
          requestId: "req-5",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );

    renderForm(editProps);
    fireEvent.change(screen.getByLabelText(/الطول/), { target: { value: "31" } });
    fireEvent.click(screen.getByText(LABELS.submitEdit));

    const summary = await screen.findByText(LABELS.checkSummaryTitle);
    const list = summary.parentElement!.querySelector("ul")!;
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    // Ordered by position: the field comes before the image panel.
    expect(list.textContent).toContain("NAME_EN_REQUIRED");
    expect(list.textContent).toContain("MAIN_IMAGE_REQUIRED");
    await waitFor(() => expect(document.activeElement?.id).toBe("product-field-nameEn"));
  });

  it("shows no raw details for a technical failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "PRODUCT_TECHNICAL_CHECK_FAILED",
            message: "Product cannot be auto-approved yet",
            details: { failedChecks: ["NAME_EN_REQUIRED"], internalPath: "/srv/app/products.ts" },
          },
          requestId: "req-6",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );

    renderForm(editProps);
    fireEvent.change(screen.getByLabelText(/الطول/), { target: { value: "31" } });
    fireEvent.click(screen.getByText(LABELS.submitEdit));

    await screen.findByText(LABELS.checkSummaryTitle);
    expect(document.body.textContent).not.toContain("/srv/app");
    expect(document.body.textContent).not.toContain("auto-approved");
  });
});

// -------------------------------------------------------- unsaved work

describe("unsaved changes", () => {
  it("warns before a browser navigation once the form is dirty", () => {
    renderForm({ mode: "edit", productId: "p-1", initialValues: FILLED });

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText(/الاسم عربي/), { target: { value: "تغيير" } });

    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("asks before Cancel discards changes, and leaves without asking when clean", () => {
    const { rerender } = renderForm({ mode: "edit", productId: "p-1", initialValues: FILLED });

    fireEvent.click(screen.getByText(LABELS.cancel));
    expect(pushMock).toHaveBeenCalledTimes(1);
    pushMock.mockReset();

    rerender(
      <ProductForm
        mode="edit"
        productId="p-1"
        locale="ar-SA"
        initialValues={FILLED}
        taxonomy={TAXONOMY}
        salesUnits={SALES_UNITS}
        backHref="/ar-SA/supplier/products/p-1"
        labels={LABELS}
      />
    );
    fireEvent.change(screen.getByLabelText(/الاسم عربي/), { target: { value: "تغيير" } });
    fireEvent.click(screen.getByText(LABELS.cancel));

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByText(LABELS.cancelPrompt)).toBeInTheDocument();
  });

  it("intercepts no in-app navigation and monkeypatches nothing", () => {
    const shell = strip(read("components/forms/form-shell.tsx"));
    const form = strip(read("components/supplier/product-form.tsx"));

    for (const source of [shell, form]) {
      expect(source).not.toContain("pushState");
      expect(source).not.toContain("popstate");
      expect(source).not.toContain("router.events");
    }
    expect(shell).toContain("beforeunload");
  });
});

// -------------------------------------------------------- accessibility

describe("accessibility and layout", () => {
  it("groups the fields into labelled sections", () => {
    renderForm();

    for (const title of Object.values(LABELS.sections)) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
  });

  it("gives every control the shared metrics, and none its own", () => {
    // 44px was the rule, one class at a time. The height is decided
    // centrally now — 32 for a button, 36 for a field — so what a
    // form must not do is set one itself.
    const { container } = renderForm();

    for (const control of container.querySelectorAll("input[type='text'], select, button")) {
      expect([control.tagName, control.className]).not.toContain("min-h-11");
      expect(control.className).toMatch(
        /min-h-control|h-field|px-control-x|FIELD|rounded-control|rounded-md/,
      );
    }
  });

  it("announces the summary assertively", async () => {
    renderForm();
    fireEvent.click(screen.getByText(LABELS.submitCreate));

    const summary = (await screen.findByText(LABELS.errorSummaryTitle)).parentElement!;
    expect(summary).toHaveAttribute("role", "alert");
    expect(summary).toHaveAttribute("aria-live", "assertive");
  });

  it("uses text inputs for decimals, so a browser cannot discard the value", () => {
    renderForm();

    expect(screen.getByLabelText(/الوزن/)).toHaveAttribute("type", "text");
    expect(screen.getByLabelText(/الوزن/)).toHaveAttribute("inputmode", "decimal");
  });
});

// -------------------------------------------------------------- routing

describe("the pages exist and are guarded", () => {
  const pages = [
    "app/[locale]/supplier/products/new/page.tsx",
    "app/[locale]/supplier/products/[id]/page.tsx",
    "app/[locale]/supplier/products/[id]/offers/new/page.tsx",
  ];

  it.each(pages)("%s re-guards and adds no shell", (page) => {
    expect(existsSync(join(ROOT, page))).toBe(true);
    const source = strip(read(page));

    expect(source).toContain('requireRoleOrRedirect(appLocale, "SUPPLIER")');
    expect(source).not.toContain("<AppShell");
    expect(source).not.toContain("force-dynamic");
  });

  it("renders no form in a state the API refuses", () => {
    const source = strip(read("app/[locale]/supplier/products/[id]/edit/page.tsx"));

    // Gated on the same guard the media panel uses, and the early return
    // comes before the reference data is even fetched.
    expect(source).toContain("if (!gate.canEditMedia)");
    expect(source.indexOf("if (!gate.canEditMedia)")).toBeLessThan(source.indexOf("loadTaxonomy()"));
    expect(source).toContain("lockedTitle");
  });

  it("answers unknown and cross-company with a real 404", () => {
    const source = strip(read("app/[locale]/supplier/products/[id]/page.tsx"));

    expect(source).toContain("if (!result.ok && result.notFound) notFound()");
  });

  it("links to create from the STRIP and to edit from the detail", () => {
    // The list used to carry its own «إضافة منتج». The owner moved
    // every page's one action up into the strip the layout draws — one
    // row, always in the same place — and had the bar it stood in
    // deleted.
    expect(strip(read("components/supplier/supplier-bar-actions.ts"))).toContain(
      "/products/new"
    );

    const detail = strip(read("app/[locale]/supplier/products/[id]/page.tsx"));
    expect(detail).toContain("/edit");
    // Only where the API would accept a write.
    expect(detail).toContain("gate.canEditMedia ? (");
  });

  it("ADDING IS NOT SELLING, and the page that adds does neither by halves", () => {
    // THIS TEST HAS BEEN BOTH WAYS ROUND. Adding and publishing were
    // separate, then one submission, and now separate again — because
    // the owner needs a supplier to record goods they are not selling
    // yet: «يسجّل المورد كل منتجاته وتُحفظ لديه، ثم يُنشئ عرضًا على
    // منتجات مختارة». What is here is the third shape, and it is not a
    // return to the first: adding is still ONE form and ONE button.
    const source = read("app/[locale]/supplier/products/new/page.tsx");
    const ar = JSON.parse(read("messages/ar-SA.json"));

    // No numbered next steps, because adding is one step.
    expect(source).not.toContain("nextStepsTitle");

    // The approved reference writes the button out on a bar of its
    // own: «إضافة المنتج».
    expect(ar.supplier.listings.form.submit).toBe("إضافة المنتج");

    // The catalogue row and its picture — and NOT an offer. No price,
    // no quantity, no clock reaches this endpoint.
    expect(source).toContain('scope="product"');
    const form = read("components/supplier/listing-form.tsx");
    expect(form).toContain('"/companies/me/products"');
    expect(form).toContain("uploadFile");
    expect(form).toContain("/media`");
    // The merged endpoint that created a product and published an offer
    // in one call is no longer what a supplier's «إضافة» does.
    expect(form).not.toContain('"/companies/me/listings"');
  });

  it("puts the OFFER on its own page, under the product it is made on", () => {
    const source = read("app/[locale]/supplier/products/[id]/offers/new/page.tsx");
    const form = read("components/supplier/listing-form.tsx");

    expect(source).toContain('scope="offer"');
    // The product is in the address, so the form is never asked which
    // one this is about.
    expect(source).toContain("productId={product.id}");
    expect(form).not.toContain("placeholderProduct");

    // Created, then published — the same publish the offer's own button
    // calls, so there is no second idea of what publishing means.
    expect(form).toContain('"/companies/me/opportunities"');
    expect(form).toContain("/publish`");
  });
});

describe("message parity for the new keys", () => {
  const flatten = (value: unknown, prefix = ""): string[] =>
    typeof value !== "object" || value === null
      ? [prefix]
      : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
          flatten(v, prefix ? `${prefix}.${k}` : k)
        );

  it("ships identical product keys in both locales", () => {
    const ar = JSON.parse(read("messages/ar-SA.json")).supplier.products;
    const en = JSON.parse(read("messages/en-SA.json")).supplier.products;

    expect(flatten(ar).sort()).toEqual(flatten(en).sort());
  });

  it("covers every label the form asks for", () => {
    const ar = JSON.parse(read("messages/ar-SA.json")).supplier.products.form;

    expect(Object.keys(ar.fields).sort()).toEqual(Object.keys(LABELS.fields).sort());
    expect(Object.keys(ar.sections).sort()).toEqual(Object.keys(LABELS.sections).sort());
  });
});
