import { LayoutDashboard } from "lucide-react";
import type { PortalNavMap } from "@/components/portal/portal-nav";

/**
 * WHAT IS IN THE VISITOR'S FRONT, AND WHERE IT SITS.
 *
 * ONE TAB — «في واجهة الزائر احتفظ بلسان الرئيسية فقط».
 *
 * THE MARKET LOST ITS TAB AND KEPT ITS PAGE. The owner found the
 * duplication himself: «عرض الكل» in the market tab's own strip points
 * at `{basePath}/opportunities`, which is the very address the tab
 * opened — so the tab and the link in its strip were two doors onto one
 * room. The link is the one that survives, because it sits among the
 * categories that lead to the same list filtered.
 *
 * SO THE ROW IS NO LONGER A "YOU ARE HERE". One tab cannot say which of
 * several you are on; what it says is whose platform this is. It stays
 * lit wherever a visitor stands — see `FolderTabNav` — because a row of
 * one, unlit, is a row saying nothing.
 *
 * The former note, on why there were two and not five:
 * The public site has more pages than these two — the policies, the
 * FAQ, the contact form — and every one of them is reached from the
 * footer, which is where a visitor looks for them. A tab is for
 * somewhere you go repeatedly, and nobody reads the privacy policy
 * twice.
 *
 * THE GROUP IS A FORMALITY. `PortalNavMap` wants its pages inside one,
 * and `FolderTabNav` draws the pages and never the group — «لا أحتاج
 * إطارات منبثقة». The name is here because the type asks for a key, not
 * because anything renders it.
 *
 * ONLY ROUTES THAT EXIST: `/{locale}` and `/{locale}/opportunities` are
 * both served from `app/[locale]/(public)`, and a route group adds no
 * path segment.
 */
export const VISITOR_PORTAL_MAP: PortalNavMap = {
  root: "",
  home: {
    key: "home",
    segment: "",
    icon: LayoutDashboard,
    // The market kept its page and lost its tab; this is the tab a
    // reader standing on it is under.
    covers: ["opportunities"],
  },
  groups: [],
};
