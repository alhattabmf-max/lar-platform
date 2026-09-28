import type { TaxonomyNodeItem } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized } from "./localized";

/**
 * Turns the FLAT taxonomy response into an ordered, hierarchical list of
 * pickable options.
 *
 * The endpoint returns every active node with its `parentId`, ordered by
 * a single global `sortOrder ASC, createdAt ASC`. That global order is
 * not a depth-first walk, but it does put siblings in the right relative
 * order — so grouping by parent and walking depth-first reproduces the
 * intended hierarchy exactly, with no extra sort.
 *
 * Three properties of the real data drive the rules below:
 *
 *  1. ORPHANS ARE REAL. `isActive` is filtered per node, not cascaded,
 *     so an active child of a deactivated parent comes back with a
 *     `parentId` that is absent from the list. Dropping it would hide a
 *     category that still has products and still filters correctly, so
 *     an unresolvable parent is treated as a root.
 *
 *  2. EVERY NODE IS SELECTABLE. Product creation validates only that a
 *     node exists and is active — there is no leaf-only rule — so a
 *     parent may legitimately hold products directly, and making
 *     parents unselectable would make those products unreachable.
 *
 *  3. NOTHING MAY BE SILENTLY LOST. The admin API rejects cycles, but
 *     this function does not rely on that: a cycle would make its nodes
 *     unreachable from any root, so anything still unvisited after the
 *     walk is appended at the top level. The list stays complete even
 *     if the data is not well-formed.
 */
export interface TaxonomyOption {
  id: string;
  /**
   * The node above it, or null at a root.
   *
   * CARRIED SO THE FILTER CAN BE TWO CHOOSERS. A flat list with a path
   * string reads as a hierarchy inside one <select>; splitting it into
   * a category and its branch needs to know which nodes are roots and
   * which belong to the root a reader has chosen.
   */
  parentId: string | null;
  /** 0 at the root. */
  depth: number;
  /** Own name in the active locale. */
  name: string;
  /**
   * Ancestors + own name, e.g. "Food › Dairy › Milk".
   *
   * A flat `<select>` cannot nest, and indentation with spaces is
   * invisible to a screen reader, so the full path IS the label. The
   * separator is U+203A, which is bidi-mirrored — it renders pointing
   * left in Arabic without any special handling.
   */
  path: string;
}

const PATH_SEPARATOR = " › ";

export function buildTaxonomyOptions(
  nodes: readonly TaxonomyNodeItem[],
  locale: AppLocale
): TaxonomyOption[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const childrenOf = new Map<string, TaxonomyNodeItem[]>();
  const roots: TaxonomyNodeItem[] = [];

  for (const node of nodes) {
    // An unresolvable parent makes this a root — see rule 1.
    const parentExists = node.parentId !== null && byId.has(node.parentId);
    if (!parentExists) {
      roots.push(node);
      continue;
    }
    const siblings = childrenOf.get(node.parentId as string);
    if (siblings) siblings.push(node);
    else childrenOf.set(node.parentId as string, [node]);
  }

  const options: TaxonomyOption[] = [];
  const visited = new Set<string>();

  function walk(node: TaxonomyNodeItem, depth: number, ancestors: readonly string[]): void {
    // Guards against a malformed cycle rather than trusting the admin
    // API's cycle check to be the only defence.
    if (visited.has(node.id)) return;
    visited.add(node.id);

    const name = localized(locale, node.nameAr, node.nameEn);
    const trail = [...ancestors, name];

    options.push({
      id: node.id,
      parentId: byId.has(node.parentId ?? "") ? node.parentId : null,
      depth,
      name,
      path: trail.join(PATH_SEPARATOR),
    });

    for (const child of childrenOf.get(node.id) ?? []) {
      walk(child, depth + 1, trail);
    }
  }

  for (const root of roots) walk(root, 0, []);

  // Rule 3: anything a cycle made unreachable still gets an entry.
  for (const node of nodes) {
    if (!visited.has(node.id)) walk(node, 0, []);
  }

  return options;
}

/** Resolves a selected id back to its option, so the UI can name the active filter. */
export function findTaxonomyOption(
  options: readonly TaxonomyOption[],
  id: string | undefined
): TaxonomyOption | null {
  if (!id) return null;
  return options.find((option) => option.id === id) ?? null;
}
