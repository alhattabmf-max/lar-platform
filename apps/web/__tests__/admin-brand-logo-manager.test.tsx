import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/ar-SA.json";
import {
  BrandLogoManager,
  type BrandLogoManagerLabels,
} from "@/components/admin/brand-logo-manager";
import {
  BRAND_LOGO_LIMITS,
  type BrandAssetsAdminView,
  type ErrorCode,
} from "@platform/types";
import * as api from "@/lib/api-client";
import { ApiError } from "@/lib/errors";
import { ERROR_CODES } from "@platform/types";

/**
 * The header logo, inside the identity screen.
 *
 * TWO LANGUAGES, ONE ACT. Each language is uploaded and previewed on
 * its own, but going live and being removed happen to the pair — a
 * header showing a new Arabic mark beside an old English one is not a
 * state anyone chose. These tests hold the asymmetry: independent
 * uploads, joint publish, joint delete.
 *
 * NOTHING INTERNAL REACHES THE SCREEN. The view the server sends
 * carries no storage key, and the preview is fetched through an API
 * route rather than a public address.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const B = messages.admin.branding;

const LABELS: BrandLogoManagerLabels = {
  present: B.logoPresent,
  missing: B.logoMissing,
  publish: B.logoPublish,
  published: B.logoPublished,
  unpublished: B.logoUnpublished,
  publishNeedsBoth: B.logoPublishNeedsBoth,
  deleteSet: B.logoDelete,
  deletePrompt: B.logoDeletePrompt,
  deleteConfirm: B.logoDeleteConfirm,
  cancel: B.cancel,
  working: B.working,
  errorTitle: "تعذّر إتمام الطلب",
  requestIdLabel: "رقم المرجع",
};

type Locale = "ar-SA" | "en-SA";

function asset(locale: Locale, publishedAt: string | null = null) {
  return {
    locale,
    width: 240,
    height: 64,
    contentType: "image/png" as const,
    publishedAt,
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}

function view(
  locales: Locale[],
  publishedAt: string | null = null,
): BrandAssetsAdminView {
  const assets = locales.map((locale) => asset(locale, publishedAt));
  return {
    assets,
    complete: locales.length === 2,
    published: locales.length === 2 && publishedAt !== null,
  };
}

function renderWith(data: BrandAssetsAdminView) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <BrandLogoManager view={data} labels={LABELS} />
    </NextIntlClientProvider>,
  );
}

const file = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", {
    type: "image/png",
  });

function pickerFor(locale: Locale): HTMLInputElement {
  const label = screen.getByTestId(`brand-logo-picker-${locale}`);
  return label.querySelector("input[type=file]") as HTMLInputElement;
}

describe("the operator is told what a logo may be before choosing a file", () => {
  it("states the formats and the ceilings up front", () => {
    // A picker that only reports "invalid" AFTER a file has been chosen
    // makes the operator guess what was wrong.
    renderWith(view([]));

    const text = screen.getByTestId("brand-logo-manager").textContent ?? "";
    expect(text).toContain("PNG");
    expect(text).toContain("WebP");
    // The NUMBERS come from the shared constant, so the sentence cannot
    // promise one ceiling while the server enforces another.
    expect(text).toContain(String(BRAND_LOGO_LIMITS.minWidth));
    expect(text).toContain(String(BRAND_LOGO_LIMITS.minHeight));
    expect(text).toContain(
      String(BRAND_LOGO_LIMITS.maxSizeBytes / (1024 * 1024)),
    );
    // And no placeholder survived into what the operator reads.
    expect(text).not.toContain("{");
  });

  it("offers only the two accepted formats to the file dialog", () => {
    renderWith(view([]));

    // No SVG: it is a document that can carry script, not a picture.
    for (const locale of ["ar-SA", "en-SA"] as const) {
      const accept = pickerFor(locale).getAttribute("accept");
      expect(accept).toBe("image/png,image/webp");
      expect(accept).not.toContain("svg");
    }
  });
});

describe("each language has its own slot", () => {
  it("shows one for Arabic and one for English", () => {
    renderWith(view([]));

    expect(screen.getByTestId("brand-logo-slot-ar-SA")).toBeTruthy();
    expect(screen.getByTestId("brand-logo-slot-en-SA")).toBeTruthy();
  });

  it("says which language has a logo and which does not", () => {
    renderWith(view(["ar-SA"]));

    expect(screen.getByTestId("brand-logo-preview-ar-SA")).toBeTruthy();
    expect(screen.getByTestId("brand-logo-empty-en-SA")).toBeTruthy();
    expect(screen.queryByTestId("brand-logo-preview-en-SA")).toBeNull();
  });

  it('names each control by its LANGUAGE, not just "upload"', () => {
    // Two identical buttons side by side make an operator work out which
    // is which from where it sits on the screen.
    renderWith(view([]));

    expect(screen.getByTestId("brand-logo-picker-ar-SA").textContent).toBe(
      "رفع الشعار العربي",
    );
    expect(screen.getByTestId("brand-logo-picker-en-SA").textContent).toBe(
      "رفع الشعار الإنجليزي",
    );
  });

  it("offers REPLACE where artwork exists, still named by language", () => {
    renderWith(view(["ar-SA"]));

    expect(screen.getByTestId("brand-logo-picker-ar-SA").textContent).toBe(
      "استبدال الشعار العربي",
    );
    expect(screen.getByTestId("brand-logo-picker-en-SA").textContent).toBe(
      "رفع الشعار الإنجليزي",
    );
  });

  it("previews through an API route, never a public address", () => {
    renderWith(view(["ar-SA"]));

    const src =
      screen.getByTestId("brand-logo-preview-ar-SA").getAttribute("src") ?? "";
    expect(src).toContain("/api/v1/admin/branding/logo/image");
    expect(src).toContain("locale=ar-SA");
  });
});

describe("uploading is addressed to ONE language", () => {
  it("sends the Arabic file to the Arabic locale", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith(view([]));
    await user.upload(pickerFor("ar-SA"), file());

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][0]).toBe("/admin/branding/logo?locale=ar-SA");
  });

  it("sends the English file to the English locale", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith(view([]));
    await user.upload(pickerFor("en-SA"), file());

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][0]).toBe("/admin/branding/logo?locale=en-SA");
  });

  it("REPLACES one language without touching the other", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith(view(["ar-SA", "en-SA"]));
    await user.upload(pickerFor("ar-SA"), file());

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][0]).toContain("locale=ar-SA");
    expect(upload.mock.calls[0][0]).not.toContain("en-SA");
  });

  it("reports a refusal with its reference instead of failing silently", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "uploadFile").mockRejectedValue(
      new ApiError({
        kind: "validation",
        status: 400,
        code: ERROR_CODES.BRAND_LOGO_TOO_SMALL,
        requestId: "req-logo-1",
        message: "Logo is 32x16, smaller than the 64x32 minimum",
      }),
    );

    renderWith(view([]));
    await user.upload(pickerFor("ar-SA"), file());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("req-logo-1");
  });
});

describe("a refused logo says WHY, and what to do about it", () => {
  /**
   * The defect this reproduces.
   *
   * An 863KB PNG — an ordinary wordmark export — was refused, and the
   * panel said "the submitted data is not valid" and nothing else. The
   * operator had no way to tell whether to shrink the file, re-export
   * it in another format, or scale it up, and both language slots
   * stayed empty with no explanation.
   *
   * The cause was one error code for four different problems: `code` is
   * the only field the web app may key a message off, so a shared code
   * can only ever produce a shared message.
   */
  async function refuse(code: ErrorCode) {
    const user = userEvent.setup();
    vi.spyOn(api, "uploadFile").mockRejectedValue(
      new ApiError({
        kind: "validation",
        status: 400,
        code,
        requestId: "req-1",
        message: "server-side detail that must never be rendered",
      }),
    );

    renderWith(view([]));
    await user.upload(pickerFor("ar-SA"), file());
    return (await screen.findByTestId("brand-logo-error")).textContent ?? "";
  }

  it("does NOT fall back to the generic validation message", async () => {
    const text = await refuse(ERROR_CODES.BRAND_LOGO_TOO_LARGE);

    expect(text).not.toBe(messages.errors.codes.VALIDATION_FAILED);
    expect(text).not.toContain("غير صحيحة");
  });

  it("names the SIZE limit when the file is too big", async () => {
    const text = await refuse(ERROR_CODES.BRAND_LOGO_TOO_LARGE);

    // The number is interpolated from the shared constant, not typed
    // into the message.
    expect(text).toContain(
      String(BRAND_LOGO_LIMITS.maxSizeBytes / (1024 * 1024)),
    );
    expect(text).toContain("ميغابايت");
  });

  it("names the FORMAT when the type is not supported", async () => {
    const text = await refuse(ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED);

    expect(text).toContain("PNG");
    expect(text).toContain("WebP");
  });

  it("names the MINIMUM when the image is too small", async () => {
    const text = await refuse(ERROR_CODES.BRAND_LOGO_TOO_SMALL);

    expect(text).toContain(String(BRAND_LOGO_LIMITS.minWidth));
    expect(text).toContain(String(BRAND_LOGO_LIMITS.minHeight));
  });

  it("has something distinct to say about too many pixels", async () => {
    const text = await refuse(ERROR_CODES.BRAND_LOGO_TOO_MANY_PIXELS);

    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toContain("{");
  });

  it("gives each cause a DIFFERENT message", async () => {
    // Four codes that all resolved to one string would leave the
    // operator exactly where they started.
    const seen = new Set<string>();
    for (const code of [
      ERROR_CODES.BRAND_LOGO_TOO_LARGE,
      ERROR_CODES.BRAND_LOGO_TOO_MANY_PIXELS,
      ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED,
      ERROR_CODES.BRAND_LOGO_TOO_SMALL,
    ]) {
      seen.add(await refuse(code));
      cleanup();
    }

    expect(seen.size).toBe(4);
  });

  it("never renders the server's English detail", async () => {
    const text = await refuse(ERROR_CODES.BRAND_LOGO_TOO_LARGE);

    // The message the server writes is for the log; it names byte counts
    // and formats and is not translated.
    expect(text).not.toContain("server-side detail");
  });

  it("leaves no placeholder in any of the four", async () => {
    for (const code of [
      ERROR_CODES.BRAND_LOGO_TOO_LARGE,
      ERROR_CODES.BRAND_LOGO_TOO_MANY_PIXELS,
      ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED,
      ERROR_CODES.BRAND_LOGO_TOO_SMALL,
    ]) {
      // A message with an unfilled `{maxMb}` is how next-intl reports a
      // missing value, and it reads as a bug to whoever sees it.
      expect([code, await refuse(code)]).toEqual([
        code,
        expect.not.stringContaining("{"),
      ]);
      cleanup();
    }
  });
});

describe("publishing takes the pair or nothing", () => {
  it("is refused while a language is missing, WITH the reason", async () => {
    renderWith(view(["ar-SA"]));

    const publish = screen.getByTestId(
      "brand-logo-publish",
    ) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    // Disabled AND explained: a control that does nothing and says
    // nothing is indistinguishable from a broken one.
    expect(publish.getAttribute("title")).toBe(B.logoPublishNeedsBoth);
  });

  it("is refused when neither language has a logo", () => {
    renderWith(view([]));

    expect(
      (screen.getByTestId("brand-logo-publish") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("sends nothing when the incomplete control is pressed anyway", async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({});

    renderWith(view(["ar-SA"]));
    await user.click(screen.getByTestId("brand-logo-publish"));

    expect(post).not.toHaveBeenCalled();
  });

  it("publishes the set once both exist", async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({});

    renderWith(view(["ar-SA", "en-SA"]));
    await user.click(screen.getByTestId("brand-logo-publish"));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // One route for the set — there is no per-language publish.
    expect(post.mock.calls[0][0]).toBe("/admin/branding/logo/publish");
  });

  it("says whether the current set is live", () => {
    const draft = renderWith(view(["ar-SA", "en-SA"]));
    expect(screen.getByTestId("brand-logo-manager").textContent).toContain(
      B.logoUnpublished,
    );
    draft.unmount();

    renderWith(view(["ar-SA", "en-SA"], "2026-08-25T01:00:00.000Z"));
    expect(screen.getByTestId("brand-logo-manager").textContent).toContain(
      B.logoPublished,
    );
  });
});

describe("deleting removes the pair, and asks first", () => {
  it("offers nothing to delete when there is nothing there", () => {
    renderWith(view([]));

    expect(screen.queryByTestId("brand-logo-delete")).toBeNull();
  });

  it("asks in the page rather than through a browser dialog", async () => {
    const user = userEvent.setup();
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});

    renderWith(view(["ar-SA", "en-SA"]));
    await user.click(screen.getByTestId("brand-logo-delete"));

    // A `window.confirm` cannot be translated, ignores the document's
    // RTL direction, and a browser may suppress it outright.
    const prompt = screen.getByTestId("brand-logo-delete-confirm");
    expect(prompt.textContent).toContain(B.logoDeletePrompt);
    expect(del).not.toHaveBeenCalled();
  });

  it("lets the operator back out with nothing sent", async () => {
    const user = userEvent.setup();
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});

    renderWith(view(["ar-SA", "en-SA"]));
    await user.click(screen.getByTestId("brand-logo-delete"));
    await user.click(screen.getByText(B.cancel));

    expect(screen.queryByTestId("brand-logo-delete-confirm")).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it("sends ONE request for the whole set once confirmed", async () => {
    const user = userEvent.setup();
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});

    renderWith(view(["ar-SA", "en-SA"]));
    await user.click(screen.getByTestId("brand-logo-delete"));
    await user.click(screen.getByTestId("brand-logo-delete-confirmed"));

    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    // No locale anywhere: there is no per-language delete.
    expect(del.mock.calls[0][0]).toBe("/admin/branding/logo");
  });

  it("still offers the delete when only one language was uploaded", async () => {
    // A half-set is exactly the state an operator most needs to clear.
    renderWith(view(["ar-SA"]));

    expect(screen.getByTestId("brand-logo-delete")).toBeTruthy();
  });
});

describe("nothing internal reaches the screen", () => {
  it("prints no storage key anywhere in the panel", () => {
    renderWith(view(["ar-SA", "en-SA"], "2026-08-25T01:00:00.000Z"));

    expect(screen.getByTestId("brand-logo-manager").innerHTML).not.toContain(
      "brand/logo/",
    );
  });

  it("keeps the previews out of the accessibility tree", () => {
    // The language is named by the label above each slot, so announcing
    // the picture as well would say the same thing twice.
    renderWith(view(["ar-SA", "en-SA"]));

    for (const locale of ["ar-SA", "en-SA"] as const) {
      const img = screen.getByTestId(`brand-logo-preview-${locale}`);
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("the preview is a TEST, not a decoration", () => {
  /**
   * What this reproduces.
   *
   * Both languages uploaded, both badges green, the set published — and
   * every preview a broken image, with the header showing one too. The
   * server was answering 200 on every request; the browser was fetching
   * the bytes and then discarding them, because the route carried
   * `Cross-Origin-Resource-Policy: same-origin` and the panel is served
   * from a different origin than the API.
   *
   * Nothing in this screen could see that: "present" was printed from a
   * database row. It now reports whether the picture RENDERED.
   */
  const failPreview = (locale: Locale) =>
    fireEvent.error(screen.getByTestId(`brand-logo-preview-${locale}`));

  const loadPreview = (locale: Locale) =>
    fireEvent.load(screen.getByTestId(`brand-logo-preview-${locale}`));

  it("says so when the picture does not render", () => {
    renderWith(view(["ar-SA", "en-SA"]));
    failPreview("ar-SA");

    expect(screen.getByTestId("brand-logo-preview-failed-ar-SA")).toBeTruthy();
    expect(screen.getByTestId("brand-logo-stage").textContent).toBe(
      "تعذّر عرض معاينة الشعار العربي.",
    );
  });

  it("REFUSES TO PUBLISH while a preview has not rendered", () => {
    // A mark nobody can see is not one to put in front of visitors.
    renderWith(view(["ar-SA", "en-SA"]));
    const publish = screen.getByTestId(
      "brand-logo-publish",
    ) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);

    failPreview("en-SA");

    expect(
      (screen.getByTestId("brand-logo-publish") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("brand-logo-publish").getAttribute("title")).toBe(
      B.logoPublishNeedsPreview,
    );
  });

  it("sends nothing when the blocked publish is pressed anyway", async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({});

    renderWith(view(["ar-SA", "en-SA"]));
    failPreview("ar-SA");
    await user.click(screen.getByTestId("brand-logo-publish"));

    expect(post).not.toHaveBeenCalled();
  });

  it("recovers the moment the picture appears", () => {
    renderWith(view(["ar-SA", "en-SA"]));

    failPreview("ar-SA");
    expect(
      (screen.getByTestId("brand-logo-publish") as HTMLButtonElement).disabled,
    ).toBe(true);

    loadPreview("ar-SA");
    expect(
      (screen.getByTestId("brand-logo-publish") as HTMLButtonElement).disabled,
    ).toBe(false);
    // And the warning goes with it, rather than sitting there stale.
    expect(screen.queryByTestId("brand-logo-failure")).toBeNull();
  });

  it("blames only the language that failed", () => {
    renderWith(view(["ar-SA", "en-SA"]));
    failPreview("ar-SA");

    expect(screen.getByTestId("brand-logo-preview-failed-ar-SA")).toBeTruthy();
    expect(screen.queryByTestId("brand-logo-preview-failed-en-SA")).toBeNull();
  });

  it("stops calling a language PRESENT when its picture will not render", () => {
    // The badge was the thing that said everything was fine while
    // nothing was.
    renderWith(view(["ar-SA"]));
    expect(screen.getByTestId("brand-logo-slot-ar-SA").textContent).toContain(
      B.logoPresent,
    );

    failPreview("ar-SA");
    expect(
      screen.getByTestId("brand-logo-slot-ar-SA").textContent,
    ).not.toContain(B.logoPresent);
  });

  it("explains that a stored image the browser rejects is a DELIVERY problem", async () => {
    renderWith(view(["ar-SA"]));
    failPreview("ar-SA");

    const hint = screen.getByTestId("brand-logo-error").textContent ?? "";
    expect(hint).toBe(B.logoPreviewFailedHint);
    // Not the file: the last investigation went looking at the export
    // when the export was fine.
    expect(hint).not.toContain("نوع الملف");
  });
});

describe("the preview shows the CURRENT artwork, not the one it replaced", () => {
  it("changes the request when the asset does", () => {
    // The route is identical for every version of a language's logo and
    // answers with an ETag and cache headers, so a replacement would
    // otherwise redisplay the picture it just replaced — and the
    // operator would believe the upload silently failed.
    const first = renderWith(view(["ar-SA"]));
    const before = screen
      .getByTestId("brand-logo-preview-ar-SA")
      .getAttribute("src");
    first.unmount();

    renderWith({
      assets: [{ ...asset("ar-SA"), updatedAt: "2026-08-26T09:30:00.000Z" }],
      complete: false,
      published: false,
    });
    const after = screen
      .getByTestId("brand-logo-preview-ar-SA")
      .getAttribute("src");

    expect(after).not.toBe(before);
    // Still the same route and the same language — only the version
    // marker moved.
    expect(after).toContain("/api/v1/admin/branding/logo/image");
    expect(after).toContain("locale=ar-SA");
  });

  it("asks the API origin, not the page's own", () => {
    // A relative path here would ask Next.js for a route it does not
    // have and hand an HTML 404 page to an <img> — which is exactly
    // what the visitor header was doing.
    renderWith(view(["ar-SA"]));

    const src =
      screen.getByTestId("brand-logo-preview-ar-SA").getAttribute("src") ?? "";
    expect(src.startsWith("http")).toBe(true);
  });
});

describe("a failure is named by the step it happened at", () => {
  async function uploadFailing(error: unknown) {
    const user = userEvent.setup();
    vi.spyOn(api, "uploadFile").mockRejectedValue(error);
    renderWith(view([]));
    await user.upload(pickerFor("ar-SA"), file());
    return (await screen.findByTestId("brand-logo-stage")).textContent ?? "";
  }

  const apiFailure = (code: ErrorCode, status = 400) =>
    new ApiError({
      kind: status >= 500 ? "server" : "validation",
      status,
      code,
      requestId: "req-1",
      message: "server-side detail",
    });

  it("calls a REFUSED FILE an upload failure", async () => {
    expect(
      await uploadFailing(apiFailure(ERROR_CODES.BRAND_LOGO_TOO_LARGE)),
    ).toBe(B.logoStageUpload);
  });

  it("calls a server-side failure on the same request a SAVE failure", async () => {
    // The file was acceptable and the system was not: the same file will
    // work on a retry, which is a different thing to tell the operator.
    expect(
      await uploadFailing(apiFailure(ERROR_CODES.INTERNAL_ERROR, 500)),
    ).toBe(B.logoStageSave);
  });

  it("calls a failed publish a PUBLISH failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.apiClient, "post").mockRejectedValue(
      apiFailure(ERROR_CODES.VALIDATION_FAILED),
    );

    renderWith(view(["ar-SA", "en-SA"]));
    await user.click(screen.getByTestId("brand-logo-publish"));

    expect((await screen.findByTestId("brand-logo-stage")).textContent).toBe(
      B.logoStagePublish,
    );
  });

  it("calls a failed delete a DELETE failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.apiClient, "delete").mockRejectedValue(
      apiFailure(ERROR_CODES.INTERNAL_ERROR, 500),
    );

    renderWith(view(["ar-SA", "en-SA"]));
    await user.click(screen.getByTestId("brand-logo-delete"));
    await user.click(screen.getByTestId("brand-logo-delete-confirmed"));

    expect((await screen.findByTestId("brand-logo-stage")).textContent).toBe(
      B.logoStageDelete,
    );
  });

  it("gives the five stages five DIFFERENT sentences", async () => {
    // One sentence for every failure is what sent the last investigation
    // looking at the file when the file was fine.
    const seen = new Set<string>();

    seen.add(await uploadFailing(apiFailure(ERROR_CODES.BRAND_LOGO_TOO_LARGE)));
    cleanup();
    seen.add(await uploadFailing(apiFailure(ERROR_CODES.INTERNAL_ERROR, 500)));
    cleanup();

    renderWith(view(["ar-SA"]));
    fireEvent.error(screen.getByTestId("brand-logo-preview-ar-SA"));
    seen.add(screen.getByTestId("brand-logo-stage").textContent ?? "");
    cleanup();

    seen.add(B.logoStagePublish);
    seen.add(B.logoStageDelete);

    expect(seen.size).toBe(5);
  });

  it("keeps the reference on a server failure, and needs none for a preview", async () => {
    const withReference = renderWith(view([]));
    withReference.unmount();

    await uploadFailing(apiFailure(ERROR_CODES.BRAND_LOGO_TOO_LARGE));
    expect(screen.getByTestId("brand-logo-failure").textContent).toContain(
      "req-1",
    );
    cleanup();

    // A preview failure never reached the server, so there is no
    // reference to quote and none is invented.
    renderWith(view(["ar-SA"]));
    fireEvent.error(screen.getByTestId("brand-logo-preview-ar-SA"));
    expect(screen.getByTestId("brand-logo-failure").textContent).not.toContain(
      "req-",
    );
  });
});

describe("staged is not the same as live", () => {
  it("says there are unpublished changes while the set is not published", () => {
    renderWith(view(["ar-SA", "en-SA"]));

    expect(screen.getByTestId("brand-logo-draft-notice").textContent).toBe(
      B.logoDraftNotice,
    );
  });

  it("says it for a half-uploaded set too", () => {
    renderWith(view(["ar-SA"]));

    expect(screen.getByTestId("brand-logo-draft-notice")).toBeTruthy();
  });

  it("says nothing once the set is live", () => {
    renderWith(view(["ar-SA", "en-SA"], "2026-08-25T01:00:00.000Z"));

    expect(screen.queryByTestId("brand-logo-draft-notice")).toBeNull();
  });

  it("says nothing when there is nothing to publish", () => {
    renderWith(view([]));

    expect(screen.queryByTestId("brand-logo-draft-notice")).toBeNull();
  });
});
