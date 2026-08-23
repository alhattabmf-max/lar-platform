/**
 * Trader portal navigation.
 *
 * The renderer moved to `portal-nav.tsx` in 8E.3, when the supplier
 * portal needed the same one. It is re-exported under the trader's
 * name rather than duplicated: two copies of a nav that must agree on
 * coming-soon handling, badges and wrapping would be free to drift,
 * and the drift would show up as one portal quietly 404-ing on an
 * unbuilt destination while the other did not.
 *
 * The trader's own destination list stays in
 * `app/[locale]/trader/layout.tsx`, where it has always been.
 */
export {
  PortalNav as TraderNav,
  type PortalNavItem as TraderNavItem,
  type PortalNavProps as TraderNavProps,
} from "./portal-nav";
