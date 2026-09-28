import type { TaxonomyNodeItem } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import type { CategoryNavItem } from "./category-nav";

/**
 * WHICH CATEGORIES THE PUBLIC BAR SHOWS, and in what order.
 *
 * Lifted out of `header.tsx` when the top bar became one component
 * shared by the whole platform: this is a public-navigation rule and
 * has nothing to do with a bar the console also renders. Nothing about
 * it changed — the same function, the same order, the same fallback.
 */
/**
 * The categories to show, and their order.
 *
 * WHICH categories and IN WHAT ORDER is an administrator's choice: when
 * `headerNav` is configured it wins outright, including its order. That
 * setting is the whole point of the admin content screen, and replacing
 * it with "every root, sorted" would quietly delete a feature an
 * operator can see.
 *
 * Its children come from the TAXONOMY, because `headerNav` stores ids
 * and nothing else — no names and no destinations — so the submenu is
 * read from the live tree rather than from anything anyone typed.
 *
 * With nothing configured this falls back to every active root in
 * `sortOrder`, which is also an administrator's setting. Either way the
 * bar has categories rather than being empty on a fresh install.
 *
 * `parentId` may reference a node absent from the list — the API drops
 * inactive nodes without re-parenting their children — so a child whose
 * parent is missing is skipped rather than promoted to a root it never
 * belonged to.
 *
 * AND IT GOES ALL THE WAY DOWN — «حطّيت تصنيفًا فرعيًّا لفرع، وعند
 * الضغط عليه في صفحة الزائر ما انبثق منه الفرع الفرعي».
 *
 * IT BUILT ONE LEVEL. The platform allows three — `TAXONOMY_MAX_DEPTH`
 * is 3, the console manages three, and the server serves three — and
 * this mapped a root's children and stopped. A third-level category
 * therefore existed everywhere except the one place a buyer could
 * reach it, whichever branch it was filed under.
 *
 * RECURSION, NOT A SECOND HAND-WRITTEN LEVEL, so a fourth would need
 * nothing here if the depth limit ever moved: the shape is the tree's,
 * and the limit stays the server's alone.
 */
export function buildCategoryTree(
  nodes: readonly TaxonomyNodeItem[],
  configuredIds: readonly string[],
  locale: AppLocale,
  hrefFor: (id: string) => string,
): CategoryNavItem[] {
  const label = (node: TaxonomyNodeItem) =>
    locale.startsWith("ar") ? node.nameAr : node.nameEn;
  const bySortOrder = (a: TaxonomyNodeItem, b: TaxonomyNodeItem) =>
    a.sortOrder - b.sortOrder || label(a).localeCompare(label(b));

  const byId = new Map(nodes.map((node) => [node.id, node]));

  const roots =
    configuredIds.length > 0
      ? // The operator's list, in the operator's order. An id whose node
        // was retired is dropped: an item that 404s is worse than one
        // that is gone.
        configuredIds
          .map((id) => byId.get(id))
          .filter((node): node is TaxonomyNodeItem => node !== undefined)
      : nodes.filter((node) => node.parentId === null).sort(bySortOrder);

  const branchesOf = (parentId: string): CategoryNavItem[] =>
    nodes
      .filter((node) => node.parentId === parentId)
      .sort(bySortOrder)
      .map((child) => ({
        id: child.id,
        label: label(child),
        href: hrefFor(child.id),
        children: branchesOf(child.id),
      }));

  return roots.map((root) => ({
    id: root.id,
    label: label(root),
    href: hrefFor(root.id),
    children: branchesOf(root.id),
  }));
}
