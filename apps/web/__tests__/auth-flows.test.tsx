import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES } from "@platform/types";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}));

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
  return { error: { code, message: "internal developer text" }, requestId, timestamp: "t" };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  replace.mockClear();
  refresh.mockClear();

  // Set the property ON jsdom's window rather than replacing window.
  // Replacing it detaches `window.document`, which is what waitFor uses
  // as its default container — the whole DOM then looks undefined.
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
    writable: true,
  });
});

describe("login", () => {
  it("submits the commercial registration number and password", async () => {
    fetchMock.mockImplementation(jsonResponse(200, { companyId: "c1", accountType: "TRADER" }));
    renderWithIntl(<LoginForm locale="en-SA" />);

    await userEvent.type(screen.getByLabelText(/commercial registration number/i), "1010101010");
    await userEvent.type(screen.getByLabelText(/password/i), "a-strong-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/auth/login");
    expect(JSON.parse(init.body)).toEqual({
      crNumber: "1010101010",
      password: "a-strong-passphrase",
    });
  });

  it("asks for NO one-time code anywhere in the form", () => {
    renderWithIntl(<LoginForm locale="en-SA" />);

    for (const pattern of [/otp/i, /one.time/i, /verification code/i, /2fa/i, /authenticator/i]) {
      expect(screen.queryByLabelText(pattern)).toBeNull();
    }
    // Exactly two inputs: CR number and password.
    expect(document.querySelectorAll("input")).toHaveLength(2);
  });

  it("sends credentials so the HttpOnly cookie is set, and never reads it", async () => {
    fetchMock.mockImplementation(jsonResponse(200, {}));
    renderWithIntl(<LoginForm locale="en-SA" />);

    await userEvent.type(screen.getByLabelText(/commercial registration/i), "1010101010");
    await userEvent.type(screen.getByLabelText(/password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });

  it("lets the SERVER decide the destination after signing in", async () => {
    fetchMock.mockImplementation(jsonResponse(200, { accountType: "SUPPLIER" }));
    renderWithIntl(<LoginForm locale="en-SA" />);

    await userEvent.type(screen.getByLabelText(/commercial registration/i), "1010101010");
    await userEvent.type(screen.getByLabelText(/password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    // It does NOT route by the returned accountType — it refreshes and
    // lets the server's layouts decide.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith("/en-SA");
  });

  it("shows the translated message for bad credentials, never the internal text", async () => {
    fetchMock.mockImplementation(jsonResponse(401, envelope(ERROR_CODES.INVALID_CREDENTIALS)));
    renderWithIntl(<LoginForm locale="en-SA" />);

    await userEvent.type(screen.getByLabelText(/commercial registration/i), "1010101010");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/incorrect/i);
    expect(alert).not.toHaveTextContent("internal developer text");
  });

  it("announces failures in an assertive live region", async () => {
    fetchMock.mockImplementation(jsonResponse(401, envelope(ERROR_CODES.INVALID_CREDENTIALS)));
    const { container } = renderWithIntl(<LoginForm locale="en-SA" />);

    expect(container.querySelector('[aria-live="assertive"]')).not.toBeNull();

    await userEvent.type(screen.getByLabelText(/commercial registration/i), "1");
    await userEvent.type(screen.getByLabelText(/password/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await screen.findByRole("alert");
  });

  it("shows the generic message for an unknown code", async () => {
    fetchMock.mockImplementation(jsonResponse(500, envelope("SOMETHING_NEW")));
    renderWithIntl(<LoginForm locale="en-SA" />);

    await userEvent.type(screen.getByLabelText(/commercial registration/i), "1");
    await userEvent.type(screen.getByLabelText(/password/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unexpected error/i);
    expect(alert).not.toHaveTextContent("SOMETHING_NEW");
  });
});

describe("registration", () => {
  const cities = [{ id: "city-1", nameAr: "الرياض", nameEn: "Riyadh" }];
  // A policy's display name is resolved from its document CODE by the
  // page before it reaches the form, so the option carries one already-
  // localised title rather than a bilingual pair.
  const policies = [{ id: "policy-1", title: "Terms" }];

  function renderForm() {
    return renderWithIntl(
      <RegisterForm locale="en-SA" accountType="TRADER" cities={cities} policies={policies} />
    );
  }

  async function fillEverythingExceptLocation() {
    await userEvent.type(screen.getByLabelText(/commercial registration/i), "1010101010");
    await userEvent.type(screen.getByLabelText(/legal company name/i), "Example Co");
    await userEvent.type(screen.getByLabelText(/email address/i), "owner@example.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "a-strong-passphrase");
    await userEvent.type(screen.getByLabelText(/primary mobile/i), "0500000000");
    await userEvent.type(screen.getByLabelText(/secondary mobile/i), "0500000001");
    await userEvent.selectOptions(screen.getByLabelText(/city/i), "city-1");
    await userEvent.type(screen.getByLabelText(/short address/i), "ABCD1234");
    await userEvent.click(screen.getByRole("checkbox"));
  }

  it("asks for NO one-time code", () => {
    renderForm();

    for (const pattern of [/otp/i, /one.time/i, /verification code/i]) {
      expect(screen.queryByLabelText(pattern)).toBeNull();
    }
  });

  it("BLOCKS submission until real coordinates exist", async () => {
    renderForm();
    await fillEverythingExceptLocation();

    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
    expect(screen.getByText(/location is required/i)).toBeInTheDocument();
  });

  it("enables submission once coordinates are entered manually", async () => {
    renderForm();
    await fillEverythingExceptLocation();

    await userEvent.click(screen.getByRole("button", { name: /enter coordinates manually/i }));
    await userEvent.type(screen.getByLabelText(/latitude/i), "24.7136");
    await userEvent.type(screen.getByLabelText(/longitude/i), "46.6753");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /create account/i })).toBeEnabled()
    );
  });

  it("refuses out-of-range manual coordinates and keeps submission blocked", async () => {
    renderForm();
    await fillEverythingExceptLocation();

    await userEvent.click(screen.getByRole("button", { name: /enter coordinates manually/i }));
    await userEvent.type(screen.getByLabelText(/latitude/i), "999");
    await userEvent.type(screen.getByLabelText(/longitude/i), "46.6");

    expect(await screen.findByText(/between -90 and 90/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
  });

  it("blocks submission until every policy is accepted", async () => {
    renderForm();
    await fillEverythingExceptLocation();
    await userEvent.click(screen.getByRole("button", { name: /enter coordinates manually/i }));
    await userEvent.type(screen.getByLabelText(/latitude/i), "24.7");
    await userEvent.type(screen.getByLabelText(/longitude/i), "46.6");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /create account/i })).toBeEnabled()
    );

    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
  });

  it("posts the coordinates it actually captured", async () => {
    fetchMock.mockImplementation(jsonResponse(201, { companyId: "c1" }));
    renderForm();
    await fillEverythingExceptLocation();
    await userEvent.click(screen.getByRole("button", { name: /enter coordinates manually/i }));
    await userEvent.type(screen.getByLabelText(/latitude/i), "24.7136");
    await userEvent.type(screen.getByLabelText(/longitude/i), "46.6753");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.latitude).toBe(24.7136);
    expect(body.longitude).toBe(46.6753);
    expect(body.acceptedPolicyVersionIds).toEqual(["policy-1"]);
    expect(body.cityId).toBe("city-1");
  });

  it("targets the supplier endpoint when registering as a supplier", async () => {
    fetchMock.mockImplementation(jsonResponse(201, {}));
    renderWithIntl(
      <RegisterForm locale="en-SA" accountType="SUPPLIER" cities={cities} policies={policies} />
    );
    await fillEverythingExceptLocation();
    await userEvent.click(screen.getByRole("button", { name: /enter coordinates manually/i }));
    await userEvent.type(screen.getByLabelText(/latitude/i), "24.7");
    await userEvent.type(screen.getByLabelText(/longitude/i), "46.6");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/register/supplier");
  });

  describe("the neutral registration conflict", () => {
    async function submitIntoConflict() {
      fetchMock.mockImplementation(
        jsonResponse(409, envelope(ERROR_CODES.REGISTRATION_CONFLICT, "req-conflict"))
      );
      renderForm();
      await fillEverythingExceptLocation();
      await userEvent.click(screen.getByRole("button", { name: /enter coordinates manually/i }));
      await userEvent.type(screen.getByLabelText(/latitude/i), "24.7");
      await userEvent.type(screen.getByLabelText(/longitude/i), "46.6");
      await userEvent.click(screen.getByRole("button", { name: /create account/i }));
      return screen.findByRole("alert");
    }

    it("shows the neutral message", async () => {
      const alert = await submitIntoConflict();

      expect(alert).toHaveTextContent(/could not be completed with these details/i);
    });

    it("never hints at WHICH detail conflicted", async () => {
      const alert = await submitIntoConflict();
      const text = alert.textContent ?? "";

      expect(text).not.toMatch(/commercial registration number is already/i);
      expect(text).not.toMatch(/email.*already registered/i);
      expect(text).not.toMatch(/taken/i);
      expect(text).not.toContain("internal developer text");
    });

    it("offers sign-in and recover-access routes", async () => {
      await submitIntoConflict();

      expect(screen.getByRole("link", { name: /sign in instead/i })).toHaveAttribute(
        "href",
        "/en-SA/login"
      );
      expect(screen.getByRole("link", { name: /recover access/i })).toHaveAttribute(
        "href",
        "/en-SA/forgot-password"
      );
    });

    it("shows the request id for support", async () => {
      const alert = await submitIntoConflict();

      expect(alert).toHaveTextContent("req-conflict");
    });
  });
});
