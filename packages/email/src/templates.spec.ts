import {
  DEFAULT_EMAIL_LOCALE,
  EMAIL_LOCALES,
  EMAIL_PARAM_KEYS,
  EMAIL_TEMPLATE_IDS,
  TEMPLATE_PARAM_KEYS,
  escapeHtml,
  isEmailTemplateId,
  renderEmail,
} from "./templates";

describe("the template registry", () => {
  it("covers the thirteen email-emitting notification types from the event matrix", () => {
    // The plan's summary line says eleven; the matrix itself lists
    // thirteen. The matrix names individual events and is authoritative.
    expect(EMAIL_TEMPLATE_IDS).toHaveLength(13);
  });

  it("contains no duplicates", () => {
    expect(new Set(EMAIL_TEMPLATE_IDS).size).toBe(EMAIL_TEMPLATE_IDS.length);
  });

  it("declares allowed params for every template", () => {
    for (const id of EMAIL_TEMPLATE_IDS) {
      expect(TEMPLATE_PARAM_KEYS[id]).toBeDefined();
    }
  });

  it("only ever whitelists globally permitted param keys", () => {
    for (const id of EMAIL_TEMPLATE_IDS) {
      for (const key of TEMPLATE_PARAM_KEYS[id]) {
        expect(EMAIL_PARAM_KEYS).toContain(key);
      }
    }
  });

  it("whitelists no identity, bank or evidence field anywhere", () => {
    const forbidden = ["iban", "email", "recipientEmail", "bankAccount", "evidence", "companyName"];
    const all = JSON.stringify(TEMPLATE_PARAM_KEYS).toLowerCase();

    for (const field of forbidden) expect(all).not.toContain(field.toLowerCase());
  });

  it("recognises its own ids and rejects others", () => {
    expect(isEmailTemplateId("PAYMENT_SUCCEEDED")).toBe(true);
    expect(isEmailTemplateId("ALLOCATION_READY")).toBe(false);
    expect(isEmailTemplateId("")).toBe(false);
  });
});

describe("locale", () => {
  it("ships both locales", () => {
    expect([...EMAIL_LOCALES]).toEqual(["ar-SA", "en-SA"]);
  });

  it("defaults to Arabic, because User carries no locale preference", () => {
    expect(DEFAULT_EMAIL_LOCALE).toBe("ar-SA");
  });

  it.each(EMAIL_LOCALES)("renders every template in %s", (locale) => {
    for (const id of EMAIL_TEMPLATE_IDS) {
      const rendered = renderEmail(id, locale, {});

      expect(rendered.subject.trim().length).toBeGreaterThan(0);
      expect(rendered.htmlBody.trim().length).toBeGreaterThan(0);
      expect(rendered.textBody.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives Arabic and English different subjects", () => {
    expect(renderEmail("ORDER_CREATED", "ar-SA", {}).subject).not.toBe(
      renderEmail("ORDER_CREATED", "en-SA", {}).subject
    );
  });

  it("sets the text direction for Arabic", () => {
    expect(renderEmail("ORDER_CREATED", "ar-SA", {}).htmlBody).toContain('dir="rtl"');
    expect(renderEmail("ORDER_CREATED", "en-SA", {}).htmlBody).toContain('dir="ltr"');
  });
});

describe("parameters are injected as escaped text, never as markup", () => {
  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
  ])("escapes %s", (raw, encoded) => {
    expect(escapeHtml(raw)).toBe(encoded);
  });

  it("escapes ampersands first, so entities are not double-encoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("renders an injected script tag as text", () => {
    const rendered = renderEmail("ORDER_CREATED", "en-SA", {
      orderId: "<script>alert(1)</script>",
    });

    expect(rendered.htmlBody).not.toContain("<script>");
    expect(rendered.htmlBody).toContain("&lt;script&gt;");
  });

  it("renders an injected attribute break as text", () => {
    const rendered = renderEmail("ORDER_CREATED", "en-SA", {
      orderId: '" onload="alert(1)',
    });

    expect(rendered.htmlBody).not.toContain('onload="alert(1)"');
    expect(rendered.htmlBody).toContain("&quot;");
  });

  it("leaves the text body unescaped, which is correct for text/plain", () => {
    const rendered = renderEmail("ORDER_CREATED", "en-SA", { orderId: "<b>" });

    expect(rendered.textBody).toContain("<b>");
    expect(rendered.htmlBody).toContain("&lt;b&gt;");
  });

  it("evaluates no embedded expression from a parameter", () => {
    const rendered = renderEmail("ORDER_CREATED", "en-SA", { orderId: "${process.env.SECRET}" });

    expect(rendered.textBody).toContain("${process.env.SECRET}");
  });
});

describe("missing parameters degrade instead of throwing", () => {
  it("renders a placeholder for an absent value", () => {
    expect(renderEmail("ORDER_CREATED", "en-SA", {}).textBody).toContain("—");
  });

  it("renders an amount without a currency", () => {
    const rendered = renderEmail("SETTLEMENT_EXECUTED", "en-SA", { amount: "500.00" });

    expect(rendered.textBody).toContain("500.00");
  });

  it("renders an amount with its currency when both are present", () => {
    const rendered = renderEmail("SETTLEMENT_EXECUTED", "en-SA", {
      amount: "500.00",
      currency: "SAR",
    });

    expect(rendered.textBody).toContain("500.00 SAR");
  });
});
