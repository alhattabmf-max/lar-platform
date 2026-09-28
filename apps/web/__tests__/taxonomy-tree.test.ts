import { describe, expect, it } from "vitest";
import type { TaxonomyNodeItem } from "@platform/types";
import {
  TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS,
  TAXONOMY_FILTER_INCLUDES_DESCENDANTS,
} from "@platform/types";
import { buildTaxonomyOptions, findTaxonomyOption } from "@/lib/taxonomy-tree";

/**
 * These tests encode what the REAL endpoint returns, verified against
 * TaxonomyService.listActive and OpportunityDiscoveryService.buildQuery:
 * a flat array carrying `parentId`, filtered per node (so orphans are
 * possible), with filtering by exact match and no leaf-only rule.
 */

function node(
  id: string,
  parentId: string | null,
  nameEn: string,
  sortOrder = 0
): TaxonomyNodeItem {
  return { id, parentId, nameAr: `${nameEn}-ar`, nameEn, iconUrl: null, sortOrder };
}

describe("hierarchy reconstruction from the flat response", () => {
  it("nests children under their parent in depth-first order", () => {
    const options = buildTaxonomyOptions(
      [node("food", null, "Food"), node("dairy", "food", "Dairy"), node("milk", "dairy", "Milk")],
      "en-SA"
    );

    expect(options.map((o) => o.id)).toEqual(["food", "dairy", "milk"]);
    expect(options.map((o) => o.depth)).toEqual([0, 1, 2]);
  });

  it("builds the full path as the label, so a flat select still reads as a hierarchy", () => {
    const options = buildTaxonomyOptions(
      [node("food", null, "Food"), node("dairy", "food", "Dairy"), node("milk", "dairy", "Milk")],
      "en-SA"
    );

    expect(options[2].path).toBe("Food › Dairy › Milk");
    expect(options[2].name).toBe("Milk");
  });

  it("interleaves separate root trees without mixing their children", () => {
    const options = buildTaxonomyOptions(
      [
        node("food", null, "Food"),
        node("tools", null, "Tools"),
        node("dairy", "food", "Dairy"),
        node("drills", "tools", "Drills"),
      ],
      "en-SA"
    );

    expect(options.map((o) => o.id)).toEqual(["food", "dairy", "tools", "drills"]);
  });

  it("preserves the server's sibling order rather than re-sorting", () => {
    // The endpoint orders globally by sortOrder then createdAt; grouping
    // by parent must not disturb the relative order of siblings.
    const options = buildTaxonomyOptions(
      [
        node("root", null, "Root"),
        node("b", "root", "Beta", 1),
        node("a", "root", "Alpha", 2),
      ],
      "en-SA"
    );

    expect(options.map((o) => o.id)).toEqual(["root", "b", "a"]);
  });

  it("uses the Arabic names for the Arabic locale", () => {
    const options = buildTaxonomyOptions(
      [node("food", null, "Food"), node("dairy", "food", "Dairy")],
      "ar-SA"
    );

    expect(options[1].path).toBe("Food-ar › Dairy-ar");
  });
});

describe("orphans — an active child of a deactivated parent", () => {
  const ORPHANED = [node("dairy", "food", "Dairy"), node("tools", null, "Tools")];

  it("keeps the node instead of discarding it", () => {
    const options = buildTaxonomyOptions(ORPHANED, "en-SA");

    expect(options.map((o) => o.id)).toContain("dairy");
  });

  it("treats it as a root, since its parent is not in the list", () => {
    const options = buildTaxonomyOptions(ORPHANED, "en-SA");

    const orphan = options.find((o) => o.id === "dairy")!;
    expect(orphan.depth).toBe(0);
    expect(orphan.path).toBe("Dairy");
  });

  it("never invents a path segment for the missing parent", () => {
    const options = buildTaxonomyOptions(ORPHANED, "en-SA");

    expect(options.find((o) => o.id === "dairy")!.path).not.toContain("›");
  });
});

describe("malformed data cannot hang or silently drop a category", () => {
  it("terminates on a two-node cycle", () => {
    const options = buildTaxonomyOptions(
      [node("a", "b", "A"), node("b", "a", "B")],
      "en-SA"
    );

    expect(options).toHaveLength(2);
  });

  it("terminates on a self-referencing node", () => {
    const options = buildTaxonomyOptions([node("a", "a", "A")], "en-SA");

    expect(options.map((o) => o.id)).toEqual(["a"]);
  });

  it("emits every input node exactly once, cycle or not", () => {
    const nodes = [
      node("root", null, "Root"),
      node("child", "root", "Child"),
      node("x", "y", "X"),
      node("y", "x", "Y"),
    ];

    const options = buildTaxonomyOptions(nodes, "en-SA");

    expect(options).toHaveLength(nodes.length);
    expect(new Set(options.map((o) => o.id)).size).toBe(nodes.length);
  });

  it("returns an empty list for an empty response without throwing", () => {
    expect(buildTaxonomyOptions([], "en-SA")).toEqual([]);
  });

  it("handles a deep chain without blowing the option list up", () => {
    const nodes = Array.from({ length: 50 }, (_, i) =>
      node(`n${i}`, i === 0 ? null : `n${i - 1}`, `N${i}`)
    );

    const options = buildTaxonomyOptions(nodes, "en-SA");

    expect(options).toHaveLength(50);
    expect(options[49].depth).toBe(49);
  });
});

describe("every active node is selectable", () => {
  it("STILL offers parents, for the opposite reason it used to", () => {
    // It used to offer them because a product could be filed on one.
    // A product cannot any more — and that is exactly why a parent has
    // to stay selectable HERE: this builds the BUYER'S filter, and the
    // filter now reaches the whole subtree. Removing parents would take
    // «مواد البناء» out of the category bar, which is the one place a
    // buyer starts from.
    expect(TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS).toBe(false);
    expect(TAXONOMY_FILTER_INCLUDES_DESCENDANTS).toBe(true);

    const options = buildTaxonomyOptions(
      [node("food", null, "Food"), node("dairy", "food", "Dairy")],
      "en-SA"
    );

    expect(options.map((o) => o.id)).toEqual(["food", "dairy"]);
  });

  it("leaves the leaf-only rule to the SUPPLIER'S form, where it belongs", () => {
    // Two different questions that used to have one answer: what a
    // buyer may filter by, and what a supplier may file under. The
    // filter is wide; the form is narrow. This module answers only the
    // first, and the API refuses the second regardless of any form.
    expect(TAXONOMY_FILTER_INCLUDES_DESCENDANTS).toBe(true);
  });
});

describe("resolving a selected id back to a name", () => {
  const OPTIONS = buildTaxonomyOptions(
    [node("food", null, "Food"), node("dairy", "food", "Dairy")],
    "en-SA"
  );

  it("finds the option so the active filter can be named", () => {
    expect(findTaxonomyOption(OPTIONS, "dairy")?.path).toBe("Food › Dairy");
  });

  it("returns null for an id that is not in the list", () => {
    expect(findTaxonomyOption(OPTIONS, "missing")).toBeNull();
  });

  it("returns null when nothing is selected", () => {
    expect(findTaxonomyOption(OPTIONS, undefined)).toBeNull();
  });
});
