import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DEFAULT_BRAND_THEME,
  EMPTY_BRANDING_PUBLIC,
  type BrandingPublic,
} from "@platform/types";
import { BrandMark } from "@/components/shell/brand-mark";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { getBranding, brandDescription, brandName } =
  await import("@/lib/branding");

const CONFIGURED: BrandingPublic = {
  nameAr: "منصة فرصة",
  nameEn: "FORSA Platform",
  shortDescriptionAr: "منصة أعمال",
  shortDescriptionEn: "A business platform",
  logoMainUrl: "https://cdn.example.com/main.png",
  // A ROUTE ON THIS API, resolved by the server for the language the
  // page is being rendered in. Never a storage key and never an
  // off-site address.
  headerLogo: "/api/v1/branding/logo?locale=ar-SA",
  logoSmallUrl: "https://cdn.example.com/small.png",
  faviconUrl: "https://cdn.example.com/fav.ico",
  theme: { colors: DEFAULT_BRAND_THEME },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("getBranding", () => {
  it("serves the shell from a short cache window rather than re-reading on every page", async () => {
    // THIS USED TO ASSERT `no-store`, and that was the defect: branding
    // is drawn by the shell, so an uncached read was a round trip on
    // EVERY page load of the platform returning bytes that change
    // perhaps monthly.
    //
    // The window replaces «a publish is visible immediately» with «a
    // publish is visible within a minute», which is a bounded and
    // stated cost. Both halves are asserted — the window is present AND
    // the opt-out is gone — because dropping one would leave the other
    // passing on a half-applied change.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(CONFIGURED), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(getBranding("ar-SA")).resolves.toEqual(CONFIGURED);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/branding");
    expect(fetchMock.mock.calls[0][1].cache).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].next).toEqual({ revalidate: 60 });
  });

  it("asks for the mark in the language the page is being rendered in", () => {
    // The server resolves `headerLogo` from this, so a page that did not
    // say which language it was would get whichever mark came first.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(CONFIGURED), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    return Promise.all([getBranding("ar-SA"), getBranding("en-SA")]).then(
      () => {
        expect(fetchMock.mock.calls[0][0]).toContain("locale=ar-SA");
        expect(fetchMock.mock.calls[1][0]).toContain("locale=en-SA");
      },
    );
  });

  it("degrades to the all-null fallback instead of throwing when the API fails", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(getBranding("ar-SA")).resolves.toEqual(EMPTY_BRANDING_PUBLIC);
  });

  it("degrades to the fallback on a network failure too", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getBranding("ar-SA")).resolves.toEqual(EMPTY_BRANDING_PUBLIC);
  });
});

describe("locale selection", () => {
  it("picks the Arabic fields for ar-SA and the English ones for en-SA", () => {
    expect(brandName(CONFIGURED, "ar-SA")).toBe("منصة فرصة");
    expect(brandName(CONFIGURED, "en-SA")).toBe("FORSA Platform");
    expect(brandDescription(CONFIGURED, "ar-SA")).toBe("منصة أعمال");
    expect(brandDescription(CONFIGURED, "en-SA")).toBe("A business platform");
  });

  it("returns null when unconfigured, forcing the caller to translate a fallback", () => {
    expect(brandName(EMPTY_BRANDING_PUBLIC, "ar-SA")).toBeNull();
    expect(brandDescription(EMPTY_BRANDING_PUBLIC, "en-SA")).toBeNull();
  });
});

describe("BrandMark", () => {
  // Every render needs the same three strings, so they live here rather
  // than being retyped: a generic picture description, what the link
  // does, and where it goes. None of them is a brand name.
  const CHROME = {
    logoAlt: "شعار المنصة",
    homeLabel: "الانتقال إلى الرئيسية",
    homeHref: "/ar-SA",
  };

  const renderMark = (branding: BrandingPublic, extra = {}) =>
    render(<BrandMark branding={branding} {...CHROME} {...extra} />);

  it("shows the mark the SERVER resolved for this language", () => {
    // The component takes no locale of its own. `headerLogo` is already
    // this page's language, decided once on the server, so there is no
    // second place that could disagree about which mark belongs here.
    renderMark(CONFIGURED);

    expect(screen.getByTestId("brand-mark-logo")).toHaveAttribute(
      "src",
      "http://localhost:3000/api/v1/branding/logo?locale=ar-SA",
    );
  });

  it("resolves the path onto the API ORIGIN, never leaves it relative", () => {
    // THE DEFECT THIS GUARDS. `headerLogo` arrives as a path on the API
    // origin, and the web app is served from a different one. Left
    // relative, the browser resolved it against the WEB origin, asked
    // Next.js for a route it does not have, and put an HTML 404 page
    // into an <img> — the broken-image icon that appeared in the header
    // with the alt text beside it.
    renderMark(CONFIGURED);

    const src = screen.getByTestId("brand-mark-logo").getAttribute("src") ?? "";
    expect(src.startsWith("http")).toBe(true);
    expect(src.startsWith("/api/")).toBe(false);
    // And it is THIS API, not an address anyone typed into a settings
    // field — which is what the column this replaced used to hold.
    expect(src).toContain("/api/v1/branding/logo");
    expect(src).not.toContain("//cdn.");
  });

  it("goes through the same resolver every other image in the app uses", () => {
    // Not a second, hand-rolled way of building an absolute URL:
    // `mediaUrl` is where the browser base URL is decided, and a copy
    // here would be the one that keeps pointing at localhost after a
    // deployment.
    const code = readFileSync(join(process.cwd(), "lib/branding.ts"), "utf8");

    expect(code).toContain("mediaUrl(");
    expect(code).toContain('from "./media-url"');
  });

  it("does NOT fall back to the other language's mark", () => {
    // Showing the English logo on an Arabic page would be a
    // substitution nobody asked for. A blank placeholder is correct.
    renderMark({ ...CONFIGURED, headerLogo: null });

    expect(screen.queryByTestId("brand-mark-logo")).not.toBeInTheDocument();
    expect(screen.getByTestId("brand-mark-placeholder")).toBeInTheDocument();
  });

  it("does not fall back to the bilingual `logoMainUrl` either", () => {
    // That column is still on the model and still carries a value on
    // this fixture. The header does not read it: one source, or blank.
    renderMark({ ...CONFIGURED, headerLogo: null });

    expect(screen.queryByTestId("brand-mark-logo")).not.toBeInTheDocument();
  });

  it("treats a blank value as unset rather than as a URL", () => {
    // Rendering "" or "   " as a src puts a broken image in the top bar.
    renderMark({ ...CONFIGURED, headerLogo: "   " });

    expect(screen.queryByTestId("brand-mark-logo")).not.toBeInTheDocument();
    expect(screen.getByTestId("brand-mark-placeholder")).toBeInTheDocument();
  });

  it("NEVER prints a brand name — not beside the mark, and not instead of it", () => {
    // The mark carries the symbol and the wordmark inside the artwork.
    // A name in text next to it says the same thing twice, in a
    // different typeface.
    renderMark(CONFIGURED);

    expect(screen.queryByText("منصة فرصة")).not.toBeInTheDocument();
    expect(screen.queryByText("FORSA Platform")).not.toBeInTheDocument();
  });

  it("shows a BLANK placeholder when no logo is configured, never a wordmark", () => {
    const noLogos = { ...CONFIGURED, logoMainUrl: null, headerLogo: null };
    renderMark(noLogos);

    // Anything legible here would be a brand identity this app chose
    // rather than one an operator uploaded — including the name that
    // IS configured on this fixture.
    const placeholder = screen.getByTestId("brand-mark-placeholder");
    expect(placeholder.textContent).toBe("");
    expect(screen.queryByText("منصة فرصة")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("holds the space rather than letting the top bar collapse", () => {
    renderMark(EMPTY_BRANDING_PUBLIC);

    const placeholder = screen.getByTestId("brand-mark-placeholder");
    expect(placeholder.className).toMatch(/\bh-8\b/);
    expect(placeholder.className).toMatch(/\bw-24\b/);
    // Decorative: the link above already carries the accessible name,
    // so this must not be announced as an empty image.
    expect(placeholder.getAttribute("aria-hidden")).toBe("true");
  });

  it("links to the home page, named by what activating it DOES", () => {
    renderMark(CONFIGURED);

    const link = screen.getByTestId("brand-mark");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/ar-SA");
    // Not "Platform logo" — a reader activating this wants to know
    // where it goes, not what the picture is.
    expect(link).toHaveAttribute("aria-label", "الانتقال إلى الرئيسية");
  });

  it("still links home when there is no logo to show", () => {
    renderMark(EMPTY_BRANDING_PUBLIC);

    expect(screen.getByTestId("brand-mark")).toHaveAttribute("href", "/ar-SA");
    expect(screen.getByTestId("brand-mark")).toHaveAttribute(
      "aria-label",
      "الانتقال إلى الرئيسية",
    );
  });

  it("describes the PICTURE generically, with no tenant name in it", () => {
    renderMark(CONFIGURED);

    const logo = screen.getByTestId("brand-mark-logo");
    expect(logo).toHaveAttribute("alt", "شعار المنصة");
    expect(logo.getAttribute("alt")).not.toContain("فرصة");
  });

  it("imposes no shape on the logo", () => {
    renderMark(CONFIGURED);

    // A mark may be square or wide, and cropping or stretching an
    // operator's logo into a box this app chose would be a design
    // decision taken away from them. It settles inside whichever bound
    // it meets first, keeping its own proportions.
    const logo = screen.getByTestId("brand-mark-logo");
    expect(logo.className).toContain("object-contain");
    expect(logo.className).toContain("max-h-");
    expect(logo.className).toContain("max-w-");
    expect(logo.className).toContain("h-auto");
    expect(logo.className).toContain("w-auto");
    // No aspect-ratio, and no fixed height or width.
    expect(logo.className).not.toMatch(/aspect-/);
    expect(logo.className).not.toMatch(/object-cover/);
  });

  it("reads no name field at all", () => {
    // A component that cannot see the name cannot print it. Guards the
    // decision at its source rather than at every render.
    // Comments are stripped first: naming the fields in prose is how
    // the decision is explained, and only READING them is forbidden.
    // Comment lines are dropped first: naming the fields in prose is
    // how the decision gets explained, and only READING them is
    // forbidden. Dropping whole lines is enough here and needs no
    // block-comment parsing.
    const code = readFileSync(
      join(process.cwd(), "components/shell/brand-mark.tsx"),
      "utf8",
    )
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return (
          !trimmed.startsWith("*") &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*")
        );
      })
      .join("\n");

    expect(code).not.toContain("nameAr");
    expect(code).not.toContain("nameEn");
    expect(code).not.toContain("brandName");
  });

  it("selects the small logo for the small variant", () => {
    renderMark(CONFIGURED, { variant: "small" });

    expect(screen.getByTestId("brand-mark-logo")).toHaveAttribute(
      "src",
      "https://cdn.example.com/small.png",
    );
  });

  it("is never an unlabelled image, and never labelled with a brand name", () => {
    renderMark(CONFIGURED);

    // The picture is described generically; the LINK around it is what
    // carries the name of the action.
    expect(screen.getByRole("img")).toHaveAccessibleName("شعار المنصة");
    expect(screen.getByTestId("brand-mark")).toHaveAttribute(
      "aria-label",
      "الانتقال إلى الرئيسية",
    );
  });
});
