import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/ar-SA.json";
import type { AdminTaxonomyNodeItem } from "@platform/types";
import { canNestUnder, TAXONOMY_MAX_DEPTH } from "@platform/types";
import { TaxonomyManager } from "@/components/admin/taxonomy-manager";

/**
 * «إدارة التصنيفات» — the catalogue's categories, on their own screen.
 *
 * A MAIN CATEGORY AND TWO LEVELS UNDER IT. The rule is the server's;
 * what is pinned here is that the SCREEN agrees with it — a form that
 * offers a fourth level and then meets a refusal has wasted somebody's
 * typing.
 */
const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));

const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
    delete: (...args: unknown[]) => del(...args),
  },
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}));

function node(
  over: Partial<AdminTaxonomyNodeItem> & { id: string },
): AdminTaxonomyNodeItem {
  return {
    parentId: null,
    nameAr: "تصنيف",
    nameEn: "Category",
    iconUrl: null,
    sortOrder: 0,
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    depth: 1,
    childCount: 0,
    productCount: 0,
    ...over,
  };
}

const LABELS = {
  addRoot: "تصنيف رئيسي جديد",
  addChild: "إضافة فرع",
  edit: "تعديل",
  remove: "حذف",
  nameAr: "الاسم بالعربية",
  nameEn: "الاسم بالإنجليزية",
  sortOrder: "الترتيب",
  sortOrderHint: "الأصغر أولًا",
  save: "حفظ",
  cancel: "إلغاء",
  empty: "لا توجد تصنيفات بعد.",
  active: "مفعّل",
  inactive: "معطّل",
  activate: "تفعيل",
  deactivate: "تعطيل",
  confirmRemove: "سيُحذف هذا التصنيف نهائيًا.",
  depthReached: "أعمق مستوى",
  move: "نقل",
  moveTo: "نقل إلى",
  moveRoot: "المستوى الأول",
  moveSave: "تنفيذ النقل",
  moveNowhere: "لا توجد وجهة صالحة",
  treeTitle: "التصنيفات",
  products: "المنتجات",
  state: "الحالة",
  requestIdLabel: "المرجع",
};

function mount(nodes: AdminTaxonomyNodeItem[]) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <TaxonomyManager nodes={nodes} labels={LABELS} locale="ar-SA" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  del.mockReset().mockResolvedValue({});
  refresh.mockReset();
});

// =====================================================================
// The shape
// =====================================================================
describe("the tree", () => {
  it("says so when there is nothing yet", () => {
    mount([]);
    expect(screen.getByText(LABELS.empty)).toBeTruthy();
  });

  it("keeps the branches folded under their category until it is pressed", async () => {
    // «خلّ الفروع تختفي تحت التصنيف، وإذا ضغط عليه تنفتح تحته.»
    //
    // AND CLOSES AGAIN on the second press: the same control, and
    // the same intent read twice.
    const user = userEvent.setup();
    mount([
      node({ id: "root", nameAr: "إلكترونيات", childCount: 1 }),
      node({ id: "phones", nameAr: "هواتف", parentId: "root", depth: 2 }),
    ]);

    expect(screen.getByTestId("taxonomy-node-root")).toBeTruthy();
    expect(screen.queryByTestId("taxonomy-node-phones")).toBeNull();

    await user.click(screen.getByTestId("taxonomy-node-root"));
    expect(screen.getByTestId("taxonomy-node-phones")).toBeTruthy();

    await user.click(screen.getByTestId("taxonomy-node-root"));
    expect(screen.queryByTestId("taxonomy-node-phones")).toBeNull();
  });

  it("says whether a row has anything under it, and whether it is showing", async () => {
    // THE ROW ANNOUNCES ITS OWN STATE. A chevron is a picture; this
    // is what a screen reader is told, and a row with nothing under
    // it makes no claim either way.
    const user = userEvent.setup();
    mount([
      node({ id: "root", childCount: 1 }),
      node({ id: "leaf" }),
      node({ id: "phones", parentId: "root", depth: 2 }),
    ]);

    expect(screen.getByTestId("taxonomy-node-root")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByTestId("taxonomy-node-leaf")).not.toHaveAttribute(
      "aria-expanded",
    );

    await user.click(screen.getByTestId("taxonomy-node-root"));
    expect(screen.getByTestId("taxonomy-node-root")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("says a row's depth by where the row starts", async () => {
    // A PADDING, NOT A SPACER ELEMENT. The row is one button and its
    // whole width is the target, so an indent drawn as a sibling
    // would take a bite out of what can be pressed.
    const user = userEvent.setup();
    mount([
      node({ id: "root", childCount: 1 }),
      node({ id: "phones", parentId: "root", depth: 2, childCount: 1 }),
      node({ id: "cases", parentId: "phones", depth: 3 }),
    ]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    await user.click(screen.getByTestId("taxonomy-node-phones"));

    const start = (id: string) =>
      screen.getByTestId(`taxonomy-node-${id}`).style.paddingInlineStart;

    expect(start("root")).toBe("");
    expect(start("phones")).toContain("1.25rem");
    expect(start("cases")).toContain("2.5rem");
  });

  it("keeps one chosen row, and the band acts on it", async () => {
    // THREE SELECTIONS BECAME ONE. There is no walk to remember any
    // more — only the row the dark band is acting on.
    const user = userEvent.setup();
    mount([
      node({ id: "root", childCount: 1 }),
      node({ id: "other" }),
      node({ id: "phones", parentId: "root", depth: 2 }),
    ]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    await user.click(screen.getByTestId("taxonomy-node-phones"));
    expect(screen.getByTestId("taxonomy-node-phones")).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Choosing another row moves the band and folds nothing away
    // that was open: «هواتف» is still on the screen, because its own
    // category is still open.
    await user.click(screen.getByTestId("taxonomy-node-other"));
    expect(screen.getByTestId("taxonomy-node-phones")).toBeTruthy();
    expect(screen.getByTestId("taxonomy-node-phones")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("offers a branch under a row that may still hold one, and not under one that may not", async () => {
    // «نفّذ اللي يسمح للمستوى الثالث» — and only where the server
    // would accept a child: `canNestUnder` is its own rule.
    const user = userEvent.setup();
    mount([
      node({ id: "root", childCount: 1 }),
      node({ id: "phones", parentId: "root", depth: 2, childCount: 1 }),
      node({ id: "cases", parentId: "phones", depth: 3 }),
    ]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    await user.click(screen.getByTestId("taxonomy-node-phones"));
    expect(screen.getByTestId("taxonomy-add-child-phones")).toBeTruthy();

    await user.click(screen.getByTestId("taxonomy-node-cases"));
    expect(screen.queryByTestId("taxonomy-add-child-cases")).toBeNull();
    expect(screen.getByTestId("taxonomy-depth-reached")).toBeTruthy();
  });

  it("opens a category when a branch is added under it", async () => {
    // The input opens after the last row of that category's subtree,
    // and a closed category has no rows there — the field would
    // appear somewhere that says nothing about where it is going.
    const user = userEvent.setup();
    mount([
      node({ id: "root", childCount: 1 }),
      node({ id: "phones", parentId: "root", depth: 2 }),
    ]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    await user.click(screen.getByTestId("taxonomy-node-root"));
    expect(screen.queryByTestId("taxonomy-node-phones")).toBeNull();

    await user.click(screen.getByTestId("taxonomy-add-child-root"));
    expect(screen.getByTestId("taxonomy-node-phones")).toBeTruthy();
    expect(screen.getByTestId("taxonomy-column-tree-new")).toBeTruthy();
  });

  it("counts the products in a category AND in its branches", async () => {
    // «لماذا لا يظهر في التصنيف الرئيسي عدد المنتجات اللي فيه وفي
    //  فروعه؟» — because the row's own `productCount` is the DIRECT
    // one, and a supplier files a product on the deepest category he
    // can reach. A main category owns almost nothing itself.
    const user = userEvent.setup();
    mount([
      node({ id: "root", childCount: 1, productCount: 1 }),
      node({
        id: "phones",
        parentId: "root",
        depth: 2,
        childCount: 1,
        productCount: 4,
      }),
      node({ id: "cases", parentId: "phones", depth: 3, productCount: 7 }),
    ]);

    // 1 of its own, 4 on the branch, 7 on the branch's branch.
    expect(screen.getByTestId("taxonomy-node-root")).toHaveTextContent("12");

    await user.click(screen.getByTestId("taxonomy-node-root"));
    expect(screen.getByTestId("taxonomy-node-phones")).toHaveTextContent("11");

    // A leaf's total IS its direct count — nothing is under it.
    await user.click(screen.getByTestId("taxonomy-node-phones"));
    expect(screen.getByTestId("taxonomy-node-cases")).toHaveTextContent("7");
  });

  it("still refuses to delete on the DIRECT count, not the total", async () => {
    // THE TWO NUMBERS ANSWER DIFFERENT QUESTIONS. The total is what
    // is READ; the direct count is what the server's delete rule is
    // about — it refuses to remove a category products point AT. A
    // rolled-up figure in that position would make the refusal
    // disagree with the screen.
    const user = userEvent.setup();
    mount([
      node({ id: "root", childCount: 1, productCount: 0 }),
      node({ id: "phones", parentId: "root", depth: 2, productCount: 4 }),
    ]);

    // It reads four, and it is refused anyway — for holding a branch.
    await user.click(screen.getByTestId("taxonomy-node-root"));
    expect(screen.getByTestId("taxonomy-node-root")).toHaveTextContent("4");
    expect(screen.queryByTestId("taxonomy-remove-root")).toBeNull();

    // And the branch, which owns those four, is refused for owning
    // them.
    await user.click(screen.getByTestId("taxonomy-node-phones"));
    expect(screen.queryByTestId("taxonomy-remove-phones")).toBeNull();
  });
});
// =====================================================================
// A main category and two levels beneath it
// =====================================================================
describe("three levels, and no fourth", () => {
  it("offers a branch under a main category", async () => {
    const user = userEvent.setup();
    mount([node({ id: "root", depth: 1 })]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    expect(screen.getByTestId("taxonomy-add-child-root")).toBeTruthy();
  });

  it("offers a branch under a second-level category", async () => {
    const user = userEvent.setup();
    mount([
      node({ id: "root", depth: 1, childCount: 1 }),
      node({ id: "level2", parentId: "root", depth: 2 }),
    ]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    await user.click(screen.getByTestId("taxonomy-node-level2"));
    expect(screen.getByTestId("taxonomy-add-child-level2")).toBeTruthy();
  });

  it("offers NOTHING under a third-level category", async () => {
    // Absent, not disabled: a control that could never work is not a
    // control — and the third column is not drawn at all, because
    // nothing could ever be put in it. The server refuses too.
    const user = userEvent.setup();
    mount([
      node({ id: "root", depth: 1, childCount: 1 }),
      node({ id: "level2", parentId: "root", depth: 2, childCount: 1 }),
      node({ id: "level3", parentId: "level2", depth: 3 }),
    ]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    await user.click(screen.getByTestId("taxonomy-node-level2"));
    await user.click(screen.getByTestId("taxonomy-node-level3"));

    expect(screen.queryByTestId("taxonomy-add-child-level3")).toBeNull();
    expect(screen.getByText(LABELS.depthReached)).toBeTruthy();
  });

  it("draws the line at the same depth the contract does", () => {
    expect(TAXONOMY_MAX_DEPTH).toBe(3);
    expect(canNestUnder(1)).toBe(true);
    expect(canNestUnder(2)).toBe(true);
    expect(canNestUnder(3)).toBe(false);
    // A main category answers to no parent at all.
    expect(canNestUnder(null)).toBe(true);
  });
});

// =====================================================================
// Adding, editing, removing
// =====================================================================
describe("what an operator can do", () => {
  it("adds a main category", async () => {
    const user = userEvent.setup();
    mount([]);

    await user.click(screen.getByTestId("taxonomy-add-root"));
    await user.type(screen.getByTestId("taxonomy-draft-ar"), "أدوات");
    await user.type(screen.getByTestId("taxonomy-draft-en"), "Tools");
    await user.click(screen.getByTestId("taxonomy-draft-save"));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/admin/taxonomy", {
        parentId: undefined,
        nameAr: "أدوات",
        nameEn: "Tools",
        sortOrder: 0,
      }),
    );
  });

  it("adds a branch under the category it was opened from", async () => {
    const user = userEvent.setup();
    mount([node({ id: "root", depth: 1 })]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    await user.click(screen.getByTestId("taxonomy-add-child-root"));
    await user.type(screen.getByTestId("taxonomy-draft-ar"), "مفاتيح");
    await user.type(screen.getByTestId("taxonomy-draft-en"), "Wrenches");
    await user.click(screen.getByTestId("taxonomy-draft-save"));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/admin/taxonomy", {
        parentId: "root",
        nameAr: "مفاتيح",
        nameEn: "Wrenches",
        sortOrder: 0,
      }),
    );
  });

  it("will not save a category missing either name", async () => {
    const user = userEvent.setup();
    mount([]);

    await user.click(screen.getByTestId("taxonomy-add-root"));
    await user.type(screen.getByTestId("taxonomy-draft-ar"), "أدوات");

    expect(screen.getByTestId("taxonomy-draft-save")).toBeDisabled();
  });

  it("edits a name in place", async () => {
    const user = userEvent.setup();
    mount([node({ id: "root", nameAr: "أدوات", nameEn: "Tools" })]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    await user.click(screen.getByTestId("taxonomy-edit-root"));
    const field = screen.getByTestId("taxonomy-edit-ar");
    await user.clear(field);
    await user.type(field, "عُدد");
    await user.click(screen.getByTestId("taxonomy-edit-save"));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/admin/taxonomy/root", {
        nameAr: "عُدد",
        nameEn: "Tools",
        sortOrder: 0,
      }),
    );
  });

  it("asks before removing, and does not remove on the first press", async () => {
    // The row asks in its own words. A native dialog cannot be
    // translated, ignores the page direction, and a browser may
    // suppress it — so the question would simply not appear.
    const user = userEvent.setup();
    mount([node({ id: "leaf" })]);

    await user.click(screen.getByTestId("taxonomy-node-leaf"));
    await user.click(screen.getByTestId("taxonomy-remove-leaf"));

    expect(screen.getByText(LABELS.confirmRemove)).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
  });

  it("removes it on the second press", async () => {
    const user = userEvent.setup();
    mount([node({ id: "leaf" })]);

    await user.click(screen.getByTestId("taxonomy-node-leaf"));
    await user.click(screen.getByTestId("taxonomy-remove-leaf"));
    await user.click(screen.getByTestId("taxonomy-remove-confirm-leaf"));

    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/admin/taxonomy/leaf"),
    );
  });

  it("puts the question away when the answer is no", async () => {
    const user = userEvent.setup();
    mount([node({ id: "leaf" })]);

    await user.click(screen.getByTestId("taxonomy-node-leaf"));
    await user.click(screen.getByTestId("taxonomy-remove-leaf"));
    await user.click(screen.getByTestId("taxonomy-remove-cancel-leaf"));

    expect(screen.queryByText(LABELS.confirmRemove)).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it("turns one off without removing it", async () => {
    const user = userEvent.setup();
    mount([node({ id: "root", isActive: true })]);

    await user.click(screen.getByTestId("taxonomy-node-root"));
    await user.click(screen.getByTestId("taxonomy-toggle-root"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/admin/taxonomy/root/toggle"),
    );
    expect(del).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Why a removal is not offered
// =====================================================================
describe("what stops a removal", () => {
  /**
   * THE RULE STAYS; THE SENTENCE GOES.
   *
   * «الغِ كلمة يحتوي ٥ فروع… ومرتبط بواحد منتج، هذا تكرار البيانات
   *  مكتوبة.» The reason is on the screen already: the branches are
   * listed in the next column and the product count is in the band.
   * What is refused is still refused — by the server, and by the
   * absence of the control.
   */
  it("draws no delete for a category holding branches", async () => {
    const user = userEvent.setup();
    mount([
      node({ id: "root", childCount: 2 }),
      node({ id: "a", parentId: "root", depth: 2 }),
      node({ id: "b", parentId: "root", depth: 2 }),
    ]);

    await user.click(screen.getByTestId("taxonomy-node-root"));

    expect(screen.queryByTestId("taxonomy-remove-root")).toBeNull();
    expect(screen.queryByTestId("taxonomy-blocked-root")).toBeNull();
  });

  it("draws no delete for a category holding products", async () => {
    const user = userEvent.setup();
    mount([node({ id: "leaf", productCount: 7 })]);

    await user.click(screen.getByTestId("taxonomy-node-leaf"));

    expect(screen.queryByTestId("taxonomy-remove-leaf")).toBeNull();
    expect(screen.queryByTestId("taxonomy-blocked-leaf")).toBeNull();
  });

  it("draws one for a category nothing points at", async () => {
    const user = userEvent.setup();
    mount([node({ id: "free" })]);

    await user.click(screen.getByTestId("taxonomy-node-free"));

    expect(screen.getByTestId("taxonomy-remove-free")).toBeTruthy();
  });
});
describe("its own place in the console", () => {
  it("is a page of its own, not a section of the reference data", () => {
    const nav = read("components/admin/control-panel-nav.ts");
    expect(nav).toContain('key: "taxonomy", segment: "taxonomy"');
  });

  it("left the reference-data page behind", () => {
    const catalogue = read("app/[locale]/admin/catalogue/page.tsx");
    expect(catalogue).not.toContain('basePath="/admin/taxonomy"');
    expect(catalogue).not.toContain("loadAdminTaxonomy");
  });

  it("is named «إدارة التصنيفات» in the sidebar", () => {
    expect(messages.admin.nav.taxonomy).toBe("إدارة التصنيفات");
  });
});

/**
 * MOVING A BRANCH.
 *
 * `POST /admin/taxonomy/:id/move` existed from the day it was written
 * with nothing anywhere that could call it. A category filed under the
 * wrong parent could only be deleted and rebuilt — and deleting is
 * refused while any product or child still points at it, so the shape of
 * the tree could not be corrected at all.
 *
 * WHAT IS PINNED HERE is that the destination list obeys the SERVICE'S
 * OWN RULES, not a looser browser version of them. The service refuses a
 * cycle, a self-parent and a subtree that would not fit; every one of
 * those must be absent from the list rather than offered and rejected.
 */
// =====================================================================
// Moving and ordering, by dragging
// =====================================================================
describe("dragging a category", () => {
  /**
   *   أدوات (1)
   *     ├ يدوية (2)
   *     │   └ مفكات (3)
   *     └ كهربائية (2)
   *   مواد بناء (1)
   */
  const TREE = [
    node({ id: "tools", nameAr: "أدوات", depth: 1, childCount: 2 }),
    node({
      id: "hand",
      nameAr: "يدوية",
      parentId: "tools",
      depth: 2,
      childCount: 1,
      sortOrder: 0,
    }),
    node({ id: "drivers", nameAr: "مفكات", parentId: "hand", depth: 3 }),
    node({
      id: "power",
      nameAr: "كهربائية",
      parentId: "tools",
      depth: 2,
      sortOrder: 1,
    }),
    node({ id: "materials", nameAr: "مواد بناء", depth: 1 }),
  ];

  function reveal(id: string) {
    const path: string[] = [];
    let current = TREE.find((entry) => entry.id === id);
    while (current) {
      path.unshift(current.id);
      const parentId: string | null = current.parentId;
      current = parentId ? TREE.find((e) => e.id === parentId) : undefined;
    }
    for (const step of path) {
      fireEvent.click(screen.getByTestId(`taxonomy-node-${step}`));
    }
  }

  /**
   * A DRAG, AS THE BROWSER DELIVERS IT.
   *
   * `document.elementFromPoint` is not implemented in jsdom — it
   * answers null for every coordinate — so the one thing the gesture
   * asks the DOM is stubbed here, and only that. Everything else is
   * the real component: the six-pixel threshold, the top-third rule,
   * the depth checks and the writes.
   */
  function drag(
    sourceId: string,
    targetTestId: string,
    where: "on" | "before" | "root",
  ) {
    const source = screen.getByTestId(`taxonomy-node-${sourceId}`);
    const target = screen.getByTestId(targetTestId);

    const box = target.closest("[data-drop-id]") as HTMLElement;
    box.getBoundingClientRect = () =>
      ({ top: 100, height: 40, left: 0, width: 200 }) as DOMRect;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => target;

    // MOUSE EVENTS CARRYING THE COORDINATES. jsdom has no
    // `PointerEvent`, and the fallback testing-library builds for a
    // pointer event drops `clientX` entirely — so the threshold would
    // read NaN and the drag would never start. A `MouseEvent` typed
    // `pointermove` is the same thing to a listener and carries the
    // numbers the gesture is made of.
    const at = (type: string, x: number, y: number) =>
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });

    fireEvent(source, at("pointerdown", 0, 0));
    window.dispatchEvent(at("pointermove", 50, where === "before" ? 105 : 130));
    window.dispatchEvent(at("pointerup", 50, 130));

    document.elementFromPoint = original;
  }

  beforeEach(() => {
    post.mockReset().mockResolvedValue({});
    patch.mockReset().mockResolvedValue({});
  });

  it("files a branch under the category it is dropped on", async () => {
    // «اضغط عليه واسحبه فوق التصنيف» — the middle of a row means
    // «inside this one».
    mount(TREE);
    reveal("power");
    drag("power", "taxonomy-node-materials", "on");

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe("/admin/taxonomy/power/move");
    expect(post.mock.calls[0][1]).toEqual({ newParentId: "materials" });
  });

  it("reorders siblings when it is dropped between them", async () => {
    // The top third of a row means «before this one», and among its
    // own siblings that is an ORDER, not a move.
    mount(TREE);
    reveal("power");
    drag("power", "taxonomy-node-hand", "before");

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(post).not.toHaveBeenCalled();
    // «كهربائية» takes position 0 and «يدوية» is pushed to 1.
    expect(patch.mock.calls[0][0]).toBe("/admin/taxonomy/power");
    expect(patch.mock.calls[0][1]).toEqual({ sortOrder: 0 });
    expect(patch.mock.calls[1][0]).toBe("/admin/taxonomy/hand");
    expect(patch.mock.calls[1][1]).toEqual({ sortOrder: 1 });
  });

  it("makes it a main category again when dropped on the first column's foot", async () => {
    // A main category has no parent row to drop onto, so the way back
    // up would otherwise have no gesture at all.
    mount(TREE);
    reveal("power");
    drag("power", "taxonomy-drop-root", "root");

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe("/admin/taxonomy/power/move");
    // `@IsOptional() @IsUUID()` — an empty string is not a uuid, so the
    // key must be absent rather than blank.
    expect(post.mock.calls[0][1]).toEqual({});
  });

  it("refuses a drop inside the branch being dragged", async () => {
    // THE CYCLE. Putting a branch under its own child is the one move
    // that would corrupt the tree, and the service answers
    // TAXONOMY_CYCLE_DETECTED for it — so the screen never offers it.
    mount(TREE);
    reveal("drivers");
    drag("hand", "taxonomy-node-drivers", "on");

    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("refuses a drop that would not fit the depth", async () => {
    // «يدوية» is two levels tall, so a level-2 parent cannot hold it
    // even though the node alone would land at 3.
    mount(TREE);
    reveal("power");
    drag("hand", "taxonomy-node-power", "on");

    expect(post).not.toHaveBeenCalled();
  });

  it("a tap is not a drag: it chooses the row and writes nothing", () => {
    // Below six pixels it is a press, and a press still opens the next
    // column — otherwise every selection would risk moving something.
    mount(TREE);
    const row = screen.getByTestId("taxonomy-node-tools");
    fireEvent.pointerDown(row, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 2, clientY: 2 });
    fireEvent.pointerUp(window);
    fireEvent.click(row);

    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByTestId("taxonomy-node-hand")).toBeTruthy();
  });
});
