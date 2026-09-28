import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { mediaUrl } from "@/lib/media-url";

/**
 * EVERY PICTURE HAS TO REACH THE API's ORIGIN.
 *
 * The API sends image fields as PATHS on its own origin —
 * `/api/v1/opportunities/:id/image`, `/api/v1/branding/logo`,
 * `/api/v1/banners/:id/image`. The web app is served from a different
 * origin, so an `<img src>` left relative resolves against the WEB
 * origin and answers 404. The picture does not fail loudly; it simply
 * never arrives, and the screen shows an empty frame.
 *
 * THAT IS NOT HYPOTHETICAL. «عروضي الجارية» on the supplier's own
 * dashboard rendered `listing.imageUrl` raw and drew a blank square for
 * every listing that had a photograph. The header's small brand mark
 * had the same hole, unseen only because no operator had uploaded one.
 *
 * `lib/media-url.ts` exists for exactly this, and its own doc comment
 * says so. This case is the part that could not be written in a
 * comment: that every `<img>` in the app actually uses it.
 */
const ROOT = join(__dirname, "..");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(full) ? [full] : [];
  });
}

const SOURCE = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];
const name = (file: string) => relative(ROOT, file).split("\\").join("/");

/**
 * A picture made IN THE BROWSER needs no origin: a `blob:` URL from
 * `URL.createObjectURL` and a local file preview both exist only in
 * the tab that made them.
 */
const MADE_LOCALLY = /preview|createObjectURL|blob/i;

describe("every image the API serves", () => {
  it("passes through mediaUrl, so it resolves against the API and not the web app", () => {
    const offenders: string[] = [];

    for (const file of SOURCE) {
      const code = readFileSync(file, "utf8");
      if (!/<img\b/.test(code)) continue;

      // OR THROUGH SOMETHING THAT CALLS IT. `brandLogoUrl` is the
      // helper for the tenant's mark and its last act is `mediaUrl`, so
      // a file that absolutises through it is absolutising.
      const importsHelper = /mediaUrl\s*\(|brandLogoUrl\s*\(/.test(code);

      for (const found of code.matchAll(/<img[\s\S]{0,400}?src=\{([^}]+)\}/g)) {
        const expression = found[1].trim();
        if (MADE_LOCALLY.test(expression)) continue;
        if (/mediaUrl\(/.test(expression)) continue;
        // The value may be absolutised a few lines above, in the same
        // file — `OpportunityImage` and the banner manager both do.
        if (importsHelper) continue;

        const line = code.slice(0, found.index ?? 0).split("\n").length;
        offenders.push(`${name(file)}:${line} — src={${expression.slice(0, 40)}}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("finds the image tags, so the sweep cannot pass by finding nothing", () => {
    const withImages = SOURCE.filter((file) =>
      /<img\b/.test(readFileSync(file, "utf8"))
    );

    expect(withImages.length).toBeGreaterThanOrEqual(6);
  });
});

describe("the helper itself", () => {
  it("absolutises a path onto the API's origin", () => {
    expect(mediaUrl("/api/v1/opportunities/x/image")).toBe(
      "http://localhost:3000/api/v1/opportunities/x/image"
    );
  });

  it("leaves an absolute URL alone, so asking twice is free", () => {
    // This is what lets a component guarantee its own `src` without
    // knowing whether its caller already did the work.
    const absolute = "http://localhost:3000/api/v1/banners/x/image";
    expect(mediaUrl(absolute)).toBe(absolute);
    expect(mediaUrl(mediaUrl("/api/v1/banners/x/image"))).toBe(absolute);
  });

  it("passes null through, so a caller keeps its no-image branch", () => {
    expect(mediaUrl(null)).toBeNull();
  });
});

// --------------------------------------------------- the one that broke

describe("«عروضي الجارية» draws the picture it is sent", () => {
  it("renders an ABSOLUTE src, so the browser asks the API and not the web app", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { ListingsPanel } = await import("@/components/supplier/dashboard-panels");

    render(
      <ListingsPanel
        listings={[
          {
            id: "opp-1",
            saleMode: "GROUP" as const,
            productId: "prod-1",
            productNameAr: "بجامة",
            productNameEn: "Pyjamas",
            salesUnitNameAr: "قطعة",
            salesUnitNameEn: "Piece",
            // Exactly what the service sends: a path on the API origin.
            imageUrl: "/api/v1/opportunities/opp-1/image?variant=thumb",
            regionNameAr: "منطقة نجران",
            regionNameEn: "Najran Region",
            targetQuantity: 5000,
            fundedQuantity: 0,
            endAt: "2026-09-19T10:24:00.000Z",
          },
        ]}
        locale="ar-SA"
        rtl
        labels={{
          title: "عروضي الجارية",
          viewAll: "عرض الكل",
          manage: "إدارة",
          empty: "لا توجد عروض جارية.",
          of: "من",
          fundedNote: "المباع",
          soldNote: "المباع من المخزون",
          endsIn: "يُغلق خلال",
          endsToday: "يُغلق اليوم",
          day: "يوم",
          days: "أيام",
          noRegion: "بلا منطقة",
        }}
      />,
    );

    const image = screen.getByTestId("listings-panel").querySelector("img");
    expect(image).not.toBeNull();
    // THE WHOLE DEFECT IN ONE ASSERTION. Rendered raw, this read
    // `/api/v1/…` and the browser asked the WEB origin for it.
    expect(image!.getAttribute("src")).toBe(
      "http://localhost:3000/api/v1/opportunities/opp-1/image?variant=thumb",
    );
  });
});
