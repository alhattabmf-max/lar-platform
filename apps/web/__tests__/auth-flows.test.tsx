import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES } from "@platform/types";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";

const read = (relative: string) =>
  readFileSync(join(__dirname, "..", relative), "utf8");

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}));

const messages = JSON.parse(
  readFileSync(join(__dirname, "..", "messages", "en-SA.json"), "utf8"),
);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en-SA" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function jsonResponse(status: number, body: unknown) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
}

function envelope(code: string, requestId = "req-1") {
  return {
    error: { code, message: "internal developer text" },
    requestId,
    timestamp: "t",
  };
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
    fetchMock.mockImplementation(
      jsonResponse(200, { companyId: "c1", accountType: "TRADER" }),
    );
    renderWithIntl(<LoginForm locale="en-SA" />);

    await userEvent.type(
      screen.getByLabelText(/commercial registration number/i),
      "1010101010",
    );
    await userEvent.type(
      screen.getByLabelText(/password/i),
      "a-strong-passphrase",
    );
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

    for (const pattern of [
      /otp/i,
      /one.time/i,
      /verification code/i,
      /2fa/i,
      /authenticator/i,
    ]) {
      expect(screen.queryByLabelText(pattern)).toBeNull();
    }
    // Exactly two inputs: CR number and password.
    expect(document.querySelectorAll("input")).toHaveLength(2);
  });

  it("sends credentials so the HttpOnly cookie is set, and never reads it", async () => {
    fetchMock.mockImplementation(jsonResponse(200, {}));
    renderWithIntl(<LoginForm locale="en-SA" />);

    await userEvent.type(
      screen.getByLabelText(/commercial registration/i),
      "1010101010",
    );
    await userEvent.type(screen.getByLabelText(/password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });

  /**
   * WHERE SIGNING IN LANDS.
   *
   * It used to land on the PUBLIC HOME PAGE — `replace("/en-SA")` —
   * for everybody, which is why a new account could sign in
   * successfully and still never find its portal. The destination is
   * now asked of the server: the login response says which kind of
   * account it is, and `/me` says whether the profile is finished.
   */
  function loginAnswers(me: {
    company: { accountType: string };
    profileComplete: boolean;
  }) {
    return (url: string) =>
      url.includes("/me")
        ? jsonResponse(200, me)()
        : jsonResponse(200, {
            companyId: "c1",
            accountType: me.company.accountType,
          })();
  }

  const COMPLETE_TRADER = {
    userId: "u",
    email: "e@example.com",
    emailVerificationStatus: "VERIFIED",
    role: "OWNER",
    status: "ACTIVE",
    company: {
      id: "c1",
      crNumber: "1010101010",
      legalName: "L",
      accountType: "TRADER",
      verificationStatus: "VERIFIED",
    },
    profileComplete: true,
  };

  async function signIn() {
    await userEvent.type(
      screen.getByLabelText(/commercial registration/i),
      "1010101010",
    );
    await userEvent.type(screen.getByLabelText(/password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
  }

  it("sends a buyer with a finished profile to the BUYER portal", async () => {
    fetchMock.mockImplementation(loginAnswers(COMPLETE_TRADER));
    renderWithIntl(<LoginForm locale="en-SA" />);
    await signIn();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en-SA/trader"));
    expect(refresh).toHaveBeenCalled();
  });

  it("sends a supplier with a finished profile to the SUPPLIER portal", async () => {
    fetchMock.mockImplementation(
      loginAnswers({
        ...COMPLETE_TRADER,
        company: { ...COMPLETE_TRADER.company, accountType: "SUPPLIER" },
      }),
    );
    renderWithIntl(<LoginForm locale="en-SA" />);
    await signIn();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/en-SA/supplier"),
    );
  });

  /**
   * AN INCOMPLETE RECORD CHANGES NOTHING ABOUT WHERE SIGNING IN LANDS.
   *
   * There was, for one batch, a separate «إكمال الملف الشخصي» page that
   * a company with no branch was sent to before it could reach anything
   * — which meant the one screen it was allowed to see was a form. That
   * page is gone: the record is completed from a section INSIDE the
   * portal, and the dashboard says what is still missing.
   */
  it("sends an UNFINISHED record to the portal like any other, either kind", async () => {
    for (const [accountType, portal] of [
      ["TRADER", "/en-SA/trader"],
      ["SUPPLIER", "/en-SA/supplier"],
    ] as const) {
      replace.mockClear();
      fetchMock.mockImplementation(
        loginAnswers({
          ...COMPLETE_TRADER,
          company: { ...COMPLETE_TRADER.company, accountType },
          profileComplete: false,
        }),
      );
      const view = renderWithIntl(<LoginForm locale="en-SA" />);
      await signIn();

      await waitFor(() => expect(replace).toHaveBeenCalledWith(portal));
      view.unmount();
    }
  });

  it("honours returnTo even while the record is unfinished", async () => {
    // Nothing about the portal is withheld for it, so there is nothing
    // to bounce a bookmark back from.
    fetchMock.mockImplementation(
      loginAnswers({ ...COMPLETE_TRADER, profileComplete: false }),
    );
    renderWithIntl(
      <LoginForm locale="en-SA" returnTo="/en-SA/trader/orders" />,
    );
    await signIn();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/en-SA/trader/orders"),
    );
  });

  it("goes to no separate completion page, ever", () => {
    const source = read("components/auth/login-form.tsx");

    expect(source).not.toContain("complete-profile");
    expect(source).not.toContain("completeProfilePath");
  });

  it("honours returnTo once the profile IS finished", async () => {
    fetchMock.mockImplementation(loginAnswers(COMPLETE_TRADER));
    renderWithIntl(
      <LoginForm locale="en-SA" returnTo="/en-SA/trader/orders" />,
    );
    await signIn();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/en-SA/trader/orders"),
    );
  });

  it("shows the translated message for bad credentials, never the internal text", async () => {
    fetchMock.mockImplementation(
      jsonResponse(401, envelope(ERROR_CODES.INVALID_CREDENTIALS)),
    );
    renderWithIntl(<LoginForm locale="en-SA" />);

    await userEvent.type(
      screen.getByLabelText(/commercial registration/i),
      "1010101010",
    );
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/incorrect/i);
    expect(alert).not.toHaveTextContent("internal developer text");
  });

  it("announces failures in an assertive live region", async () => {
    fetchMock.mockImplementation(
      jsonResponse(401, envelope(ERROR_CODES.INVALID_CREDENTIALS)),
    );
    const { container } = renderWithIntl(<LoginForm locale="en-SA" />);

    expect(container.querySelector('[aria-live="assertive"]')).not.toBeNull();

    await userEvent.type(
      screen.getByLabelText(/commercial registration/i),
      "1",
    );
    await userEvent.type(screen.getByLabelText(/password/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await screen.findByRole("alert");
  });

  it("shows the generic message for an unknown code", async () => {
    fetchMock.mockImplementation(jsonResponse(500, envelope("SOMETHING_NEW")));
    renderWithIntl(<LoginForm locale="en-SA" />);

    await userEvent.type(
      screen.getByLabelText(/commercial registration/i),
      "1",
    );
    await userEvent.type(screen.getByLabelText(/password/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unexpected error/i);
    expect(alert).not.toHaveTextContent("SOMETHING_NEW");
  });
});

describe("registration", () => {
  /**
   * The two published versions, exactly as the page hands them down.
   *
   * Each carries its OWN id — the version id, which is what an
   * acceptance references — so a test can prove that agreeing once
   * records both documents separately rather than collapsing them into
   * a single consent.
   */
  const policies = [
    {
      id: "version-terms-3",
      documentCode: "terms_of_service",
      title: "Terms of service",
      versionLabel: "3.0",
      text: "The full terms of service text.",
    },
    {
      id: "version-privacy-2",
      documentCode: "privacy_policy",
      title: "Privacy policy",
      versionLabel: "2.1",
      text: "The full privacy policy text.",
    },
  ];

  const labels = {
    accountType: {
      legend: "Account type",
      trader: "Buyer",
      traderHint: "I buy from the offers listed.",
      supplier: "Supplier",
      supplierHint: "I list my products for sale.",
    },
    policiesDialog: {
      title: "Policies and terms",
      close: "Close",
      version: "Version",
      unavailable: "Policies could not be loaded.",
    },
  };

  function renderForm() {
    return renderWithIntl(
      <RegisterForm locale="en-SA" policies={policies} labels={labels} />,
    );
  }

  /** Every text field. Deliberately NOT the type and NOT the consent. */
  async function fillTheFields() {
    await userEvent.type(
      screen.getByLabelText(/commercial registration/i),
      "1010101010",
    );
    await userEvent.type(
      screen.getByLabelText(/legal company name/i),
      "Example Co",
    );
    await userEvent.type(
      screen.getByLabelText(/email address/i),
      "owner@example.com",
    );
    await userEvent.type(
      screen.getByLabelText(/^password/i),
      "a-strong-passphrase",
    );
    await userEvent.type(
      screen.getByLabelText(/contact number/i),
      "0500000000",
    );
  }

  const submitButton = () =>
    screen.getByRole("button", { name: /create account/i });

  it("asks for NO one-time code", () => {
    renderForm();

    for (const pattern of [/otp/i, /one.time/i, /verification code/i]) {
      expect(screen.queryByLabelText(pattern)).toBeNull();
    }
  });

  // ---- 3. no location fields in the initial registration -------------

  it("asks for NOTHING about a location", () => {
    renderForm();

    for (const pattern of [
      /city/i,
      /short address/i,
      /national address/i,
      /branch/i,
      /latitude/i,
      /longitude/i,
      /google maps/i,
      /map link/i,
      /contact person/i,
    ]) {
      expect(screen.queryByLabelText(pattern)).toBeNull();
    }

    // Nor a control for one under any other name: no select at all,
    // exactly two radios, exactly one checkbox.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("names no coordinate and no location anywhere in its text", () => {
    const { container } = renderForm();
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/coordinate/i);
    expect(text).not.toMatch(/location/i);
  });

  // ---- 1 & 2. the account type is chosen, never assumed --------------

  it("starts with NEITHER account type selected", () => {
    renderForm();

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }
  });

  it("blocks submission until an account type is chosen", async () => {
    renderForm();
    await fillTheFields();
    await userEvent.click(screen.getByRole("checkbox"));

    // Everything else is done. The type alone is missing.
    expect(submitButton()).toBeDisabled();

    await userEvent.click(screen.getByTestId("account-type-TRADER"));
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it("posts to the BUYER endpoint when buyer is chosen", async () => {
    fetchMock.mockImplementation(jsonResponse(201, { companyId: "c1" }));
    renderForm();
    await fillTheFields();
    await userEvent.click(screen.getByTestId("account-type-TRADER"));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(submitButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/register/trader");
  });

  it("posts to the SUPPLIER endpoint when supplier is chosen", async () => {
    fetchMock.mockImplementation(jsonResponse(201, { companyId: "c1" }));
    renderForm();
    await fillTheFields();
    await userEvent.click(screen.getByTestId("account-type-SUPPLIER"));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(submitButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/register/supplier");
  });

  it("sends NO location field in the body", async () => {
    fetchMock.mockImplementation(jsonResponse(201, { companyId: "c1" }));
    renderForm();
    await fillTheFields();
    await userEvent.click(screen.getByTestId("account-type-TRADER"));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(submitButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    for (const key of [
      "cityId",
      "shortAddress",
      "latitude",
      "longitude",
      "mapUrl",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(Object.keys(body).sort()).toEqual(
      [
        "acceptedPolicyVersionIds",
        "crNumber",
        "email",
        "legalName",
        "password",
        "primaryMobile1",
      ].sort(),
    );
  });

  it("creates NO session of its own — it posts once and goes to login", async () => {
    fetchMock.mockImplementation(jsonResponse(201, { companyId: "c1" }));
    renderForm();
    await fillTheFields();
    await userEvent.click(screen.getByTestId("account-type-TRADER"));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(submitButton());

    await waitFor(() => expect(replace).toHaveBeenCalled());
    // Registering does not sign anybody in: exactly one request was
    // made — the registration itself — and the destination is login.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toContain("/login");
  });

  // ---- 2 & 3. one number, and nothing that can wait ------------------

  it("asks for exactly ONE contact number, and it is required", () => {
    renderForm();

    expect(screen.getByLabelText(/contact number/i)).toBeInTheDocument();
    // No second one under any wording.
    for (const pattern of [
      /secondary mobile/i,
      /second number/i,
      /primary mobile/i,
    ]) {
      expect(screen.queryByLabelText(pattern)).toBeNull();
    }
  });

  it("asks for NO contact person's name", () => {
    // A named contact is a detail of the company's record, collected —
    // optionally, and only as a pair with its number — from «بيانات
    // المنشأة» inside the portal.
    renderForm();

    for (const pattern of [
      /contact name/i,
      /contact person/i,
      /مسؤول التواصل/,
    ]) {
      expect(screen.queryByLabelText(pattern)).toBeNull();
    }
  });

  it("asks for NO bank account", () => {
    renderForm();

    for (const pattern of [/iban/i, /bank/i, /حساب بنكي/]) {
      expect(screen.queryByLabelText(pattern)).toBeNull();
    }
  });

  it("blocks submission until the one number is given", async () => {
    renderForm();
    await userEvent.type(
      screen.getByLabelText(/commercial registration/i),
      "1010101010",
    );
    await userEvent.type(
      screen.getByLabelText(/legal company name/i),
      "Example Co",
    );
    await userEvent.type(
      screen.getByLabelText(/email address/i),
      "owner@example.com",
    );
    await userEvent.type(
      screen.getByLabelText(/^password/i),
      "a-strong-passphrase",
    );
    await userEvent.click(screen.getByTestId("account-type-TRADER"));
    await userEvent.click(screen.getByRole("checkbox"));

    expect(submitButton()).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/contact number/i),
      "0500000000",
    );
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  // ---- 5, 6, 7. one button, two tabs, nothing lost -------------------

  it("offers exactly ONE policies button, and the word 'read' is not in it", () => {
    renderForm();

    const button = screen.getByTestId("open-policies");
    expect(button).toHaveTextContent("Policies and terms");
    expect(button.textContent).not.toMatch(/read/i);

    // One control, not one per document.
    expect(screen.queryAllByTestId("open-policies")).toHaveLength(1);
  });

  it("opens ONE dialog carrying BOTH documents in two tabs", async () => {
    renderForm();
    await userEvent.click(screen.getByTestId("open-policies"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent("Terms of service");
    expect(tabs[1]).toHaveTextContent("Privacy policy");

    // The terms are showing; the privacy policy is present but hidden.
    expect(
      screen.getByTestId("policy-panel-terms_of_service"),
    ).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("policy-panel-privacy_policy")).toHaveAttribute(
      "hidden",
    );

    await userEvent.click(tabs[1]);
    expect(
      screen.getByTestId("policy-panel-privacy_policy"),
    ).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("policy-panel-privacy_policy")).toHaveTextContent(
      "The full privacy policy text.",
    );
  });

  it("KEEPS every typed value across opening and closing the dialog", async () => {
    renderForm();
    await fillTheFields();
    await userEvent.click(screen.getByTestId("account-type-SUPPLIER"));

    await userEvent.click(screen.getByTestId("open-policies"));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByTestId("policies-close"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(screen.getByLabelText(/commercial registration/i)).toHaveValue(
      "1010101010",
    );
    expect(screen.getByLabelText(/legal company name/i)).toHaveValue(
      "Example Co",
    );
    expect(screen.getByLabelText(/email address/i)).toHaveValue(
      "owner@example.com",
    );
    expect(screen.getByLabelText(/^password/i)).toHaveValue(
      "a-strong-passphrase",
    );
    expect(screen.getByLabelText(/contact number/i)).toHaveValue("0500000000");
    expect(screen.getByTestId("account-type-SUPPLIER")).toBeChecked();
  });

  it("closes on Escape, and returns focus to the button that opened it", async () => {
    renderForm();
    const button = screen.getByTestId("open-policies");
    await userEvent.click(button);
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("moves focus INTO the dialog when it opens", async () => {
    renderForm();
    await userEvent.click(screen.getByTestId("open-policies"));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
  });

  it("uses no window.alert and no window.confirm", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);

    renderForm();
    await userEvent.click(screen.getByTestId("open-policies"));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByTestId("policies-close"));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  // ---- 8 & 9. consent -----------------------------------------------

  it("leaves the consent box unticked, and opening the dialog does not tick it", async () => {
    renderForm();
    expect(screen.getByRole("checkbox")).not.toBeChecked();

    await userEvent.click(screen.getByTestId("open-policies"));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByTestId("policies-close"));

    // Reading is not agreeing.
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("blocks submission until the consent box is ticked", async () => {
    renderForm();
    await fillTheFields();
    await userEvent.click(screen.getByTestId("account-type-TRADER"));

    expect(submitButton()).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(submitButton()).toBeEnabled());

    // And back again — un-ticking blocks it once more.
    await userEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(submitButton()).toBeDisabled());
  });

  it("records EACH document's version separately from the one consent", async () => {
    fetchMock.mockImplementation(jsonResponse(201, { companyId: "c1" }));
    renderForm();
    await fillTheFields();
    await userEvent.click(screen.getByTestId("account-type-TRADER"));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(submitButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);

    // TWO version ids, not one combined consent — the terms version and
    // the privacy version, each recorded against itself.
    expect(body.acceptedPolicyVersionIds).toEqual([
      "version-terms-3",
      "version-privacy-2",
    ]);
  });

  it("cannot be submitted at all when the policies failed to load", async () => {
    renderWithIntl(
      <RegisterForm locale="en-SA" policies={[]} labels={labels} />,
    );
    await fillTheFields();

    // No box to tick, and no way past it: consent that was never
    // recorded must not be assumed.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByTestId("policies-unavailable")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  // ---- 5. validation errors beside their own fields -------------------

  it("says a password is too short BESIDE the password field", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/^password/i), "short");

    const message = await screen.findByText(/at least 8 characters/i);
    const field = screen.getByLabelText(/^password/i);

    // Beside the input, wired to it — not in the banner at the bottom
    // where the request failures go.
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
    expect(submitButton()).toBeDisabled();
  });

  it("says an email is malformed BESIDE the email field", async () => {
    renderForm();
    await userEvent.type(
      screen.getByLabelText(/email address/i),
      "not-an-address",
    );

    const message = await screen.findByText(/valid email address/i);
    const field = screen.getByLabelText(/email address/i);

    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
  });

  it("says nothing at all about a field nobody has touched", async () => {
    // Marking an untouched form red is scolding somebody for not
    // having started yet.
    renderForm();

    expect(screen.queryByText(/at least 8 characters/i)).toBeNull();
    expect(screen.queryByText(/valid email address/i)).toBeNull();
    expect(screen.getByLabelText(/^password/i)).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("clears the message once the value becomes acceptable", async () => {
    renderForm();
    const field = screen.getByLabelText(/^password/i);
    await userEvent.type(field, "short");
    await screen.findByText(/at least 8 characters/i);

    await userEvent.type(field, "-enough-now");

    await waitFor(() =>
      expect(screen.queryByText(/at least 8 characters/i)).toBeNull(),
    );
  });

  // ---- 5. no standing explanation under the heading -------------------

  it("carries no standing explanation under the fields", () => {
    const { container } = renderForm();
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/you will sign in afterwards/i);
    expect(text).not.toMatch(/we need your company/i);
  });

  describe("the neutral registration conflict", () => {
    async function submitIntoConflict() {
      fetchMock.mockImplementation(
        jsonResponse(
          409,
          envelope(ERROR_CODES.REGISTRATION_CONFLICT, "req-conflict"),
        ),
      );
      renderForm();
      await fillTheFields();
      await userEvent.click(screen.getByTestId("account-type-TRADER"));
      await userEvent.click(screen.getByRole("checkbox"));
      await userEvent.click(submitButton());
      return screen.findByRole("alert");
    }

    it("shows the neutral message", async () => {
      const alert = await submitIntoConflict();

      expect(alert).toHaveTextContent(
        /could not be completed with these details/i,
      );
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

      expect(
        screen.getByRole("link", { name: /sign in instead/i }),
      ).toHaveAttribute("href", "/en-SA/login");
      expect(
        screen.getByRole("link", { name: /recover access/i }),
      ).toHaveAttribute("href", "/en-SA/forgot-password");
    });

    it("shows the request id for support", async () => {
      const alert = await submitIntoConflict();

      expect(alert).toHaveTextContent("req-conflict");
    });
  });
});
