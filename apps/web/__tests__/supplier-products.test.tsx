import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductApprovalStatus, ProductMediaView } from "@platform/types";
import {
  productActions,
  productNeedsAttention,
  productNextStepKey,
} from "@/lib/product-actions";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIST = read("app/[locale]/supplier/products/page.tsx");
const DETAIL = read("app/[locale]/supplier/products/[id]/page.tsx");
const MANAGER = read("components/supplier/product-media-manager.tsx");
const ACTIONS = read("components/supplier/product-actions.tsx");
const SUPPLIER_DATA = read("lib/supplier-data.ts");

const ALL_STATUSES: readonly ProductApprovalStatus[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "CLOSED",
];

// ------------------------------------------------------- action gating

/**
 * The gate, checked against the API's own guards.
 *
 * Every row here was transcribed from `products.service.ts`:
 *
 *   submit  — rejects archived, then anything not DRAFT/REJECTED.
 *   archive — rejects archived and PENDING_REVIEW only. CLOSED passes.
 *   edit    — `assertEditableTx` rejects archived, PENDING_REVIEW and
 *             CLOSED. SUSPENDED and APPROVED pass.
 *
 * If the service's guards change, these expectations are what fail.
 */
describe("action gating matches the API's guards, state by state", () => {
  const live = (approvalStatus: ProductApprovalStatus) => ({ approvalStatus, archivedAt: null });

  it.each([
    ["DRAFT", true],
    ["REJECTED", true],
    ["APPROVED", false],
    ["SUSPENDED", false],
    ["PENDING_REVIEW", false],
    ["CLOSED", false],
  ] as const)("submit from %s -> %s", (status, allowed) => {
    expect(productActions(live(status)).canSubmit).toBe(allowed);
  });

  it.each([
    ["DRAFT", true],
    ["REJECTED", true],
    ["APPROVED", true],
    ["SUSPENDED", true],
    ["CLOSED", true],
    ["PENDING_REVIEW", false],
  ] as const)("archive from %s -> %s", (status, allowed) => {
    // CLOSED is archivable on purpose: `archive` guards only on
    // archivedAt and PENDING_REVIEW.
    expect(productActions(live(status)).canArchive).toBe(allowed);
  });

  it.each([
    ["DRAFT", true],
    ["REJECTED", true],
    ["APPROVED", true],
    ["SUSPENDED", true],
    ["PENDING_REVIEW", false],
    ["CLOSED", false],
  ] as const)("edit and media from %s -> %s", (status, allowed) => {
    expect(productActions(live(status)).canEditMedia).toBe(allowed);
  });

  it.each(ALL_STATUSES)("an archived %s product allows nothing at all", (status) => {
    expect(productActions({ approvalStatus: status, archivedAt: "2026-08-01T00:00:00.000Z" })).toEqual(
      { canSubmit: false, canArchive: false, canEditMedia: false }
    );
  });

  it("gives every state a next step", () => {
    const messages = JSON.parse(read("messages/ar-SA.json")).supplier.products.nextStep;

    for (const status of ALL_STATUSES) {
      const key = productNextStepKey({ approvalStatus: status, archivedAt: null });
      const value = key.split(".").reduce<unknown>((node, part) => (node as never)[part], messages);
      expect(value, status).toBeTruthy();
    }

    expect(messages.archived).toBeTruthy();
    expect(productNextStepKey({ approvalStatus: "DRAFT", archivedAt: "x" })).toBe("archived");
  });

  it("flags exactly the states where the supplier must act", () => {
    for (const status of ALL_STATUSES) {
      expect([status, productNeedsAttention({ approvalStatus: status, archivedAt: null })]).toEqual([
        status,
        status === "DRAFT" || status === "REJECTED" || status === "SUSPENDED",
      ]);
    }

    // Archived is finished with, whatever its status used to be.
    expect(productNeedsAttention({ approvalStatus: "REJECTED", archivedAt: "x" })).toBe(false);
  });
});

describe("no button is rendered for an action the API would refuse", () => {
  it("drives every control from the gate, never from a raw status", () => {
    const code = strip(DETAIL);

    expect(code).toContain("productActions(product)");
    expect(code).toContain("gate={gate}");
    expect(code).toContain("canEdit={gate.canEditMedia}");
    // No status comparison decides an action's visibility here — that
    // rule lives in one place and is tested above.
    expect(code).not.toMatch(/approvalStatus === "DRAFT"/);
    expect(code).not.toMatch(/approvalStatus === "REJECTED"/);
  });

  it("renders nothing when neither action is allowed", () => {
    expect(strip(ACTIONS)).toContain("if (!gate.canSubmit && !gate.canArchive) return null");
  });

  it("offers no edit form while no edit screen exists", () => {
    // PATCH /companies/me/products/:id exists, but a field-editing
    // screen does not. A control that opens nothing promises an action
    // the product cannot perform.
    for (const source of [strip(LIST), strip(DETAIL)]) {
      expect(source).not.toContain("onSubmit");
      expect(source).not.toContain("<form");
    }
    expect(strip(DETAIL)).not.toContain("apiClient.patch");
  });

  it("offers no create control while no create screen exists", () => {
    expect(strip(LIST)).not.toMatch(/<Button\b/);
    expect(strip(LIST)).not.toContain("apiClient.post");
  });

  it("offers reorder only where the API's edit guard would accept it", () => {
    // Built in 8E.5c. It sends the COMPLETE ordered id set, and it sits
    // behind the same `canEdit` gate as every other media mutation.
    const code = strip(MANAGER);

    expect(code).toContain("media/reorder");
    expect(code).toContain("canEdit && media.length > 1");
  });
});

// -------------------------------------------------------------- writes

describe("writes go through the shared client, with the right guards", () => {
  it("posts submit and archive to the real endpoints", () => {
    const code = strip(ACTIONS);

    expect(code).toContain("`/companies/me/products/${productId}/${action}`");
    expect(code).toMatch(/"submit" \| "archive"/);
  });

  it("sends no Idempotency-Key, because these endpoints take none", () => {
    // Neither controller is in the API's idempotent set. Inventing a key
    // would be sent and ignored, and would suggest a guarantee the
    // endpoint does not give.
    for (const source of [strip(ACTIONS), strip(MANAGER)]) {
      expect(source).not.toContain("idempotencyKey");
      expect(source).not.toContain("Idempotency");
    }
  });

  it("relies on apiClient for Origin and cookies rather than fetching directly", () => {
    for (const source of [strip(ACTIONS), strip(MANAGER)]) {
      expect(source).not.toContain("fetch(");
      expect(source).not.toContain("credentials");
      expect(source).toContain('from "@/lib/api-client"');
    }
  });

  it("refuses a second write while one is in flight", () => {
    expect(strip(ACTIONS)).toContain("if (submitting !== null) return");
    expect(strip(MANAGER)).toContain("if (busy) return");
  });

  it("asks before every irreversible action", () => {
    // Archiving has no inverse endpoint, and removing an image deletes
    // the stored file.
    expect(strip(ACTIONS)).toContain("archivePrompt");
    expect(strip(ACTIONS)).toContain("setAsking");
    expect(strip(MANAGER)).toContain("removePrompt");
    expect(strip(MANAGER)).toContain("setRemoving");
  });

  it("re-reads the server instead of fabricating a status", () => {
    for (const source of [strip(ACTIONS), strip(MANAGER)]) {
      expect(source).toContain("router.refresh()");
      expect(source).not.toContain("setStatus");
      expect(source).not.toContain("optimistic");
    }
  });

  it("shows a closed, translated message and never the API's own text", () => {
    for (const source of [strip(ACTIONS), strip(MANAGER)]) {
      expect(source).toContain("toUserFacingError");
      expect(source).toContain("root(failure.messageKey)");
      // `messageKey` is the allowed one; the raw `message` is not.
      expect(source).not.toMatch(/failure\.message\b(?!Key)/);
      expect(source).not.toContain("error.message");
      expect(source).not.toContain("details");
    }
  });
});

// --------------------------------------------------------------- media

const MEDIA: ProductMediaView[] = [
  {
    id: "m-1",
    url: "/api/v1/companies/me/products/p-1/media/m-1/image",
    thumbnailUrl: "/api/v1/companies/me/products/p-1/media/m-1/image?variant=thumb",
    contentType: "image/jpeg",
    sizeBytes: 2048,
    isMain: true,
    sortOrder: 0,
  },
  {
    id: "m-2",
    url: "/api/v1/companies/me/products/p-1/media/m-2/image",
    thumbnailUrl: "/api/v1/companies/me/products/p-1/media/m-2/image?variant=thumb",
    contentType: "image/png",
    sizeBytes: 4096,
    isMain: false,
    sortOrder: 1,
  },
];

const LABELS = {
  heading: "صور المنتج",
  empty: "لا توجد صور",
  imageAlt: "صورة {index} للمنتج {name}",
  mainImageAlt: "الصورة الرئيسية للمنتج {name}",
  mainBadge: "الصورة الرئيسية",
  setMain: "اجعلها الرئيسية",
  remove: "حذف",
  removePrompt: "سيُحذف الملف نهائيًا.",
  confirm: "تأكيد",
  cancel: "إلغاء",
  working: "جارٍ التنفيذ…",
  addImage: "إضافة صورة",
  addImageHint: "تلميح",
  openFull: "فتح الصورة",
  errorTitle: "تعذّر إتمام الطلب",
  requestIdLabel: "رقم المرجع",
  moveUp: "نقل صورة {name} رقم {index} للأعلى",
  moveDown: "نقل صورة {name} رقم {index} للأسفل",
  reorderHint: "استخدم زرّي الأعلى والأسفل",
};

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const { ProductMediaManager } = await import("@/components/supplier/product-media-manager");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "m-3" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderManager(canEdit = true, media: ProductMediaView[] = MEDIA) {
  return render(
    <ProductMediaManager
      productId="p-1"
      media={media}
      canEdit={canEdit}
      productName="زيت زيتون"
      labels={LABELS}
    />
  );
}

describe("product images come only from the private delivery route", () => {
  it("renders the THUMBNAIL and links the full image", () => {
    // A ten-image product must not download ten full-size files.
    const { container } = renderManager();

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.getAttribute("src")).toContain("variant=thumb");
    }

    const links = container.querySelectorAll("a[href]");
    for (const link of links) {
      expect(link.getAttribute("href")).not.toContain("variant=thumb");
      expect(link.getAttribute("href")).toContain("/media/");
    }
  });

  it("carries no storage key, signature or expiry in any URL", () => {
    const { container } = renderManager();
    const urls = [...container.querySelectorAll("img, a[href]")].map(
      (node) => node.getAttribute("src") ?? node.getAttribute("href") ?? ""
    );

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      // A storage key looks like `products/<id>/<uuid>.jpg` — the giveaway
      // is the file extension, since `/products/` is also a legitimate
      // segment of the delivery route itself.
      for (const forbidden of ["objectKey", "X-Amz", "Signature", "expires"]) {
        expect(url, `${url} :: ${forbidden}`).not.toContain(forbidden);
      }
      expect(url, url).not.toMatch(/\.(jpg|jpeg|png|webp)\b/);
      expect(url, url).not.toContain("-thumb");
    }
  });

  it("builds no URL of its own — only the API's paths, origin-prefixed", () => {
    const code = strip(MANAGER);

    expect(code).toContain("mediaUrl(image.url)");
    expect(code).toContain("mediaUrl(image.thumbnailUrl)");
    expect(code).not.toContain("productMediaImagePath");
    expect(code).not.toContain("objectKey");
  });

  it("gives every image a real alt naming the product", () => {
    renderManager();

    expect(screen.getByAltText("الصورة الرئيسية للمنتج زيت زيتون")).toBeInTheDocument();
    expect(screen.getByAltText("صورة 2 للمنتج زيت زيتون")).toBeInTheDocument();
  });

  it("does not route private images through the image optimizer", () => {
    // next/image fetches server-side WITHOUT the visitor's session
    // cookie, and this route is private — it would answer 401.
    expect(MANAGER).not.toContain('from "next/image"');
    expect(LIST).not.toContain('from "next/image"');
  });

  it("says nothing about another company's media, because it never asks", () => {
    // The component only ever addresses ids the API just sent it for
    // THIS product. There is no id input and no cross-product path.
    const code = strip(MANAGER);

    expect(code).toContain("`/companies/me/products/${productId}/media/${image.id}");
    expect(code).not.toMatch(/products\/\$\{[a-zA-Z]*[Ii]d\}\/media\/\$\{(?!image\.id)/);
  });
});

describe("uploading an image", () => {
  it("sends multipart through the existing helper, with no Content-Type of its own", async () => {
    // Setting a Content-Type on a FormData body destroys the boundary
    // the browser generates and the request arrives unparseable.
    const { container } = renderManager();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["binary"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/companies/me/products/p-1/media");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.credentials).toBe("include");
  });

  it("re-reads the server after a successful upload", async () => {
    const { container } = renderManager();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("shows a closed message when the server rejects the image", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: "File could not be decoded as an image" },
          requestId: "req-9",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );

    const { container } = renderManager();
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
    });

    const alert = await screen.findByRole("alert");

    // The translated KEY for a known code — never the API's English
    // developer string, which names the decoder.
    expect(within(alert).getByText("errors.codes.VALIDATION_FAILED")).toBeInTheDocument();
    expect(alert.textContent).not.toContain("decoded");
    expect(alert.textContent).toContain("req-9");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("clears the input so the same file can be chosen again", () => {
    const { container } = renderManager();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });

    expect(input.value).toBe("");
  });

  it("states no numeric limit it cannot know", () => {
    // The maximum count and size are admin-configured and no endpoint
    // exposes them; a number here would be a value this app invented.
    const messages = JSON.parse(read("messages/ar-SA.json")).supplier.products.media;

    expect(messages.addImageHint).not.toMatch(/\d/);
    expect(strip(MANAGER)).not.toMatch(/\b(5|10|20)\s*(MB|ميغا)/);
  });
});

describe("set-main and remove", () => {
  it("posts set-main only for an image that is not already main", async () => {
    renderManager();

    expect(screen.getAllByText(LABELS.setMain)).toHaveLength(1);

    fireEvent.click(screen.getByText(LABELS.setMain));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/companies/me/products/p-1/media/m-2/set-main");
    expect(init.method).toBe("POST");
  });

  it("asks before removing, then deletes", async () => {
    renderManager();

    fireEvent.click(screen.getAllByText(LABELS.remove)[0]);
    expect(await screen.findByText(LABELS.removePrompt)).toBeInTheDocument();
    // Nothing has been sent yet.
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(LABELS.confirm));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/companies/me/products/p-1/media/m-1");
    expect(init.method).toBe("DELETE");
  });

  it("draws no media control at all when the API would refuse an edit", () => {
    renderManager(false);

    expect(screen.queryByText(LABELS.setMain)).not.toBeInTheDocument();
    expect(screen.queryByText(LABELS.remove)).not.toBeInTheDocument();
    expect(screen.queryByText(LABELS.addImage)).not.toBeInTheDocument();
    // The images themselves stay readable.
    expect(screen.getByAltText("الصورة الرئيسية للمنتج زيت زيتون")).toBeInTheDocument();
  });

  it("shows an empty state rather than an empty grid", () => {
    renderManager(true, []);

    expect(screen.getByText(LABELS.empty)).toBeInTheDocument();
  });

  it("gives every control a 44px touch target", () => {
    const { container } = renderManager();

    for (const button of container.querySelectorAll("button")) {
      const classes = button.className;
      expect(classes.includes("min-h-11") || classes.includes("h-11") || classes.includes("py-")).toBe(
        true
      );
    }
  });
});

// ---------------------------------------------------------------- pages

describe("the list and detail pages", () => {
  it("read the closed contracts, not a raw row", () => {
    expect(strip(SUPPLIER_DATA)).toContain("loadSupplierProducts");
    expect(strip(SUPPLIER_DATA)).toContain("ProductSummary[]");
    expect(strip(SUPPLIER_DATA)).toContain("ProductDetail");
  });

  it("answers an unknown or another company's id with a real 404", () => {
    // The API gives both the same 404 so probing reveals nothing;
    // rendering Next's 404 for either preserves that. An error state
    // would imply the record exists and is broken.
    const code = strip(DETAIL);

    expect(code).toContain("if (!result.ok && result.notFound) notFound()");
    expect(code).toContain('from "next/navigation"');
  });

  it("keeps 'failed' distinct from 'not found'", () => {
    expect(strip(SUPPLIER_DATA)).toContain("loadOrNotFound");
    expect(strip(DETAIL)).toContain("<ErrorState");
  });

  it("puts what needs attention first and hides it when empty", () => {
    const code = strip(LIST);

    expect(code).toContain("productNeedsAttention");
    expect(code).toContain("attention.length > 0 ?");
    expect(code.indexOf("needsAttention.title")).toBeLessThan(code.indexOf("allTitle"));
  });

  it("has a loading, error and empty state on the list", () => {
    const code = strip(LIST);

    expect(code).toContain("<LoadingState");
    expect(code).toContain("<ErrorState");
    expect(code).toContain("<EmptyState");
    expect(code).toContain("<Suspense");
  });

  it("invents no pager over an unpaginated endpoint", () => {
    expect(strip(LIST)).not.toContain("page=");
    expect(strip(LIST)).not.toContain("Pagination");
    expect(strip(SUPPLIER_DATA)).toContain('load<ProductSummary[]>("/companies/me/products")');
  });

  it("renders every status through a translation, never the raw enum", () => {
    for (const source of [strip(LIST), strip(DETAIL)]) {
      expect(source).toContain("status(`product.${product.approvalStatus}`)");
      // `${...}` inside the message key is the correct use; a bare
      // `{product.approvalStatus}` in JSX would put the enum on screen.
      expect(source).not.toMatch(/[^$]\{\s*product\.approvalStatus\s*\}/);
    }
  });

  it("shows the reviewer's rejection reason, which was written for the supplier", () => {
    for (const source of [strip(LIST), strip(DETAIL)]) {
      expect(source).toContain("product.rejectionReason");
    }
  });

  it("renders decimal measurements as sent, with no arithmetic", () => {
    const code = strip(DETAIL);

    expect(code).toContain("product.weightPerUnit");
    expect(code).not.toMatch(/Number\(\s*product\./);
    expect(code).not.toContain("parseFloat");
    expect(code).not.toMatch(/product\.\w+ \* /);
  });

  it("leaks no internal field", () => {
    for (const source of [LIST, DETAIL, MANAGER]) {
      for (const forbidden of ["objectKey", "thumbnailObjectKey", "snapshot", "companyId"]) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("re-guards on both pages and adds no AppShell", () => {
    for (const source of [strip(LIST), strip(DETAIL)]) {
      expect(source).toContain('requireRoleOrRedirect(appLocale, "SUPPLIER")');
      expect(source).not.toContain("<AppShell");
      expect(source).not.toContain("force-dynamic");
    }
  });
});

describe("navigation and message parity", () => {
  it("turns the products nav item into a real link now that the pages exist", async () => {
    const { SUPPLIER_NAV_DESTINATIONS } = await import("@/components/shell/supplier-nav");
    const products = SUPPLIER_NAV_DESTINATIONS.find((d) => d.key === "products")!;

    expect(products.built).toBe(true);
    expect(existsSync(join(ROOT, "app", "[locale]", "supplier", "products", "page.tsx"))).toBe(true);
  });

  it("marks a destination built only when its page exists, and vice versa", async () => {
    // The general invariant, rather than pinning one key's value: a link
    // with no page is a 404 reached through our own menu, and a page with
    // no link is unreachable.
    const { SUPPLIER_NAV_DESTINATIONS } = await import("@/components/shell/supplier-nav");

    for (const destination of SUPPLIER_NAV_DESTINATIONS) {
      const dir = destination.segment
        ? join(ROOT, "app", "[locale]", "supplier", destination.segment)
        : join(ROOT, "app", "[locale]", "supplier");

      expect([destination.key, existsSync(join(dir, "page.tsx"))]).toEqual([
        destination.key,
        destination.built,
      ]);
    }
  });

  it("ships identical product keys in both locales", () => {
    const ar = JSON.parse(read("messages/ar-SA.json")).supplier;
    const en = JSON.parse(read("messages/en-SA.json")).supplier;

    const flatten = (value: unknown, prefix = ""): string[] =>
      typeof value !== "object" || value === null
        ? [prefix]
        : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
            flatten(v, prefix ? `${prefix}.${k}` : k)
          );

    expect(flatten(ar.products).sort()).toEqual(flatten(en.products).sort());

    // Every approval status, plus ARCHIVED — which is not one of them.
    // `archivedAt` is an independent lifecycle flag, and the edit screen
    // shows it as the reason a product is locked, so it needs a label of
    // its own rather than borrowing whichever status the row still has.
    const expected = [...ALL_STATUSES, "ARCHIVED"].sort();
    expect(Object.keys(ar.status.product).sort()).toEqual(expected);
    expect(Object.keys(en.status.product).sort()).toEqual(expected);
  });

  it("never promises a review queue that submit does not use", () => {
    // `submit` runs technical checks and approves outright. Copy saying
    // "sent for review" would describe a queue this path does not have.
    const en = JSON.parse(read("messages/en-SA.json")).supplier.products;

    expect(en.actions.submitPrompt.toLowerCase()).toContain("automatically");
    expect(en.nextStep.status.DRAFT.toLowerCase()).not.toContain("wait for review");
  });
});
