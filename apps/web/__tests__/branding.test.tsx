import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EMPTY_BRANDING_PUBLIC, type BrandingPublic } from "@platform/types";
import { BrandMark } from "@/components/shell/brand-mark";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { getBranding, brandDescription, brandName } = await import("@/lib/branding");

const CONFIGURED: BrandingPublic = {
  nameAr: "منصة فرصة",
  nameEn: "FORSA Platform",
  shortDescriptionAr: "منصة أعمال",
  shortDescriptionEn: "A business platform",
  logoMainUrl: "https://cdn.example.com/main.png",
  logoSmallUrl: "https://cdn.example.com/small.png",
  faviconUrl: "https://cdn.example.com/fav.ico",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("getBranding", () => {
  it("requests the public endpoint with an explicit revalidate window", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(CONFIGURED), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(getBranding()).resolves.toEqual(CONFIGURED);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/branding");
    expect(fetchMock.mock.calls[0][1].next).toEqual({ revalidate: 60 });
  });

  it("degrades to the all-null fallback instead of throwing when the API fails", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(getBranding()).resolves.toEqual(EMPTY_BRANDING_PUBLIC);
  });

  it("degrades to the fallback on a network failure too", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getBranding()).resolves.toEqual(EMPTY_BRANDING_PUBLIC);
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
  it("renders the dynamic name and logo from the API", () => {
    render(<BrandMark branding={CONFIGURED} locale="ar-SA" fallbackName="المنصة" />);

    expect(screen.getByText("منصة فرصة")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "منصة فرصة" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/main.png"
    );
  });

  it("uses the translated fallback and renders no image when unconfigured", () => {
    render(<BrandMark branding={EMPTY_BRANDING_PUBLIC} locale="ar-SA" fallbackName="المنصة" />);

    expect(screen.getByText("المنصة")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("selects the small logo for the small variant", () => {
    render(
      <BrandMark branding={CONFIGURED} locale="en-SA" fallbackName="Platform" variant="small" />
    );

    expect(screen.getByRole("img", { name: "FORSA Platform" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/small.png"
    );
  });

  it("labels the logo with the brand name so it is never an unlabelled image", () => {
    render(<BrandMark branding={CONFIGURED} locale="en-SA" fallbackName="Platform" />);
    expect(screen.getByRole("img")).toHaveAccessibleName("FORSA Platform");
  });
});
