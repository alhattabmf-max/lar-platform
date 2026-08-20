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
 * Whether filtering opportunities by a taxonomy node also matches that
 * node's DESCENDANTS.
 *
 * It does not. `OpportunityDiscoveryService` compares the selected id
 * against the frozen approval snapshot's own `taxonomyNodeId` with
 * equality, so selecting a parent returns only opportunities filed
 * directly under that parent.
 *
 * This constant exists so the UI cannot quietly imply otherwise: any
 * surface offering the filter must read it and say plainly which
 * behaviour applies. If descendant matching is ever implemented, this
 * flips here and every consumer's copy follows.
 */
export const TAXONOMY_FILTER_INCLUDES_DESCENDANTS = false;

/**
 * Whether a product may be filed under an intermediate (non-leaf) node.
 *
 * It may. Product creation validates only that the node exists and is
 * active — there is no leaf-only rule — so every active node is a
 * legitimate filter target and none may be made unselectable.
 */
export const TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS = true;
