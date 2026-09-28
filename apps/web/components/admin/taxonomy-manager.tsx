"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { AdminTaxonomyNodeItem } from "@platform/types";
import { canNestUnder, subtreeFitsUnder } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * The catalogue's categories, as ONE TREE.
 *
 * «صفحة التصنيفات حقولها مرتفعة جدًّا، وأحسّ تصميمها ما هو عصري، ولا
 *  فيه تمييز بين حقل التصنيف الرئيسي وغيره… خلّها نفس التصميم بس عمود
 *  واحد كلّها… خلّ الفروع تختفي تحت التصنيف، وإذا ضغط عليه تنفتح
 *  تحته.»
 *
 * WHAT THE TREE COST BEFORE ANY OF THIS. Every category — root,
 * branch and leaf alike — was the SAME white bordered row: a chevron,
 * the name, a status badge, two counts and four buttons carrying their
 * own words. The only thing separating a main category from one filed
 * under it was twenty-four pixels of indent, and the buttons wrapped
 * to a second line on a narrow window, so a row that should read at a
 * glance stood seventy pixels tall.
 *
 * THE ROWS CARRY NO BUTTONS. The dark band does, and they act on the
 * row that is chosen — one set of controls instead of four per row.
 * That is what takes a row from seventy pixels to twenty-eight, and it
 * is the same arrangement the company record uses: «ارفع الأزرار كلها
 * في الشريط الكحلي الداكن».
 *
 * AND THE LEVELS ARE ONE LIST. They were three columns walked one at
 * a time — which worked, and which the owner then asked to fold into
 * one: every category in a single column, indented by its depth, with
 * its branches kept under it until it is pressed. What is folded is
 * not rendered at all, so a hundred branches cost nothing until they
 * are asked for.
 *
 * THREE LEVELS, BECAUSE THE TREE IS THREE DEEP. `TAXONOMY_MAX_DEPTH`
 * is 3, and «إضافة فرع» is offered only under a row that may still
 * take one — the same rule the server enforces, so a button it would
 * refuse is never drawn.
 *
 * DELETING IS NOT DEACTIVATING, and both are here because they answer
 * different questions. Deactivating hides a category from the people
 * choosing one and keeps every product pointing at it. Deleting takes
 * the row away, and is refused while anything still needs it — the
 * counts are in the row, so the refusal is visible before it happens.
 */
export interface TaxonomyManagerLabels {
  addRoot: string;
  addChild: string;
  edit: string;
  remove: string;
  nameAr: string;
  nameEn: string;
  /** «اعمل عليها رقم» — where this category stands in the strip. */
  sortOrder: string;
  sortOrderHint: string;
  save: string;
  cancel: string;
  empty: string;
  active: string;
  inactive: string;
  activate: string;
  deactivate: string;
  confirmRemove: string;
  depthReached: string;
  /**
   * The foot of the first column, and what dropping there does.
   *
   * The only sentence left on this screen, and it earns its place: a
   * main category has no parent row to be dropped onto, so without it
   * there is no gesture at all for making one.
   */
  moveRoot: string;
  requestIdLabel: string;
  /** — the column's own name, and its table head */
  treeTitle: string;
  products: string;
  state: string;
}

/** What a column is editing, or adding. */
interface RowDraft {
  nameAr: string;
  nameEn: string;
  sortOrder: string;
}

const EMPTY_DRAFT: RowDraft = { nameAr: "", nameEn: "", sortOrder: "0" };

/**
 * ONE COLUMN OF THE CATALOGUE.
 *
 * AT MODULE SCOPE, not inside the manager: a component declared in
 * another component's body is a new component type on every render, so
 * React unmounts and remounts it — and a controlled input that remounts
 * on each keystroke loses focus after the first letter. This screen had
 * exactly that fault once, and «أدوات» arrived as «أ».
 */
function Column({
  title,
  head,
  rows,
  selectedId,
  onSelect,
  emptyLabel,
  labels,
  editingId,
  draft,
  onDraft,
  onSaveEdit,
  onCancelEdit,
  busy,
  arabic,
  testId,
  newRow,
  indent = false,
  expandedIds,
  productTotals,
  newRowAfter = null,
  dragId,
  dropAt,
  onGrab,
  rootsDropZone,
}: {
  title: string;
  /** The buttons that act on this column's selected row. */
  head: ReactNode;
  rows: readonly AdminTaxonomyNodeItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyLabel: string;
  labels: TaxonomyManagerLabels;
  editingId: string | null;
  draft: RowDraft;
  onDraft: (next: RowDraft) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  busy: boolean;
  /**
   * WHICH NAME TO PRINT, as a flag rather than as a formatter.
   *
   * A function prop is the one shape that cannot cross the server
   * boundary — React refuses to serialise it — so no client component
   * here declares one, even where it is only ever filled by another
   * client component. The rule is cheaper to keep than to reason about
   * case by case.
   */
  arabic: boolean;
  testId: string;
  /** The row being added, when this column is the one adding. */
  newRow: boolean;
  /**
   * WHETHER A ROW STANDS IN FOR ITS DEPTH.
   *
   * «خلّها نفس التصميم بس عمود واحد كلّها.» One column holding the
   * whole tree needs some other way to say what is under what, and
   * indentation is the way a tree has always said it. The depth is
   * on the row itself — no second source, and nothing to keep in
   * step.
   */
  indent?: boolean;
  /**
   * WHICH ROWS ARE OPEN — «خلّ الفروع تختفي تحت التصنيف، وإذا ضغط
   * عليه تنفتح تحته».
   *
   * AN ARRAY, NOT A SET AND NOT A PREDICATE. A function prop cannot
   * cross the server boundary, and a Set does not serialise either; a
   * list of ids is both, and at the size of a category tree the lookup
   * costs nothing.
   */
  expandedIds?: readonly string[];
  /**
   * How many products stand under each category, ITS BRANCHES
   * INCLUDED, by id.
   *
   * A PLAIN OBJECT, for the same reason `expandedIds` is an array: a
   * Map does not cross the server boundary and a function prop cannot
   * either.
   */
  productTotals?: Record<string, number>;
  /**
   * The row the new one is being added AFTER — the last row of its
   * parent's subtree, so the input opens where the category will
   * appear rather than at the foot of everything.
   *
   * `null` means a new MAIN category, which goes at the end.
   */
  newRowAfter?: string | null;
  /** The row being dragged, so it can fade while it travels. */
  dragId: string | null;
  /** Where a drop would land right now. */
  dropAt: { id: string; where: "on" | "before" } | null;
  onGrab: (
    event: React.PointerEvent<HTMLElement>,
    node: AdminTaxonomyNodeItem,
  ) => void;
  /** The first column's foot: drop here to make it a main category. */
  rootsDropZone?: string;
}) {
  // ONE FORM IS OPEN AT A TIME across the whole screen, so its fields
  // are named for what they are DOING rather than for the column they
  // happen to sit in — «taxonomy-edit-ar» means the same thing whether
  // the row being edited is a main category or a leaf.
  const prefix = editingId ? "taxonomy-edit" : "taxonomy-draft";

  const fields = (
    <>
      <Input
        aria-label={labels.nameAr}
        dir="rtl"
        value={draft.nameAr}
        disabled={busy}
        onChange={(event) => onDraft({ ...draft, nameAr: event.target.value })}
        data-testid={`${prefix}-ar`}
      />
      <Input
        aria-label={labels.nameEn}
        dir="ltr"
        value={draft.nameEn}
        disabled={busy}
        onChange={(event) => onDraft({ ...draft, nameEn: event.target.value })}
        data-testid={`${prefix}-en`}
      />
      {/* KEPT AS TEXT WHILE IT IS BEING TYPED. A number input bound to a
          `number` cannot hold an empty box — clearing it to retype gives
          NaN, and the field either snaps back or goes blank and saves
          nothing. The string is what the operator sees; the number is
          what leaves. */}
      <Input
        aria-label={labels.sortOrder}
        dir="ltr"
        inputMode="numeric"
        className="w-16"
        value={draft.sortOrder}
        disabled={busy}
        onChange={(event) =>
          onDraft({ ...draft, sortOrder: event.target.value })
        }
        data-testid={`${prefix}-order`}
      />
      <Button
        type="button"
        size="sm"
        disabled={
          busy || draft.nameAr.trim() === "" || draft.nameEn.trim() === ""
        }
        onClick={onSaveEdit}
        data-testid={`${prefix}-save`}
      >
        {labels.save}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={onCancelEdit}
      >
        {labels.cancel}
      </Button>
    </>
  );

  return (
    <div
      className="flex min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-card"
      data-testid={testId}
    >
      {/* THE DARK BAND, AND EVERY BUTTON IN IT. One set of controls for
          the column, acting on the row it has selected. */}
      <div className="flex flex-wrap items-center gap-2 bg-primary px-card-x py-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-primary-foreground">
          {title}
        </h2>
        <div className="ms-auto flex flex-wrap items-center gap-2">{head}</div>
      </div>

      {rows.length === 0 && !newRow ? (
        <p
          className="px-card-x py-3 text-sm text-content-muted"
          data-testid={`${testId}-empty`}
        >
          {emptyLabel}
        </p>
      ) : (
        <>
          <div className="flex gap-2 border-b border-line bg-[color-mix(in_srgb,var(--color-primary)_7%,var(--color-surface))] px-card-x py-1 text-xs text-content-muted">
            <span className="min-w-0 flex-1">{labels.nameAr}</span>
            <span className="w-10 text-center">{labels.sortOrder}</span>
            <span className="w-12 text-center">{labels.products}</span>
            <span className="w-14">{labels.state}</span>
          </div>

          <ul className="flex list-none flex-col">
            {rows
              .map((node, index) =>
                editingId === node.id ? (
                  <li
                    key={node.id}
                    className="flex flex-wrap items-center gap-2 border-b border-line px-card-x py-1.5 last:border-b-0"
                  >
                    {fields}
                  </li>
                ) : (
                  <li
                    key={node.id}
                    data-drop-id={node.id}
                    className={
                      "relative border-b border-line last:border-b-0 " +
                      (dragId === node.id ? "opacity-40" : "")
                    }
                  >
                    {/* WHERE IT WOULD LAND. A line above the row means
                      «before this one»; a ring around it means «inside
                      it». Two answers, one gesture, and the difference
                      is visible before the finger lifts. */}
                    {dropAt?.id === node.id && dropAt.where === "before" ? (
                      <span
                        aria-hidden
                        className="absolute inset-x-0 top-0 h-0.5 bg-accent"
                      />
                    ) : null}
                    {/* THE ROW IS THE CONTROL. Selecting is what opens the
                      next column, so the whole row answers rather than a
                      chevron the width of a fingertip. */}
                    <button
                      type="button"
                      onClick={() => onSelect(node.id)}
                      onPointerDown={(event) => onGrab(event, node)}
                      aria-current={selectedId === node.id ? "true" : undefined}
                      className={
                        "flex min-h-control w-full touch-none items-center gap-2 px-card-x py-1 text-start text-sm " +
                        (dropAt?.id === node.id && dropAt.where === "on"
                          ? "ring-2 ring-inset ring-accent "
                          : "") +
                        (selectedId === node.id
                          ? "bg-primary text-primary-foreground"
                          : index % 2 === 1
                            ? "bg-[color-mix(in_srgb,var(--color-primary)_7%,var(--color-surface))] text-content"
                            : "bg-surface text-content")
                      }
                      data-testid={`taxonomy-node-${node.id}`}
                      aria-expanded={
                        node.childCount > 0
                          ? expandedIds?.includes(node.id) === true
                          : undefined
                      }
                      style={
                        indent && node.depth > 1
                          ? {
                              paddingInlineStart: `calc(var(--space-card-x, 1rem) + ${
                                (node.depth - 1) * 1.25
                              }rem)`,
                            }
                          : undefined
                      }
                    >
                      {/* THE GRIP SAYS IT CAN BE DRAGGED. The whole row
                        answers to the finger; this is what tells the
                        eye so. */}
                      <GripVertical
                        className="size-3.5 shrink-0 opacity-40"
                        aria-hidden
                      />

                      {/* AND THE CHEVRON SAYS THERE IS SOMETHING UNDER
                        IT. One glyph turned rather than two icons: the
                        rotation IS the state, and when what it points
                        at is closed it points the way the page reads —
                        left in Arabic, right in English.

                        A ROW WITH NO CHILDREN KEEPS THE SPACE. An empty
                        box the width of the chevron is what stops the
                        names sliding back and forth down the list as
                        branches open and close. */}
                      {node.childCount > 0 ? (
                        <ChevronDown
                          className={
                            "size-3.5 shrink-0 opacity-60 transition-transform " +
                            (expandedIds?.includes(node.id)
                              ? ""
                              : arabic
                                ? "rotate-90"
                                : "-rotate-90")
                          }
                          aria-hidden
                        />
                      ) : (
                        <span aria-hidden className="size-3.5 shrink-0" />
                      )}

                      {/* THE MARK OF THE CHOSEN ROW, in the accent the
                        navigation uses for the open page. */}
                      <span
                        aria-hidden
                        className={
                          "h-4 w-[3px] shrink-0 rounded-full " +
                          (selectedId === node.id
                            ? "bg-accent"
                            : "bg-transparent")
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {arabic ? node.nameAr : node.nameEn}
                      </span>
                      <>
                        <span className="w-10 text-center text-xs tabular-nums opacity-80">
                          {node.sortOrder}
                        </span>
                        {/* THE PRODUCTS UNDER IT, BRANCHES INCLUDED —
                              «لماذا لا يظهر في التصنيف الرئيسي عدد
                              المنتجات اللي فيه وفي فروعه».

                              THE ROW'S OWN `productCount` IS THE DIRECT
                              ONE, and a supplier files a product on the
                              deepest category he can — so a main
                              category almost always owned nothing
                              itself and read as zero while hundreds of
                              products sat one level under it. */}
                        <span className="w-12 text-center text-xs tabular-nums opacity-80">
                          {productTotals?.[node.id] ?? node.productCount}
                        </span>
                        <span className="w-14">
                          {selectedId === node.id ? (
                            <span className="text-xs opacity-80">
                              {node.isActive ? labels.active : labels.inactive}
                            </span>
                          ) : (
                            <StatusBadge
                              label={
                                node.isActive ? labels.active : labels.inactive
                              }
                              tone={node.isActive ? "done" : "neutral"}
                            />
                          )}
                        </span>
                      </>
                    </button>
                  </li>
                ),
              )
              .flatMap((row, index) =>
                newRow &&
                newRowAfter !== null &&
                rows[index]?.id === newRowAfter
                  ? [
                      row,
                      <li
                        key="taxonomy-new-row"
                        className="flex flex-wrap items-center gap-2 border-b border-line px-card-x py-1.5"
                        data-testid={`${testId}-new`}
                      >
                        {fields}
                      </li>,
                    ]
                  : [row],
              )}

            {newRow && newRowAfter === null ? (
              <li
                className="flex flex-wrap items-center gap-2 border-t border-line px-card-x py-1.5"
                data-testid={`${testId}-new`}
              >
                {fields}
              </li>
            ) : null}

            {/* THE WAY BACK UP. Dropping a branch on a category files
                it under that category; there would otherwise be no
                gesture for the opposite — making it a main category
                again — because a main category has no parent row to
                drop onto. */}
            {rootsDropZone ? (
              <li
                data-drop-id="__roots__"
                className={
                  "border-t border-dashed border-line-control px-card-x py-2 text-center text-xs " +
                  (dropAt?.id === "__roots__"
                    ? "bg-[color-mix(in_srgb,var(--color-accent)_16%,var(--color-surface))] text-content"
                    : "text-content-muted")
                }
                data-testid="taxonomy-drop-root"
              >
                {rootsDropZone}
              </li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  );
}

export function TaxonomyManager({
  nodes,
  labels,
  locale,
}: {
  nodes: readonly AdminTaxonomyNodeItem[];
  labels: TaxonomyManagerLabels;
  locale: string;
}) {
  const router = useRouter();
  const root = useTranslations();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  /**
   * WHICH ROW IS CHOSEN — one, for the whole tree.
   *
   * IT WAS THREE, one per column, when the tree was walked column by
   * column. «خلّها نفس التصميم بس عمود واحد كلّها»: with every level
   * in one list there is no walk to remember, only a row the band is
   * acting on.
   *
   * LOCAL, NOT IN THE ADDRESS — deliberately, and against this
   * console's usual rule. A tab or a filter is a VIEW somebody pastes
   * to a colleague; choosing a row is browsing, and putting it in the
   * history would make Back retrace every category glanced at on the
   * way to the one being edited.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * WHICH CATEGORIES ARE SHOWING WHAT IS UNDER THEM.
   *
   * «خلّ الفروع تختفي تحت التصنيف، وإذا ضغط عليه تنفتح تحته.»
   *
   * CLOSED TO BEGIN WITH. Every level at once was a wall of branches
   * to read past; the main categories are the map, and the rest
   * arrives when it is asked for.
   *
   * ONE PRESS DOES BOTH — it chooses the row AND opens it. They are
   * the same intent («this one»), and splitting them between a chevron
   * the width of a fingertip and the row beside it is two targets for
   * one thought. Pressing a row that is already open closes it.
   */
  const [expandedIds, setExpandedIds] = useState<readonly string[]>([]);

  const expand = (id: string) =>
    setExpandedIds((open) => (open.includes(id) ? open : [...open, id]));

  function chooseRow(id: string) {
    setSelectedId(id);
    setExpandedIds((open) =>
      open.includes(id) ? open.filter((each) => each !== id) : [...open, id],
    );
  }

  /** Which row is being edited, and where a new one is being added. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingUnder, setAddingUnder] = useState<string | null | undefined>(
    undefined,
  );
  const [draft, setDraft] = useState<RowDraft>(EMPTY_DRAFT);

  // WHICH ROW IS ASKING. A native `window.confirm` cannot be
  // translated, ignores the page direction, and a browser may suppress
  // it outright — so the question would simply not appear. The column
  // asks instead, in its own words.
  const [confirming, setConfirming] = useState<string | null>(null);

  const arabic = locale.startsWith("ar");

  /** Children by parent, in the order the server sent them. */
  const childrenOf = useMemo(() => {
    const index = new Map<string | null, AdminTaxonomyNodeItem[]>();
    for (const node of nodes) {
      const key = node.parentId;
      index.set(key, [...(index.get(key) ?? []), node]);
    }
    return index;
  }, [nodes]);

  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  /**
   * HOW TALL A BRANCH IS, and everything under it.
   *
   * Both are what decides whether a drop is legal, and both are the
   * server's own rules rather than a second opinion: a branch may not
   * land inside itself, and its WHOLE SUBTREE must fit — a branch two
   * levels tall cannot go under a level-2 parent even though the node
   * alone would land at 3.
   */
  const shape = useMemo(() => {
    const heightOf = (id: string): number => {
      const children = childrenOf.get(id) ?? [];
      if (children.length === 0) return 1;
      return 1 + Math.max(...children.map((child) => heightOf(child.id)));
    };
    const descendantsOf = (id: string): Set<string> => {
      const out = new Set<string>();
      const stack = [...(childrenOf.get(id) ?? [])];
      while (stack.length > 0) {
        const child = stack.pop()!;
        out.add(child.id);
        stack.push(...(childrenOf.get(child.id) ?? []));
      }
      return out;
    };
    return { heightOf, descendantsOf };
  }, [childrenOf]);

  /** Whether this category may be filed under that one. */
  const mayNestIn = (
    node: AdminTaxonomyNodeItem,
    parent: AdminTaxonomyNodeItem | null,
  ) => {
    const height = shape.heightOf(node.id);
    if (!parent) {
      return node.parentId !== null && subtreeFitsUnder(null, height);
    }
    if (parent.id === node.id) return false;
    if (parent.id === node.parentId) return false;
    if (shape.descendantsOf(node.id).has(parent.id)) return false;
    return subtreeFitsUnder(parent.depth, height);
  };

  async function run(work: () => Promise<unknown>) {
    // ONE AT A TIME. A second press while the first is in flight would
    // send the same instruction twice.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      setEditingId(null);
      setAddingUnder(undefined);
      setConfirming(null);
      setDraft(EMPTY_DRAFT);
      router.refresh();
    } catch (caught) {
      setError(toUserFacingError(caught));
    } finally {
      setBusy(false);
    }
  }

  /**
   * MOVING AND ORDERING, BY DRAGGING — «ألغِ زر النقل وحقله، وخلّ
   * إعادة ترتيب التصنيفات والفروع عن طريق السحب بالماوس أو باللمس:
   * اضغط عليه واسحبه فوق التصنيف».
   *
   * ONE GESTURE, TWO ANSWERS, decided by WHERE in the target row the
   * finger lets go:
   *
   *   over the MIDDLE of a row  — file it under that category
   *   over the TOP of a row     — put it before that one, in order
   *   over the first column's foot — make it a main category again
   *
   * POINTER EVENTS, NOT HTML5 DRAG-AND-DROP. `dragstart` never fires
   * on a touch screen, so the whole feature would simply not exist on
   * the device it was asked for. Pointer events are one code path for
   * the mouse, the pen and the finger.
   *
   * SIX PIXELS BEFORE IT IS A DRAG. Below that it is a tap, and a tap
   * still chooses the row — otherwise every selection would risk
   * moving something.
   *
   * THE RULES ARE THE SERVER'S. A drop that would be refused is never
   * marked as a target, so the ring under the finger is a promise the
   * server keeps.
   */
  const dragRef = useRef<{
    node: AdminTaxonomyNodeItem;
    x: number;
    y: number;
    started: boolean;
  } | null>(null);
  const dropRef = useRef<{ id: string; where: "on" | "before" } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{
    id: string;
    where: "on" | "before";
  } | null>(null);

  const rowsUnder = (parentId: string | null) => childrenOf.get(parentId) ?? [];

  /**
   * The order the siblings would stand in, and what to write.
   *
   * ONLY THE ROWS THAT MOVED are written: dragging the last category
   * to the front changes every position after it, and dragging it one
   * place changes two. A blanket rewrite would put an audit entry
   * against categories nobody touched.
   */
  function reorderWrites(
    node: AdminTaxonomyNodeItem,
    beforeId: string,
  ): { id: string; sortOrder: number }[] {
    const siblings = rowsUnder(node.parentId).filter(
      (row) => row.id !== node.id,
    );
    const at = siblings.findIndex((row) => row.id === beforeId);
    if (at < 0) return [];
    const next = [...siblings.slice(0, at), node, ...siblings.slice(at)];
    return next
      .map((row, index) => ({ id: row.id, sortOrder: index }))
      .filter((row, index) => next[index].sortOrder !== row.sortOrder);
  }

  function applyDrop(node: AdminTaxonomyNodeItem) {
    const target = dropRef.current;
    if (!target || busy) return;

    if (target.id === "__roots__") {
      if (!mayNestIn(node, null)) return;
      void run(() => apiClient.post(`/admin/taxonomy/${node.id}/move`, {}));
      return;
    }

    const onto = byId.get(target.id);
    if (!onto || onto.id === node.id) return;

    if (target.where === "on") {
      if (!mayNestIn(node, onto)) return;
      // OPEN WHERE IT LANDED, so the branch is where the eye last saw
      // it go rather than folded away inside a closed category.
      expand(onto.id);
      void run(() =>
        apiClient.post(`/admin/taxonomy/${node.id}/move`, {
          newParentId: onto.id,
        }),
      );
      return;
    }

    // BEFORE, among its own siblings, is an ORDER. Before a row with a
    // different parent is still a MOVE — the order it lands in is that
    // parent's business.
    if (onto.parentId === node.parentId) {
      const writes = reorderWrites(node, onto.id);
      if (writes.length === 0) return;
      void run(async () => {
        for (const write of writes) {
          await apiClient.patch(`/admin/taxonomy/${write.id}`, {
            sortOrder: write.sortOrder,
          });
        }
      });
      return;
    }

    const parent = onto.parentId ? (byId.get(onto.parentId) ?? null) : null;
    if (!mayNestIn(node, parent)) return;
    void run(() =>
      apiClient.post(
        `/admin/taxonomy/${node.id}/move`,
        parent ? { newParentId: parent.id } : {},
      ),
    );
  }

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.started) {
        const far =
          Math.abs(event.clientX - drag.x) > 6 ||
          Math.abs(event.clientY - drag.y) > 6;
        if (!far) return;
        drag.started = true;
        setDragId(drag.node.id);
      }
      // The finger is dragging a row, not the page.
      event.preventDefault();

      const under = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-drop-id]") as HTMLElement | null;
      if (!under) {
        dropRef.current = null;
        setDropAt(null);
        return;
      }
      const id = under.dataset.dropId as string;
      if (id === "__roots__") {
        const next = { id, where: "on" as const };
        dropRef.current = next;
        setDropAt(next);
        return;
      }
      const box = under.getBoundingClientRect();
      const next = {
        id,
        where:
          event.clientY - box.top < box.height * 0.35
            ? ("before" as const)
            : ("on" as const),
      };
      dropRef.current = next;
      setDropAt(next);
    }

    function onUp() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.started) applyDrop(drag.node);
      dropRef.current = null;
      setDragId(null);
      setDropAt(null);
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  });

  function onGrab(
    event: React.PointerEvent<HTMLElement>,
    node: AdminTaxonomyNodeItem,
  ) {
    // NEVER WHILE A WRITE IS IN FLIGHT, and never on the right or the
    // middle button — but a finger and a pen report no button at all,
    // so the test is «a button was named AND it was not the first»
    // rather than «the button was the first». The stricter form threw
    // the gesture away on every touch device.
    if (busy) return;
    if (typeof event.button === "number" && event.button > 0) return;
    dragRef.current = {
      node,
      x: event.clientX,
      y: event.clientY,
      started: false,
    };
  }

  function startEdit(node: AdminTaxonomyNodeItem) {
    setAddingUnder(undefined);
    setEditingId(node.id);
    setDraft({
      nameAr: node.nameAr,
      nameEn: node.nameEn,
      sortOrder: String(node.sortOrder),
    });
  }

  function startAdd(parentId: string | null) {
    setEditingId(null);
    setConfirming(null);
    setAddingUnder(parentId);
    setDraft(EMPTY_DRAFT);
    // OPEN WHAT IS BEING ADDED TO. The input opens after the last row
    // of that category's subtree, and a closed category has no rows
    // there — the field would appear somewhere that says nothing about
    // where the new branch is going.
    if (parentId !== null) expand(parentId);
  }

  const orderOf = (value: string) => {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  };

  function saveDraft() {
    if (editingId) {
      void run(() =>
        apiClient.patch(`/admin/taxonomy/${editingId}`, {
          nameAr: draft.nameAr.trim(),
          nameEn: draft.nameEn.trim(),
          sortOrder: orderOf(draft.sortOrder),
        }),
      );
      return;
    }
    void run(() =>
      apiClient.post("/admin/taxonomy", {
        parentId: addingUnder ?? undefined,
        nameAr: draft.nameAr.trim(),
        nameEn: draft.nameEn.trim(),
        sortOrder: orderOf(draft.sortOrder),
      }),
    );
  }

  /**
   * The buttons a column shows for the row it has open.
   *
   * ABSENT, NOT DISABLED, where an action cannot apply: a delete that
   * is refused says WHY in its place, and a move with nowhere to go is
   * not drawn at all. A control that can never work on this row is not
   * a control.
   */
  /**
   * THE BAND CARRIES THE CATEGORY IT IS NAMED AFTER.
   *
   * «أو أن بياناته تكون في الشريط الداكن، والبطاقة الأولى تحمل الاسم
   *  وإضافة تصنيف رئيسي فوق، وباقي الأزرار تنتقل مع التصنيف في
   *  الداكن.»
   *
   * The first column is a list of NAMES and nothing else — «اسم
   * التصنيف الرئيسي غائب» was four sub-columns and five buttons
   * fighting over nineteen rems. What a chosen category IS, and
   * everything that can be done to it, moved one column across, into
   * the band that already says its name.
   *
   * ONE SUBJECT PER BAND, always. The last column's band belongs to
   * its branch until a row in it is chosen, and then it belongs to
   * that row — because a leaf opens no column of its own and would
   * otherwise have nowhere to be acted on. Choosing the branch again
   * hands the band back.
   */
  function addButton(parentId: string | null) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => startAdd(parentId)}
        data-testid={
          parentId === null
            ? "taxonomy-add-root"
            : `taxonomy-add-child-${parentId}`
        }
      >
        <Plus className="size-4" aria-hidden />
        {parentId === null ? labels.addRoot : labels.addChild}
      </Button>
    );
  }

  /** What a chosen category is, and what may be done to it. */
  function subjectFor(node: AdminTaxonomyNodeItem | null) {
    if (!node) return null;

    const blocked = node.childCount > 0 || node.productCount > 0;

    return (
      <>
        {/* WHAT IT IS, in the band rather than in three sub-columns
            of the narrow list. */}
        <span className="text-xs text-primary-foreground opacity-80">
          {labels.sortOrder} {node.sortOrder}
        </span>
        <span className="text-xs text-primary-foreground opacity-80">
          {labels.products} {productTotals[node.id] ?? node.productCount}
        </span>
        <span className="text-xs text-primary-foreground opacity-80">
          {node.isActive ? labels.active : labels.inactive}
        </span>

        {/* ICONS, WITHOUT THEIR WORDS — «استبدل الأزرار بأيقونات ترمز
            لها بدون اسم توضيحي، ما عدا زر إضافة تصنيف وإضافة فرع».

            THE WORD IS STILL THERE for anyone who cannot see the
            drawing: `aria-label` carries it to a screen reader and
            `title` to a pointer that rests. An icon with no name at
            all is a button only its author can use. */}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          aria-label={labels.edit}
          title={labels.edit}
          onClick={() => startEdit(node)}
          data-testid={`taxonomy-edit-${node.id}`}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          aria-label={node.isActive ? labels.deactivate : labels.activate}
          title={node.isActive ? labels.deactivate : labels.activate}
          onClick={() =>
            void run(() => apiClient.post(`/admin/taxonomy/${node.id}/toggle`))
          }
          data-testid={`taxonomy-toggle-${node.id}`}
        >
          {node.isActive ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </Button>

        {/* NO SENTENCE WHERE THE DELETE WOULD BE — «الغِ كلمة يحتوي ٥
            فروع». The rule has not moved: a category holding branches
            or products cannot be removed, and the server refuses on
            the same two counts. What went is the line explaining it,
            because the reason is on the screen already — the branches
            are listed in the next column and the product count is in
            this band. */}
        {blocked ? null : confirming === node.id ? (
          <>
            <span className="text-xs text-primary-foreground">
              {labels.confirmRemove}
            </span>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(() => apiClient.delete(`/admin/taxonomy/${node.id}`))
              }
              data-testid={`taxonomy-remove-confirm-${node.id}`}
            >
              {labels.remove}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setConfirming(null)}
              data-testid={`taxonomy-remove-cancel-${node.id}`}
            >
              {labels.cancel}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={busy}
            aria-label={labels.remove}
            title={labels.remove}
            onClick={() => setConfirming(node.id)}
            data-testid={`taxonomy-remove-${node.id}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        )}
      </>
    );
  }

  /**
   * THE TREE, FLATTENED IN READING ORDER — every category followed
   * by everything under it.
   *
   * THE ORDER IS THE SERVER'S. `childrenOf` keeps the rows in the
   * order they arrived, which is `sortOrder` — so what the list shows
   * is what the strip will show, and a drag that changes one changes
   * the other.
   */
  /**
   * HOW MANY PRODUCTS STAND UNDER EACH CATEGORY, BRANCHES INCLUDED.
   *
   * «لماذا لا يظهر في التصنيف الرئيسي عدد المنتجات اللي فيه وفي فروعه؟»
   *
   * BECAUSE THE ROW'S NUMBER IS THE DIRECT ONE. `productCount` is the
   * count of products filed on THAT category, and a supplier files a
   * product on the deepest category he can reach — so a main category
   * owns almost nothing itself and read as zero with its branches full.
   *
   * THE DIRECT COUNT IS NOT REPLACED, IT IS JOINED. It is the number
   * the delete rule is about: the server refuses to remove a category
   * products point AT, and a rolled-up figure in that position would
   * make the refusal disagree with what the screen says. So the direct
   * count stays where it decides, and the total is what is READ.
   *
   * COUNTED HERE, NOT ASKED FOR. The whole tree is already in hand —
   * a second endpoint would be a round trip for a sum over rows this
   * component is holding.
   */
  const productTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    const sum = (node: AdminTaxonomyNodeItem): number => {
      const own =
        node.productCount +
        (childrenOf.get(node.id) ?? []).reduce(
          (running, child) => running + sum(child),
          0,
        );
      totals[node.id] = own;
      return own;
    };
    for (const root of childrenOf.get(null) ?? []) sum(root);
    return totals;
  }, [childrenOf]);

  const flat = useMemo(() => {
    const out: AdminTaxonomyNodeItem[] = [];
    const walk = (parentId: string | null) => {
      for (const node of childrenOf.get(parentId) ?? []) {
        out.push(node);
        // AND NO FURTHER UNLESS IT IS OPEN. What is not walked is not
        // rendered: the rows under a closed category do not exist on
        // the page rather than being hidden on it, so they cost no
        // layout and a screen reader is not read a tree somebody has
        // folded away.
        if (expandedIds.includes(node.id)) walk(node.id);
      }
    };
    walk(null);
    return out;
  }, [childrenOf, expandedIds]);

  const selectedNode = selectedId ? (byId.get(selectedId) ?? null) : null;

  /**
   * WHERE THE ROW BEING ADDED OPENS — after the last row of its
   * parent's subtree, which is where the category itself will
   * appear once it is saved. A new MAIN category goes at the end,
   * and says so with `null`.
   */
  const newRowAfter = useMemo(() => {
    if (addingUnder === undefined || addingUnder === null) return null;
    const start = flat.findIndex((node) => node.id === addingUnder);
    if (start < 0) return null;
    const parentDepth = flat[start].depth;
    let last = start;
    for (let i = start + 1; i < flat.length; i += 1) {
      if (flat[i].depth <= parentDepth) break;
      last = i;
    }
    return flat[last].id;
  }, [addingUnder, flat]);

  const columnProps = {
    labels,
    busy,
    arabic,
    editingId,
    draft,
    onDraft: setDraft,
    onSaveEdit: saveDraft,
    onCancelEdit: () => {
      setEditingId(null);
      setAddingUnder(undefined);
      setDraft(EMPTY_DRAFT);
    },
    dragId,
    dropAt,
    onGrab,
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-danger bg-surface px-3 py-2"
          data-testid="taxonomy-error"
        >
          <p className="text-sm text-content">{root(error.messageKey)}</p>
          {error.requestId ? (
            <p className="mt-1 text-xs text-content-muted">
              {labels.requestIdLabel}{" "}
              <span className="select-all font-mono">{error.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ONE COLUMN, THE WHOLE TREE — «خلّها نفس التصميم بس عمود
          واحد كلّها».

          THE DESIGN IS THE ONE THAT WAS APPROVED: the same dark
          band with every control in it, the same rows, the same
          icons without words, the same drag. What changed is that
          the levels are no longer three lists side by side to be
          walked one at a time — they are one list, indented, and
          every category on the platform is on the screen at once.

          NOTHING ABOUT THE RULES MOVED. The band still acts on the
          chosen row, a drop still means «before» or «inside», and
          the depth limit is still the server's. */}
      <Column
        {...columnProps}
        title={labels.treeTitle}
        indent
        rootsDropZone={labels.moveRoot}
        testId="taxonomy-column-tree"
        rows={flat}
        selectedId={selectedId}
        onSelect={chooseRow}
        expandedIds={expandedIds}
        productTotals={productTotals}
        emptyLabel={labels.empty}
        newRow={addingUnder !== undefined}
        newRowAfter={newRowAfter}
        head={
          <>
            {subjectFor(selectedNode)}
            {/* ADD A MAIN CATEGORY, always — it belongs to the tree
                rather than to any row in it. ADD A BRANCH, only
                under a chosen row that may still hold one: the
                depth rule is the server's, and a button it would
                refuse is never drawn. */}
            {addButton(null)}
            {selectedNode && canNestUnder(selectedNode.depth)
              ? addButton(selectedNode.id)
              : null}
          </>
        }
      />
      {/* THE LAST LEVEL SAYS SO — about the row that is standing at
          it. There is no «إضافة فرع» in the band for such a row, so
          the sentence is what explains an absence rather than a
          disabled button explaining itself. */}
      {selectedNode && !canNestUnder(selectedNode.depth) ? (
        <p
          className="text-xs text-content-muted"
          data-testid="taxonomy-depth-reached"
        >
          {labels.depthReached}
        </p>
      ) : null}
    </div>
  );
}
