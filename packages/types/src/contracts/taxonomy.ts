/**
 * Public taxonomy contract.
 *
 * The wire shape is a FLAT array, not a tree. Each node carries its own
 * `parentId`, so a consumer can rebuild the hierarchy; the server does
 * not nest it, because the same flat list serves both a hierarchical
 * picker and a straight id→name lookup.
 *
 * Two properties of the endpoint are load-bearing for any consumer and
 * are documented here rather than rediscovered:
 *
 *  1. `isActive` is filtered PER NODE, not cascaded. An active child of
 *     a deactivated parent is still returned, and its `parentId` will
 *     then point at a node that is absent from the array. Such a node
 *     is NOT invalid — products may still be attached to it and
 *     filtering by it still works — so a consumer must render it rather
 *     than discard it.
 *
 *  2. Ordering is a single global `sortOrder ASC, createdAt ASC`, not a
 *     per-level ordering. Grouping by `parentId` preserves the relative
 *     order of siblings, so a consumer rebuilding the tree gets correct
 *     sibling order for free — but must not assume the flat sequence is
 *     already a depth-first walk.
 */
export interface TaxonomyNodeItem {
  id: string;
  /** Null at the root. May reference a node absent from the list — see note 1 above. */
  parentId: string | null;
  nameAr: string;
  nameEn: string;
  iconUrl: string | null;
  sortOrder: number;
}

export const TAXONOMY_NODE_ITEM_KEYS = [
  "id",
  "parentId",
  "nameAr",
  "nameEn",
  "iconUrl",
  "sortOrder",
] as const satisfies readonly (keyof TaxonomyNodeItem)[];

/**
 * Whether filtering listings by a taxonomy node also matches that
 * node's DESCENDANTS.
 *
 * IT DOES, AND IT HAS TO. Its neighbour below now refuses to file a
 * product under a node that has children, so everything a buyer could
 * want lives on a leaf. Equality matching would then make the category
 * bar's every parent — «مواد البناء», «أغذية ومشروبات» — return an
 * empty page, because nothing is filed directly on them any more. The
 * two constants are one decision written twice; flipping either alone
 * breaks the platform.
 *
 * `OpportunityDiscoveryService` resolves the selected node's subtree
 * (bounded by `TAXONOMY_MAX_DEPTH`) and matches the frozen approval
 * snapshot's `taxonomyNodeId` against that set — still the snapshot,
 * never the live product, so a later category change cannot alter what
 * an already-published listing is findable under.
 */
export const TAXONOMY_FILTER_INCLUDES_DESCENDANTS = true;

/**
 * Whether a product may be filed under an intermediate (non-leaf) node.
 *
 * IT MAY NOT — the owner's rule: «التصنيف إجباري، واختيار الفرع إجباري
 * إذا كان للتصنيف فروع». A node with active children is a signpost, not
 * a shelf: filing under «أدوات» tells a buyer nothing that «أدوات ←
 * مفكات» does not tell them better, and it is the supplier who knows
 * which branch is right.
 *
 * Enforced where products are written, not only in the form — a rule
 * that lives in a component is a rule the next form forgets.
 *
 * ITS CONSEQUENCE IS THE CONSTANT ABOVE: with nothing on a parent, a
 * parent filter must reach the leaves or return nothing.
 */
export const TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS = false;
