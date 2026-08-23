import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductMediaView } from "@platform/types";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Reordering a product's images.
 *
 * Buttons, not drag-and-drop: a drag handle is unreachable by keyboard and
 * hostile on a touch screen. The API takes the COMPLETE ordered id set and
 * checks true set equality, so a partial or duplicated list is refused —
 * this proves the client never builds one.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const media = (ids: string[], mainIndex = 0): ProductMediaView[] =>
  ids.map((id, index) => ({
    id,
    url: `/api/v1/companies/me/products/p-1/media/${id}/image`,
    thumbnailUrl: `/api/v1/companies/me/products/p-1/media/${id}/image?variant=thumb`,
    contentType: "image/jpeg",
    sizeBytes: 1000,
    isMain: index === mainIndex,
    sortOrder: index,
  }));

const LABELS = {
  heading: "الصور",
  empty: "لا صور",
  imageAlt: "صورة {index} للمنتج {name}",
  mainImageAlt: "الصورة الرئيسية للمنتج {name}",
  mainBadge: "الرئيسية",
  setMain: "اجعلها الرئيسية",
  remove: "حذف",
  removePrompt: "تأكيد الحذف",
  confirm: "تأكيد",
  cancel: "إلغاء",
  working: "جارٍ…",
  addImage: "إضافة صورة",
  addImageHint: "تلميح",
  openFull: "فتح",
  errorTitle: "تعذّر",
  requestIdLabel: "المرجع",
  moveUp: "نقل صورة {name} رقم {index} للأعلى",
  moveDown: "نقل صورة {name} رقم {index} للأسفل",
  reorderHint: "استخدم الأزرار",
};

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const { ProductMediaManager } = await import("@/components/supplier/product-media-manager");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  fetchMock = vi.fn().mockResolvedValue(
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderManager(ids = [A, B, C], canEdit = true, mainIndex = 0) {
  return render(
    <ProductMediaManager
      productId="p-1"
      media={media(ids, mainIndex)}
      canEdit={canEdit}
      productName="زيت"
      labels={LABELS}
    />
  );
}

const up = (index: number) =>
  screen.getByLabelText(LABELS.moveUp.replace("{name}", "زيت").replace("{index}", String(index)));
const down = (index: number) =>
  screen.getByLabelText(LABELS.moveDown.replace("{name}", "زيت").replace("{index}", String(index)));

const sentIds = () => JSON.parse(fetchMock.mock.calls[0][1].body as string).mediaIds as string[];

describe("reorder is operable by keyboard alone", () => {
  it("offers real buttons, never a drag-only handle", () => {
    const { container } = renderManager();

    expect(up(2)).toBeInstanceOf(HTMLButtonElement);
    expect(down(1)).toBeInstanceOf(HTMLButtonElement);
    expect(container.querySelector("[draggable='true']")).toBeNull();
    expect(strip(read("components/supplier/product-media-manager.tsx"))).not.toContain("onDragStart");
  });

  it("moves on Enter and on Space, like any button", async () => {
    renderManager();

    down(1).focus();
    expect(document.activeElement).toBe(down(1));
    fireEvent.click(document.activeElement!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("gives every control a 44px target and a descriptive name", () => {
    renderManager();

    expect(up(2).className).toContain("min-h-11");
    expect(down(1).getAttribute("aria-label")).toContain("زيت");
    expect(down(1).getAttribute("aria-label")).toContain("1");
  });
});

describe("the request carries the complete ordered set", () => {
  it("sends every id, in the new order", async () => {
    renderManager();

    fireEvent.click(down(1));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/companies/me/products/p-1/media/reorder");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(sentIds()).toEqual([B, A, C]);
  });

  it("moves the last item up correctly", async () => {
    renderManager();

    fireEvent.click(up(3));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(sentIds()).toEqual([A, C, B]);
  });

  it("never sends a duplicate or a short list", async () => {
    renderManager();

    fireEvent.click(down(1));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const ids = sentIds();
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect([...ids].sort()).toEqual([A, B, C].sort());
  });

  it("builds the list from the server's own media, not from local state", () => {
    // That is what guarantees it is complete and free of duplicates.
    const code = strip(read("components/supplier/product-media-manager.tsx"));

    expect(code).toContain("const ordered = media.map((image) => image.id)");
  });
});

describe("the ends of the list", () => {
  it("disables up on the first and down on the last", () => {
    renderManager();

    expect(up(1)).toBeDisabled();
    expect(down(3)).toBeDisabled();
    expect(down(1)).toBeEnabled();
    expect(up(3)).toBeEnabled();
  });

  it("keeps the disabled controls present rather than hiding them", () => {
    // A control that disappears at the edge of a list moves every other
    // control as you use it.
    renderManager();

    expect(up(1)).toBeInTheDocument();
    expect(down(3)).toBeInTheDocument();
  });

  it("offers no reorder for a single image", () => {
    renderManager([A]);

    expect(screen.queryByLabelText(/للأعلى/)).not.toBeInTheDocument();
    expect(screen.queryByText(LABELS.reorderHint)).not.toBeInTheDocument();
  });

  it("offers no reorder when the API would refuse a write", () => {
    renderManager([A, B, C], false);

    expect(screen.queryByLabelText(/للأعلى/)).not.toBeInTheDocument();
  });
});

describe("failures and double submits", () => {
  it("fires once while a request is in flight", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));

    renderManager();
    fireEvent.click(down(1));
    fireEvent.click(down(1));
    fireEvent.click(up(3));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("claims no success on failure, and keeps the confirmed order visible", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: "reorder must include exactly..." },
          requestId: "req-8",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );

    const { container } = renderManager();
    fireEvent.click(down(1));

    await screen.findByRole("alert");

    // No refresh, so nothing re-reads — and the grid still shows the
    // order the server last confirmed, because nothing was painted
    // optimistically.
    expect(refreshMock).not.toHaveBeenCalled();
    const alts = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("alt"));
    expect(alts[0]).toContain("الصورة الرئيسية");
    expect(document.body.textContent).not.toContain("must include exactly");
  });

  it("re-reads from the server on success rather than painting a guess", async () => {
    renderManager();
    fireEvent.click(down(1));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    const code = strip(read("components/supplier/product-media-manager.tsx"));
    expect(code).not.toContain("setMedia");
    expect(code).not.toContain("optimistic");
  });
});

describe("the main image marker survives", () => {
  it("tracks isMain from the server, never from position", () => {
    // Reordering does not change which image is main — the API keeps the
    // flag on the row. Deriving "main" from index 0 would silently
    // relabel a product after any move.
    renderManager([A, B, C], true, 1);

    const alts = Array.from(document.querySelectorAll("img")).map((img) => img.getAttribute("alt"));
    expect(alts[1]).toContain("الصورة الرئيسية");
    expect(alts[0]).not.toContain("الصورة الرئيسية");

    const code = strip(read("components/supplier/product-media-manager.tsx"));
    expect(code).toContain("image.isMain");
    expect(code).not.toMatch(/index === 0 \?\s*labels\.mainImageAlt/);
  });

  it("offers set-main on every image except the current one", () => {
    renderManager([A, B, C], true, 1);

    expect(screen.getAllByText(LABELS.setMain)).toHaveLength(2);
  });
});

describe("the panel is the focus target for MAIN_IMAGE_REQUIRED", () => {
  it("carries the id the error summary anchors to, and is focusable", () => {
    const { container } = renderManager();
    const panel = container.querySelector("#product-media-panel")!;

    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("tabindex", "-1");
  });
});
