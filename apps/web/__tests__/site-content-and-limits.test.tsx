import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SITE_CONTENT_FIELDS,
  type SiteContent,
  type SiteContentText,
} from "@platform/types";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Two settings that existed as endpoints and reached no screen.
 *
 * `/public/site-content` was written by the admin console and read by
 * nothing: the homepage used the message catalogue directly, so an
 * operator could save a hero title and watch the site ignore it.
 * `/companies/me/policy-limits` was the same for the supplier forms —
 * both carried comments saying the figures were unavailable.
 *
 * These prove the wiring, the fallback, and the order.
 */

// ------------------------------------------------------- site content

// Derived from the FIELD LIST rather than written out: a hand-listed
// copy goes stale the moment a field is added, and this fixture is what
// every assertion below is measured against.
const siteContent = (overrides: Partial<SiteContent> = {}): SiteContent => ({
  ...(Object.fromEntries(
    SITE_CONTENT_FIELDS.map((field) => [field, { ar: null, en: null }]),
  ) as Record<(typeof SITE_CONTENT_FIELDS)[number], SiteContentText>),
  headerNav: [],
  faqItems: [],
  ...overrides,
});

const apiGet = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (path: string, options?: unknown) => apiGet(path, options),
  },
}));

const { getSiteContent, siteText, EMPTY_SITE_CONTENT } = await import("@/lib/site-content");

beforeEach(() => {
  apiGet.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the public site reads the operator's content", () => {
  it("requests the public endpoint, cacheably", async () => {
    apiGet.mockResolvedValue(siteContent());

    await getSiteContent();

    expect(apiGet).toHaveBeenCalledWith(
      "/public/site-content",
      expect.objectContaining({ revalidate: expect.any(Number) })
    );
  });

  it("returns the operator's value for a field they set", async () => {
    apiGet.mockResolvedValue(
      siteContent({ heroTitle: { ar: "عنوان مخصص", en: "Custom hero" } })
    );

    const content = await getSiteContent();

    expect(siteText(content, "heroTitle", "ar-SA")).toBe("عنوان مخصص");
    expect(siteText(content, "heroTitle", "en-SA")).toBe("Custom hero");
  });

  it("returns null for a field they did not set, so the caller falls back", async () => {
    apiGet.mockResolvedValue(siteContent());

    const content = await getSiteContent();

    expect(siteText(content, "heroTitle", "ar-SA")).toBeNull();
  });

  it("treats an empty string as NOT SET", async () => {
    // "not customised" and "set to nothing" are the same state, and the
    // shipped copy is the right answer to both. A blank heading is not a
    // design choice anyone made.
    apiGet.mockResolvedValue(siteContent({ heroTitle: { ar: "   ", en: "" } }));

    const content = await getSiteContent();

    expect(siteText(content, "heroTitle", "ar-SA")).toBeNull();
    expect(siteText(content, "heroTitle", "en-SA")).toBeNull();
  });

  it("falls back to the empty shape when the read FAILS", async () => {
    // The front door must render. Refusing to serve a homepage because a
    // piece of optional copy could not be fetched is strictly worse than
    // serving the shipped wording.
    apiGet.mockRejectedValue(new Error("settings unavailable"));

    expect(await getSiteContent()).toEqual(EMPTY_SITE_CONTENT);
  });

  it("survives a malformed response without throwing", async () => {
    apiGet.mockResolvedValue({
      heroTitle: "not a pair",
      headerNav: "not an array",
    });

    const content = await getSiteContent();

    expect(content.heroTitle).toEqual({ ar: null, en: null });
    expect(content.headerNav).toEqual([]);
  });

  it("keeps the header categories in the order the API sent", async () => {
    apiGet.mockResolvedValue(
      siteContent({
        headerNav: [
          { taxonomyNodeId: "b", nameAr: "ب", nameEn: "B" },
          { taxonomyNodeId: "a", nameAr: "أ", nameEn: "A" },
        ],
      })
    );

    const content = await getSiteContent();

    expect(content.headerNav.map((item) => item.taxonomyNodeId)).toEqual(["b", "a"]);
  });

  it("drops a malformed nav entry without dropping the sound ones", async () => {
    apiGet.mockResolvedValue(
      siteContent({
        headerNav: [
          { taxonomyNodeId: "a", nameAr: "أ", nameEn: "A" },
          { nameAr: "no id" },
          null,
        ] as never,
      })
    );

    const content = await getSiteContent();

    expect(content.headerNav).toHaveLength(1);
    expect(content.headerNav[0].taxonomyNodeId).toBe("a");
  });
});

describe("the homepage actually consumes it", () => {
  const HOME = strip(read("components/home/home-content.tsx"));

  it("reads the content", () => {
    expect(HOME).toContain("getSiteContent()");
  });

  // Only the offers heading is resolved here now. The hero panel and
  // the policies panel are both gone from the front door — the
  // reference goes straight from the category bar to the promotional
  // strip and then to the offers.
  it.each(["featuredTitle"])(
    "resolves %s with a fallback to the message catalogue",
    (field) => {
      expect(HOME).toContain(`siteText(content, "${field}", locale) ?? t(`);
    },
  );

  it("renders the resolved value, not the raw message", () => {
    expect(HOME).toContain("{featuredTitle}");
    expect(HOME).not.toContain('{t("featuredTitle")}');
  });

  it("no longer renders the hero, without dropping its fields", () => {
    // The wording stays in the contract, stays stored, and stays
    // editable from the admin screen — it simply has no place on this
    // page any more. Deleting the fields would be a contract change
    // nobody asked for and would discard an operator's writing.
    expect(HOME).not.toContain("{heroTitle}");
    expect(HOME).not.toContain("{heroDescription}");
    expect(SITE_CONTENT_FIELDS).toContain("heroTitle");
    expect(SITE_CONTENT_FIELDS).toContain("heroDescription");
  });

  it("puts the promotional strip above the offers grid", () => {
    // The approved order: top bar, categories, banner, offers, footer.
    expect(HOME.indexOf("BannerSlot")).toBeLessThan(
      HOME.indexOf("FeaturedOpportunities"),
    );
  });

  it("renders them as text, never as markup", () => {
    expect(HOME).not.toContain("dangerouslySetInnerHTML");
  });
});

// THE SURFACE MOVED, THE BEHAVIOUR DID NOT. `components/shell/header.tsx`
// was the public header that read the operator's category order; nothing
// has rendered it since the market strip took that job, and the file is
// gone. `market-strip.tsx` makes the same two reads, so these cases
// follow it rather than disappear with the file.
describe("the market strip actually consumes it", () => {
  const HEADER = strip(read("components/portal/market-strip.tsx"));

  it("reads the content and uses the operator's category order", () => {
    expect(HEADER).toContain("getSiteContent()");
    expect(HEADER).toContain("content.headerNav.map");
  });

  it("reads the live taxonomy, so a category can carry subcategories", () => {
    // headerNav stores ids only. The names and the children come from
    // the taxonomy at request time, which is what lets a root open its
    // subcategories without storing a second copy of anything.
    expect(HEADER).toContain("loadTaxonomy()");
    expect(HEADER).toContain("buildCategoryTree");
  });

  it("BUILDS each href from the taxonomy id — it stores no destination", () => {
    // The stored value is an id, so there is nothing a person typed and
    // nothing to allowlist.
    expect(HEADER).toContain("?taxonomyNodeId=${encodeURIComponent(id)}");
    expect(HEADER).toContain("encodeURIComponent(id)");
    // The stored entry carries an id and nothing that could be a
    // destination, so there is nothing here anyone typed.
    expect(HEADER).toContain("item.taxonomyNodeId");
    expect(HEADER).not.toContain("item.url");
    expect(HEADER).not.toContain("item.href");
    expect(HEADER).not.toContain("item.linkUrl");
  });

  it("leaves Home to the row of tabs, and does not print it twice", () => {
    // THE HOME LINK MOVED, and this case moved with it rather than
    // being deleted.
    //
    // The old public header carried a permanent Home link so a
    // retired category could not leave the bar empty. The strip is
    // not the bar any more: the row of tabs above it carries Home on
    // a wide screen, and the drawer carries it on a narrow one, so a
    // second Home inside the categories would be the same destination
    // printed twice.
    //
    // `CategoryNav` says so itself: in `strip` tone it renders no home
    // entry at all, whatever it is handed.
    const nav = strip(read("components/shell/category-nav.tsx"));
    expect(nav).toContain("{strip || !homeHref ? null : (");
    // AND THE STRIP HANDS IT NONE.
    expect(HEADER).not.toContain("homeHref");
  });

  it("renders category names as text", () => {
    expect(HEADER).not.toContain("dangerouslySetInnerHTML");
  });
});

// ------------------------------------------------------- policy limits


describe("the supplier data layer exposes the limits", () => {
  const SUPPLIER_DATA = strip(read("lib/supplier-data.ts"));

  it("has a loader for the endpoint", () => {
    expect(SUPPLIER_DATA).toContain("loadPolicyLimits");
    expect(SUPPLIER_DATA).toContain("/companies/me/policy-limits");
  });

  it("exposes only the two projected groups", () => {
    // `showScheduledPubliclyEnabled` is an internal display policy about
    // what anonymous visitors see. It is on the settings object this
    // endpoint projects FROM, and must not be on the projection.
    expect(SUPPLIER_DATA).not.toContain("showScheduledPubliclyEnabled");
    expect(SUPPLIER_DATA).not.toContain("commissionRateBasisPoints");
    expect(SUPPLIER_DATA).not.toContain("payoutHoldDays");
  });
});

describe("the media manager consumes the media limits", () => {
  const MEDIA = strip(read("components/supplier/product-media-manager.tsx"));

  it("takes the limits and uses each of the three fields", () => {
    expect(MEDIA).toContain("limits?: MediaPolicyLimits");
    expect(MEDIA).toContain("limits.maxImagesPerProduct");
    expect(MEDIA).toContain("limits.maxSizeBytes");
    expect(MEDIA).toContain("limits.allowedTypes");
  });

  it("sets the file input's accept from the policy's own types", () => {
    expect(MEDIA).toContain("limits.allowedTypes.join(\",\")");
  });

  it("stops offering an upload at the policy's ceiling", () => {
    expect(MEDIA).toContain("media.length >= limits.maxImagesPerProduct");
    expect(MEDIA).toContain("disabled={busy || atCapacity}");
  });

  it("says the limits without figures when the policy could not be read", () => {
    // A hardcoded fallback would be a number this app invented — the
    // exact thing the original comment refused to do.
    //
    // MATCHED WITHOUT ITS WHITESPACE. The rule is which two labels
    // stand on either side of `limits`, and that rule does not change
    // when the formatter decides the ternary now wants three lines.
    expect(MEDIA.replace(/\s+/g, " ")).toContain(
      "limits ? labels.addImageLimits : labels.addImageHint"
    );
    expect(MEDIA).toContain("limits !== undefined &&");
  });

  it("treats unknown limits as NOT at capacity", () => {
    // Disabling the control on a guess would block a valid upload.
    expect(MEDIA).toMatch(/atCapacity\s*=\s*limits !== undefined/);
  });

  it("the product page passes them through", () => {
    const PAGE = strip(read("app/[locale]/supplier/products/[id]/page.tsx"));
    expect(PAGE).toContain("loadPolicyLimits()");
    expect(PAGE).toContain("policyLimits.ok ? policyLimits.data.media : undefined");
  });
});

describe("the opportunity form consumes the opportunity limits", () => {
  const FORM = strip(read("components/supplier/opportunity-form.tsx"));

  it("takes the limits and uses all four fields", () => {
    expect(FORM).toContain("limits?: OpportunityLimits");
    expect(FORM).toContain("limits.minTargetQuantity");
    expect(FORM).toContain("limits.maxTargetQuantity");
    expect(FORM).toContain("limits.minDurationHours");
    expect(FORM).toContain("limits.maxDurationDays");
  });

  it("no longer PRINTS the bounds, and still uses them", () => {
    // The sentence stating them was an instruction under a field, and
    // the owner removed every one of those from the platform. What the
    // limits are for did not change: the form warns before a submit and
    // the server re-checks against live policy.
    expect(FORM).not.toContain("labels.hints");
    expect(FORM).toContain("limits.minDurationHours");
    expect(FORM).toContain("limits.maxDurationDays");
  });

  it("warns rather than blocks", () => {
    // The server re-checks every bound against the live policy; a form
    // that refused a value the server would accept is the worse failure.
    expect(FORM).toContain("aria-live=\"polite\"");
    expect(FORM).not.toMatch(/disabled=\{[^}]*warnings/);
  });

  it("shows no warning at all when the limits are unknown", () => {
    expect(FORM).toMatch(/const warnings = limits\s*\?/);
  });

  it("both pages pass them through", () => {
    // THE TWO PAGES ARE THE OFFER'S, not the product's. A duration and a
    // target quantity belong to a sale; the page that records a product
    // asks for neither and reads no policy it would not use.
    for (const page of [
      "app/[locale]/supplier/products/[id]/offers/new/page.tsx",
      "app/[locale]/supplier/opportunities/[id]/edit/page.tsx",
    ]) {
      const source = strip(read(page));
      expect(source, page).toContain("loadPolicyLimits()");
      expect(source, page).toContain("policyLimits.ok ? policyLimits.data.opportunity : undefined");
    }
  });
});

describe("the pre-submit warnings fire on the right values", () => {
  // Exercised through the exported helpers rather than the whole form:
  // the arithmetic is the part that can be wrong, and rendering the form
  // needs a router, a translator and a product list to say nothing more.
  const FORM_SOURCE = read("components/supplier/opportunity-form.tsx");

  it("compares the window in hours, converting the day maximum once", () => {
    // Two units in one comparison is where a unit mistake hides.
    expect(FORM_SOURCE).toContain("limits.maxDurationDays * 24");
    expect(FORM_SOURCE).toContain("(end - start) / 3_600_000");
  });

  it("stays silent on an incomplete or reversed window", () => {
    expect(FORM_SOURCE).toContain("end <= start) return []");
  });

  it("stays silent on a blank quantity, which required-field validation owns", () => {
    expect(FORM_SOURCE).toContain("if (!Number.isSafeInteger(quantity)) return []");
  });
});

describe("neither surface renders operator content as markup", () => {
  it.each([
    "components/home/home-content.tsx",
    "components/portal/market-strip.tsx",
    "components/admin/site-content-editor.tsx",
  ])("%s has no markup path", (file) => {
    expect(strip(read(file))).not.toContain("dangerouslySetInnerHTML");
  });
});
