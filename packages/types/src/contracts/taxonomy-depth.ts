/**
 * HOW DEEP A CATEGORY TREE MAY GO.
 *
 * A main category, and two levels of branches beneath it. Three levels
 * in total, counting the root as the first.
 *
 *     الإلكترونيات            ← 1, the main category
 *       └ الهواتف             ← 2
 *           └ هواتف ذكية      ← 3, the deepest a branch may sit
 *
 * WHY A LIMIT AT ALL. There was none, and a tree with no floor is one
 * nobody can navigate: a supplier choosing where a product belongs
 * scrolls a list whose shape changes every time somebody adds a level,
 * and a buyer filtering by category meets a menu that opens onto
 * another menu. Three levels is what the catalogue is designed around
 * and what every screen that draws it assumes.
 *
 * DEPTH IS COUNTED FROM ONE, so the number reads the way a person says
 * it: a root category is at depth 1, and 3 is the deepest allowed.
 */
export const TAXONOMY_MAX_DEPTH = 3;

/** How deep a node would sit under a parent at `parentDepth`. */
export function depthUnder(parentDepth: number | null): number {
  return parentDepth === null ? 1 : parentDepth + 1;
}

/** Whether a node may be placed under a parent sitting at `parentDepth`. */
export function canNestUnder(parentDepth: number | null): boolean {
  return depthUnder(parentDepth) <= TAXONOMY_MAX_DEPTH;
}

/**
 * Whether a subtree of `height` levels fits under a parent.
 *
 * MOVING IS NOT PLACING. A node dragged under a new parent brings its
 * children with it, so the check is on the whole subtree: a two-level
 * branch cannot go under a level-2 parent even though the node itself
 * would land at 3.
 *
 * `height` is 1 for a leaf, 2 for a node with children, and so on.
 */
export function subtreeFitsUnder(
  parentDepth: number | null,
  height: number
): boolean {
  return depthUnder(parentDepth) + height - 1 <= TAXONOMY_MAX_DEPTH;
}
