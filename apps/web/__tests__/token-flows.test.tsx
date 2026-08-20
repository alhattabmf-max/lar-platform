import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES, PASSWORD_MIN_LENGTH } from "@platform/types";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";

/** A value distinctive enough that any leak is unmistakable in a scan. */
const SECRET_TOKEN = "TOKEN-b4d1c0ffee-DO-NOT-LEAK";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}));

const BASE_PATH = "/en-SA/reset-password";

/** Puts a token in the address bar, as a real recovery link would. */
function setUrlWithToken(path = BASE_PATH, token: string | null = SECRET_TOKEN, extra = "") {
  const query = [token !== null ? `token=${encodeURIComponent(token)}` : "", extra]
    .filter(Boolean)
    .join("&");
  window.history.replaceState({}, "", `${path}${query ? `?${query}` : ""}`);
}

const messages = JSON.parse(
  readFileSync(join(__dirname, "..", "messages", "en-SA.json"), "utf8")
);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-SA" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

function jsonResponse(status: number, body: unknown) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    );
}

function envelope(code: string, requestId = "req-1") {
  return { error: { code, message: "Invalid or expired token" }, requestId, timestamp: "t" };
}

let fetchMock: ReturnType<typeof vi.fn>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];
let pushStateSpy: ReturnType<typeof vi.spyOn>;
let replaceStateSpy: ReturnType<typeof vi.spyOn>;

/** The URL as it stood at the moment each fetch was issued. */
let urlAtFetch: string[];

beforeEach(() => {
  urlAtFetch = [];
  fetchMock = vi.fn(() => {
    urlAtFetch.push(window.location.href);
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  replace.mockClear();
  refresh.mockClear();

  setUrlWithToken();

  // Watched so a test can prove the cleanup never adds a history entry.
  pushStateSpy = vi.spyOn(window.history, "pushState");
  replaceStateSpy = vi.spyOn(window.history, "replaceState");

  // Every console channel is watched, so a token reaching ANY logging
  // path fails the relevant test rather than passing unnoticed.
  consoleSpies = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "debug").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  consoleSpies.forEach((spy) => spy.mockRestore());
  pushStateSpy.mockRestore();
  replaceStateSpy.mockRestore();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function everythingLogged(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .flat()
    .map((arg) => {
      try {
        return typeof arg === "string" ? arg : JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

async function fillPasswords(value: string, confirmation = value) {
  await userEvent.type(screen.getByLabelText(/^new password/i), value);
  await userEvent.type(screen.getByLabelText(/confirm new password/i), confirmation);
}

describe("token URL hygiene", () => {
  it("reads the token from the URL, then removes it from the address bar", async () => {
    setUrlWithToken();
    expect(window.location.search).toContain(SECRET_TOKEN);

    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save new password/i })).toBeInTheDocument()
    );
    expect(window.location.href).not.toContain(SECRET_TOKEN);
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe(BASE_PATH);
  });

  it("cleans the URL BEFORE any fetch is issued", async () => {
    setUrlWithToken("/en-SA/verify-email");
    renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Captured at the moment of the call: no request may be made while
    // the token is still in the address bar, or it would travel in the
    // Referer.
    expect(urlAtFetch).toHaveLength(1);
    expect(urlAtFetch[0]).not.toContain(SECRET_TOKEN);
  });

  it("cleans the URL before the reset request too", async () => {
    setUrlWithToken();
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(urlAtFetch[0]).not.toContain(SECRET_TOKEN);
  });

  it("uses replaceState and never pushes a history entry", async () => {
    setUrlWithToken();
    pushStateSpy.mockClear();

    renderWithIntl(<ResetPasswordForm locale="en-SA" />);
    await waitFor(() => expect(window.location.search).toBe(""));

    // The back button must not be able to return to the tokened URL.
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalled();
  });

  it("performs no Next navigation for the cleanup", async () => {
    setUrlWithToken();
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await waitFor(() => expect(window.location.search).toBe(""));

    // router.replace() would issue an RSC request carrying the tokened
    // URL as its Referer — exactly what this avoids.
    expect(replace).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves other query parameters while removing only the token", async () => {
    setUrlWithToken(BASE_PATH, SECRET_TOKEN, "ref=email&lang=ar");
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await waitFor(() => expect(window.location.href).not.toContain(SECRET_TOKEN));
    expect(window.location.search).toContain("ref=email");
    expect(window.location.search).toContain("lang=ar");
    expect(window.location.search).not.toContain("token");
  });

  it("never writes the token to storage or a cookie", async () => {
    setUrlWithToken();
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await waitFor(() => expect(window.location.search).toBe(""));

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain(SECRET_TOKEN);
    expect(window.location.hash).not.toContain(SECRET_TOKEN);
    expect(window.location.pathname).not.toContain(SECRET_TOKEN);
  });

  it("keeps the token usable in memory after the URL is cleaned", async () => {
    setUrlWithToken();
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Stripped from the URL, still sent in the body.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).token).toBe(SECRET_TOKEN);
  });
});

describe("reset password", () => {
  it("sends the contract the API actually declares", async () => {
    fetchMock.mockImplementation(jsonResponse(200, { status: "ok" }));
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/auth/password/reset");
    // ResetPasswordDto is { token, newPassword } — not `password`.
    expect(JSON.parse(init.body)).toEqual({
      token: SECRET_TOKEN,
      newPassword: "a-strong-passphrase",
    });
  });

  it("never renders the token", async () => {
    const { container } = renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    expect(container.innerHTML).not.toContain(SECRET_TOKEN);
    expect(document.body.innerHTML).not.toContain(SECRET_TOKEN);
    // Not hidden in a field value either.
    for (const input of Array.from(document.querySelectorAll("input"))) {
      expect(input.value).not.toContain(SECRET_TOKEN);
      expect(input.getAttribute("value") ?? "").not.toContain(SECRET_TOKEN);
    }
  });

  it("never renders the token after a failure, and never in the message", async () => {
    fetchMock.mockImplementation(jsonResponse(400, envelope(ERROR_CODES.VALIDATION_FAILED)));
    const { container } = renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toContain(SECRET_TOKEN);
    expect(container.innerHTML).not.toContain(SECRET_TOKEN);
  });

  it("never sends the token to any logging path", async () => {
    fetchMock.mockImplementation(jsonResponse(400, envelope(ERROR_CODES.VALIDATION_FAILED)));
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));
    await screen.findByRole("alert");

    expect(everythingLogged()).not.toContain(SECRET_TOKEN);
  });

  it("blocks the request entirely when the token is missing", async () => {
    setUrlWithToken(BASE_PATH, null);
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/needs a recovery link/i);
    // No form at all — there is nothing to submit.
    expect(screen.queryByRole("button", { name: /save new password/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the missing-link state after a refresh, without trying to recover the token", async () => {
    // Simulates reloading the already-cleaned URL: the token is gone by
    // design, and nothing attempts to retrieve it from anywhere else.
    setUrlWithToken(BASE_PATH, null);
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/needs a recovery link/i);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain(SECRET_TOKEN);
  });

  it("blocks the request when the passwords do not match", async () => {
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase", "a-different-passphrase");

    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save new password/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the SAME minimum length the API declares", async () => {
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("x".repeat(PASSWORD_MIN_LENGTH - 1));
    expect(screen.getByRole("button", { name: /save new password/i })).toBeDisabled();
    expect(screen.getByText(new RegExp(`${PASSWORD_MIN_LENGTH} characters`))).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/^new password/i));
    await userEvent.clear(screen.getByLabelText(/confirm new password/i));
    await fillPasswords("x".repeat(PASSWORD_MIN_LENGTH));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save new password/i })).toBeEnabled()
    );
  });

  it("shows ONE generic message for invalid, used and expired links alike", async () => {
    // The API answers all three with an identical 400, so the UI cannot
    // and must not distinguish them.
    fetchMock.mockImplementation(jsonResponse(400, envelope(ERROR_CODES.VALIDATION_FAILED)));
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no longer usable/i);
    expect(alert.textContent ?? "").not.toMatch(/expired|already used|consumed/i);
  });

  it("offers a route to request a new link when the link is rejected", async () => {
    fetchMock.mockImplementation(jsonResponse(400, envelope(ERROR_CODES.VALIDATION_FAILED)));
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));

    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: /request a new recovery link/i })).toHaveAttribute(
      "href",
      "/en-SA/forgot-password"
    );
  });

  it("reveals nothing about whether an account exists", async () => {
    fetchMock.mockImplementation(jsonResponse(400, envelope(ERROR_CODES.VALIDATION_FAILED)));
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));

    const text = (await screen.findByRole("alert")).textContent ?? "";
    expect(text).not.toMatch(/account|user|email|exist/i);
  });

  it("sends the user to sign in on success", async () => {
    fetchMock.mockImplementation(jsonResponse(200, { status: "ok" }));
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    await fillPasswords("a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /save new password/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en-SA/login?reset=success"));
  });

  it("asks for no one-time code", () => {
    renderWithIntl(<ResetPasswordForm locale="en-SA" />);

    for (const pattern of [/otp/i, /one.time/i, /verification code/i, /2fa/i]) {
      expect(screen.queryByLabelText(pattern)).toBeNull();
    }
    expect(document.querySelectorAll("input")).toHaveLength(2);
  });
});

describe("verify email", () => {
  it("sends the contract the API actually declares", async () => {
    fetchMock.mockImplementation(jsonResponse(200, { status: "ok" }));
    renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/auth/email/verify");
    // VerifyEmailDto is { token } and nothing else.
    expect(JSON.parse(init.body)).toEqual({ token: SECRET_TOKEN });
  });

  it("shows a loading state first", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    expect(screen.getByRole("status")).toHaveTextContent(/verifying/i);
  });

  it("shows success and a route to sign in", async () => {
    fetchMock.mockImplementation(jsonResponse(200, { status: "ok" }));
    renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    expect(await screen.findByText(/your email address is verified/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute(
      "href",
      "/en-SA/login"
    );
  });

  it("shows ONE generic message for invalid, used and expired links alike", async () => {
    fetchMock.mockImplementation(jsonResponse(400, envelope(ERROR_CODES.VALIDATION_FAILED)));
    renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no longer usable/i);
    expect(alert.textContent ?? "").not.toMatch(/expired|already used|consumed/i);
  });

  it("shows the generic message for a non-400 failure", async () => {
    fetchMock.mockImplementation(jsonResponse(503, envelope(ERROR_CODES.SERVICE_UNAVAILABLE)));
    renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/currently unavailable/i);
  });

  it("blocks the request entirely when the token is missing", async () => {
    setUrlWithToken("/en-SA/verify-email", null);
    renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/needs a verification link/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never renders the token in any state", async () => {
    fetchMock.mockImplementation(jsonResponse(400, envelope(ERROR_CODES.VALIDATION_FAILED)));
    const { container } = renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    await screen.findByRole("alert");
    expect(container.innerHTML).not.toContain(SECRET_TOKEN);
    expect(document.body.innerHTML).not.toContain(SECRET_TOKEN);
  });

  it("never sends the token to any logging path", async () => {
    fetchMock.mockImplementation(jsonResponse(400, envelope(ERROR_CODES.VALIDATION_FAILED)));
    renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    await screen.findByRole("alert");
    expect(everythingLogged()).not.toContain(SECRET_TOKEN);
  });

  it("verifies once, even though the token is single-use", async () => {
    fetchMock.mockImplementation(jsonResponse(200, { status: "ok" }));
    const { rerender } = renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    await screen.findByText(/verified/i);
    rerender(
      <NextIntlClientProvider locale="en-SA" messages={messages}>
        <VerifyEmailPanel locale="en-SA" />
      </NextIntlClientProvider>
    );

    // A second POST would consume nothing and report a false failure.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks for no one-time code", async () => {
    fetchMock.mockImplementation(jsonResponse(200, { status: "ok" }));
    renderWithIntl(<VerifyEmailPanel locale="en-SA" />);

    await screen.findByText(/verified/i);
    expect(document.querySelectorAll("input")).toHaveLength(0);
  });
});
