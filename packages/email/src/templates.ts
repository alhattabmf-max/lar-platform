/**
 * Static, in-repo email templates — Arabic and English, reviewed as
 * source.
 *
 * No template engine that evaluates embedded expressions. Every
 * parameter is injected as ESCAPED TEXT, so a value that happens to
 * contain markup renders as characters rather than as HTML. Untrusted
 * HTML is prohibited outright.
 *
 * The template ids are exactly the notification types that emit an
 * email, per the notification event matrix. That matrix lists THIRTEEN
 * such types; a summary line elsewhere in the plan says eleven. The
 * matrix is authoritative here because it names the individual events,
 * and shipping a template for a type that turns out not to email is
 * harmless, whereas a missing one is a PAYLOAD_INVALID dead-letter.
 */

export const EMAIL_TEMPLATE_IDS = [
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "ORDER_CREATED",
  "ALLOCATION_SHIPPED",
  "MASTER_ORDER_FULFILLED",
  "DISPUTE_OPENED",
  "DISPUTE_SUPPLIER_RESPONDED",
  "DISPUTE_DECIDED",
  "REFUND_INITIATED",
  "REFUND_FAILED",
  "REPLACEMENT_REQUIRED",
  "REPLACEMENT_FAILED",
  "SETTLEMENT_EXECUTED",
] as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number];

export function isEmailTemplateId(value: string): value is EmailTemplateId {
  return (EMAIL_TEMPLATE_IDS as readonly string[]).includes(value);
}

/**
 * The whitelisted parameter keys, matching what may be stored in a
 * notification's `params`.
 *
 * Scalars only, and deliberately no counterparty settlement detail, no
 * IBAN, no bank transfer reference, no dispute evidence and no
 * counterparty identity.
 */
export const EMAIL_PARAM_KEYS = [
  "orderId",
  "allocationId",
  "disputeId",
  "amount",
  "currency",
  "count",
] as const;

export type EmailParamKey = (typeof EMAIL_PARAM_KEYS)[number];
export type EmailParams = Partial<Record<EmailParamKey, string | number>>;

/**
 * Which parameters each template is allowed to receive.
 *
 * Per-template rather than one global list: a payload carrying a
 * `disputeId` on a settlement email is malformed, and catching it at
 * validation is better than rendering an email that silently ignores
 * the field.
 */
export const TEMPLATE_PARAM_KEYS: Readonly<Record<EmailTemplateId, readonly EmailParamKey[]>> = {
  PAYMENT_SUCCEEDED: ["orderId", "amount", "currency"],
  PAYMENT_FAILED: ["orderId", "amount", "currency"],
  ORDER_CREATED: ["orderId"],
  ALLOCATION_SHIPPED: ["orderId", "allocationId"],
  MASTER_ORDER_FULFILLED: ["orderId"],
  DISPUTE_OPENED: ["orderId", "allocationId", "disputeId"],
  DISPUTE_SUPPLIER_RESPONDED: ["disputeId"],
  DISPUTE_DECIDED: ["disputeId"],
  REFUND_INITIATED: ["orderId", "amount", "currency"],
  REFUND_FAILED: ["orderId", "amount", "currency"],
  REPLACEMENT_REQUIRED: ["orderId", "allocationId"],
  REPLACEMENT_FAILED: ["orderId", "allocationId"],
  SETTLEMENT_EXECUTED: ["amount", "currency"],
};

export const EMAIL_LOCALES = ["ar-SA", "en-SA"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/**
 * The locale every relay send uses in 8D0.
 *
 * `User` carries no locale preference field — no `locale`, no
 * `preferredLanguage` — so there is nothing to read. Arabic is the
 * platform default. Adding `User.preferredLocale` is deferred and is a
 * prerequisite for the real provider.
 */
export const DEFAULT_EMAIL_LOCALE: EmailLocale = "ar-SA";

interface TemplateCopy {
  subject: string;
  /** Paragraph lines. Parameters are interpolated as escaped text. */
  lines: string[];
}

type TemplateBody = (params: EmailParams) => TemplateCopy;

/**
 * Escapes a value for HTML.
 *
 * Applied to every interpolated parameter without exception. `&` is
 * replaced first — doing it later would double-escape the entities
 * introduced by the other replacements.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function value(params: EmailParams, key: EmailParamKey): string {
  const raw = params[key];
  return raw === undefined ? "—" : String(raw);
}

function money(params: EmailParams): string {
  const amount = params.amount;
  const currency = params.currency;
  if (amount === undefined) return "—";
  return currency === undefined ? String(amount) : `${amount} ${currency}`;
}

const AR: Record<EmailTemplateId, TemplateBody> = {
  PAYMENT_SUCCEEDED: (p) => ({
    subject: "تم استلام دفعتك",
    lines: [`تم تأكيد الدفع للطلب ${value(p, "orderId")} بمبلغ ${money(p)}.`],
  }),
  PAYMENT_FAILED: (p) => ({
    subject: "لم تكتمل عملية الدفع",
    lines: [`تعذّر إتمام الدفع للطلب ${value(p, "orderId")} بمبلغ ${money(p)}.`],
  }),
  ORDER_CREATED: (p) => ({
    subject: "تم إنشاء طلبك",
    lines: [`تم إنشاء الطلب ${value(p, "orderId")}.`],
  }),
  ALLOCATION_SHIPPED: (p) => ({
    subject: "تم شحن جزء من طلبك",
    lines: [`تم شحن التخصيص ${value(p, "allocationId")} ضمن الطلب ${value(p, "orderId")}.`],
  }),
  MASTER_ORDER_FULFILLED: (p) => ({
    subject: "اكتمل تنفيذ طلبك",
    lines: [`اكتمل تنفيذ الطلب ${value(p, "orderId")} بالكامل.`],
  }),
  DISPUTE_OPENED: (p) => ({
    subject: "تم فتح نزاع",
    lines: [`فُتح النزاع ${value(p, "disputeId")} على التخصيص ${value(p, "allocationId")}.`],
  }),
  DISPUTE_SUPPLIER_RESPONDED: (p) => ({
    subject: "ورد رد على النزاع",
    lines: [`وصل رد المورد على النزاع ${value(p, "disputeId")}.`],
  }),
  DISPUTE_DECIDED: (p) => ({
    subject: "صدر قرار في النزاع",
    lines: [`صدر قرار في النزاع ${value(p, "disputeId")}.`],
  }),
  REFUND_INITIATED: (p) => ({
    subject: "بدأت عملية الاسترداد",
    lines: [`بدأ استرداد مبلغ ${money(p)} عن الطلب ${value(p, "orderId")}.`],
  }),
  REFUND_FAILED: (p) => ({
    subject: "تعذّر إتمام الاسترداد",
    lines: [`تعذّر استرداد مبلغ ${money(p)} عن الطلب ${value(p, "orderId")}.`],
  }),
  REPLACEMENT_REQUIRED: (p) => ({
    subject: "مطلوب تنفيذ بديل",
    lines: [`مطلوب بديل للتخصيص ${value(p, "allocationId")} ضمن الطلب ${value(p, "orderId")}.`],
  }),
  REPLACEMENT_FAILED: (p) => ({
    subject: "تعذّر تنفيذ البديل",
    lines: [`تعذّر تنفيذ البديل للتخصيص ${value(p, "allocationId")}.`],
  }),
  SETTLEMENT_EXECUTED: (p) => ({
    subject: "تم تنفيذ التسوية",
    lines: [`تم تنفيذ تسوية بمبلغ ${money(p)}.`],
  }),
};

const EN: Record<EmailTemplateId, TemplateBody> = {
  PAYMENT_SUCCEEDED: (p) => ({
    subject: "Your payment was received",
    lines: [`Payment for order ${value(p, "orderId")} of ${money(p)} is confirmed.`],
  }),
  PAYMENT_FAILED: (p) => ({
    subject: "Your payment did not complete",
    lines: [`Payment for order ${value(p, "orderId")} of ${money(p)} could not be completed.`],
  }),
  ORDER_CREATED: (p) => ({
    subject: "Your order was created",
    lines: [`Order ${value(p, "orderId")} has been created.`],
  }),
  ALLOCATION_SHIPPED: (p) => ({
    subject: "Part of your order has shipped",
    lines: [`Allocation ${value(p, "allocationId")} of order ${value(p, "orderId")} has shipped.`],
  }),
  MASTER_ORDER_FULFILLED: (p) => ({
    subject: "Your order is fulfilled",
    lines: [`Order ${value(p, "orderId")} is now fully fulfilled.`],
  }),
  DISPUTE_OPENED: (p) => ({
    subject: "A dispute was opened",
    lines: [`Dispute ${value(p, "disputeId")} was opened on allocation ${value(p, "allocationId")}.`],
  }),
  DISPUTE_SUPPLIER_RESPONDED: (p) => ({
    subject: "The supplier responded to a dispute",
    lines: [`A response was received on dispute ${value(p, "disputeId")}.`],
  }),
  DISPUTE_DECIDED: (p) => ({
    subject: "A dispute was decided",
    lines: [`Dispute ${value(p, "disputeId")} has been decided.`],
  }),
  REFUND_INITIATED: (p) => ({
    subject: "A refund has started",
    lines: [`A refund of ${money(p)} for order ${value(p, "orderId")} has started.`],
  }),
  REFUND_FAILED: (p) => ({
    subject: "A refund could not be completed",
    lines: [`A refund of ${money(p)} for order ${value(p, "orderId")} could not be completed.`],
  }),
  REPLACEMENT_REQUIRED: (p) => ({
    subject: "A replacement is required",
    lines: [
      `A replacement is required for allocation ${value(p, "allocationId")} of order ${value(p, "orderId")}.`,
    ],
  }),
  REPLACEMENT_FAILED: (p) => ({
    subject: "A replacement could not be completed",
    lines: [`The replacement for allocation ${value(p, "allocationId")} could not be completed.`],
  }),
  SETTLEMENT_EXECUTED: (p) => ({
    subject: "A settlement was executed",
    lines: [`A settlement of ${money(p)} has been executed.`],
  }),
};

const CATALOGUE: Record<EmailLocale, Record<EmailTemplateId, TemplateBody>> = {
  "ar-SA": AR,
  "en-SA": EN,
};

export interface RenderedEmail {
  subject: string;
  htmlBody: string;
  textBody: string;
}

/**
 * Renders a template.
 *
 * Every interpolated value passes through `escapeHtml` on its way into
 * the HTML body; the text body carries the raw value, which is correct
 * because a text/plain part is not parsed as markup.
 */
export function renderEmail(
  template: EmailTemplateId,
  locale: EmailLocale,
  params: EmailParams
): RenderedEmail {
  const body = CATALOGUE[locale][template];
  const copy = body(params);
  const dir = locale === "ar-SA" ? "rtl" : "ltr";

  const htmlBody = [
    `<div dir="${dir}">`,
    ...copy.lines.map((line) => `  <p>${escapeHtml(line)}</p>`),
    "</div>",
  ].join("\n");

  return {
    subject: copy.subject,
    htmlBody,
    textBody: copy.lines.join("\n"),
  };
}
