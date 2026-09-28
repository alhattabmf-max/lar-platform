import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_REQUIRED_NOTIFICATION_TYPES,
  DISPUTE_EVIDENCE_CONTENT_TYPES,
  DISPUTE_EVIDENCE_MAX_BYTES,
  DISPUTE_EVIDENCE_MAX_COUNT,
  DISPUTE_REASON_CODES,
  DISPUTE_STATUSES,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_PARAM_KEYS,
  ORDER_ALLOCATION_STATUSES,
  REPLACEMENT_OBLIGATION_STATUSES,
  TRADER_VISIBLE_DOCUMENT_TYPES,
} from "@platform/types";
import { notificationHref } from "@/lib/notification-link";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ar = JSON.parse(read("messages/ar-SA.json"));
const en = JSON.parse(read("messages/en-SA.json"));

const ORDER_DETAIL = strip(read("app/[locale]/trader/orders/[id]/page.tsx"));
const ORDERS_LIST = strip(read("app/[locale]/trader/orders/page.tsx"));
const DOCUMENTS = strip(read("components/trader/order-documents.tsx"));
const CONFIRM = strip(read("components/trader/confirm-delivery-button.tsx"));
const DISPUTE_FORM = strip(read("components/trader/open-dispute-form.tsx"));
const DISPUTE_GATE = strip(
  read("app/[locale]/trader/orders/[id]/allocations/[allocationId]/dispute/page.tsx")
);
const DISPUTE_DETAIL = strip(read("app/[locale]/trader/disputes/[id]/page.tsx"));
const NOTIFICATIONS = strip(read("components/trader/notification-list.tsx"));
const REPLACEMENT_DETAIL = strip(read("app/[locale]/trader/replacements/[id]/page.tsx"));
/**
 * THE THREE LISTS ARE CARDS NOW — «ألغِ ألسنتها وجمّعها كبطاقات في صفحة
 * المتابعة». The disputes, the returns and the product reports moved
 * into one component; their old addresses are kept open and forward to
 * it. Everything these cases ever asked of those lists is still asked,
 * of the file that draws them.
 */
const FOLLOW_UP = strip(read("components/trader/follow-up-sections.tsx"));
const REPORTS = FOLLOW_UP;

/** Every trader page, discovered rather than listed. */
function traderPages(dir = join(ROOT, "app", "[locale]", "trader"), prefix = "trader"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return traderPages(join(dir, entry.name), `${prefix}/${entry.name}`);
    return entry.name === "page.tsx" ? [`${prefix}/page.tsx`] : [];
  });
}
const PAGES = traderPages();

// ---------------------------------------------------------------- orders

describe("the order detail shows the trader's own data and no counterparty finance", () => {
  it("answers an unknown or another company's order with one 404", () => {
    // Ownership is in the API's query, so both produce the same "no
    // row". A 403 would confirm the order exists and belongs to someone.
    expect(ORDER_DETAIL).toContain("result.notFound) notFound()");
  });

  it("renders no commission, payable, bank or ledger field", () => {
    // These live on the same row the API reads. They are absent from
    // OrderDetail, so the boundary is the projection's — asserted here
    // so a widened contract cannot silently surface them.
    for (const field of [
      "commission",
      "supplierPayable",
      "supplierBankAccount",
      "ledger",
      "journalEntry",
      "supplierCompany",
      "traderTaxProfileSnapshot",
      "policyAcceptanceId",
    ]) {
      expect([field, ORDER_DETAIL.includes(field)]).toEqual([field, false]);
    }
  });

  it("orders allocations deterministically, terminating in the id", () => {
    // Without the final key two allocations sharing a deadline could
    // swap places between renders, and a list that reorders itself is
    // one a reader stops trusting.
    expect(ORDER_DETAIL).toContain("a.isPreparationOverdue !== b.isPreparationOverdue");
    expect(ORDER_DETAIL).toMatch(/return a\.id < b\.id \? -1 : a\.id > b\.id \? 1 : 0;/);
  });

  it("gives every allocation status a next step", () => {
    for (const status of ORDER_ALLOCATION_STATUSES) {
      expect([status, typeof en.trader.orders.next[status]]).toEqual([status, "string"]);
      expect([status, typeof ar.trader.orders.next[status]]).toEqual([status, "string"]);
    }
    expect(en.trader.orders.next.overdue).toBeTruthy();
  });

  it("says what is wrong in words, not only in colour", () => {
    // A coloured border is not a message, and is invisible to anyone
    // who cannot see it.
    expect(ORDERS_LIST).toContain("overdueNotice");
    expect(ORDER_DETAIL).toContain("overdueCount");
  });

  it("builds no tracking link from a carrier code", () => {
    // There is no carrier integration. A guessed URL would send someone
    // to a page that may not be theirs.
    expect(ORDER_DETAIL).toMatch(/carrierCode && \w+\.trackingNumber/);
    expect(ORDER_DETAIL).not.toMatch(/href=\{`https?:/);
  });

  it("calls the destination the DELIVERY city", () => {
    expect(en.trader.orders.deliveryCity).toBe("Delivery city");
    expect(en.marketplace.card.city).toBe("Ships from");
  });

  it("keeps long identifiers from pushing the page sideways", () => {
    // A tracking number has no spaces and would overflow at 360px.
    expect(ORDER_DETAIL).toContain("break-all");
  });
});

// ---------------------------------------------------------------- documents

describe("documents are embedded in the order and nowhere else", () => {
  it("has no standalone documents page", () => {
    expect(PAGES).not.toContain("trader/documents/page.tsx");
  });

  it("offers no Documents entry in the navigation, inert or otherwise", () => {
    const layout = strip(read("app/[locale]/trader/layout.tsx"));
    expect(layout).not.toMatch(/key: "documents"/);
  });

  it("reads that order's own endpoint, with no fan-out", () => {
    expect(strip(read("lib/trader-data.ts"))).toContain(
      "/trader/orders/${orderId}/documents"
    );
    expect(ORDER_DETAIL).toContain("loadOrderDocuments");
    expect(ORDER_DETAIL).not.toContain(".map(async");
  });

  it("shows the NOT_A_TAX_INVOICE notice from the response, not a constant", () => {
    // Rendering a hardcoded label would make a document WITHOUT the
    // notice look identical to one with it.
    expect(DOCUMENTS).toContain("document.notice === NOT_A_TAX_INVOICE");
    expect(en.trader.documents.notTaxInvoice).toMatch(/NOT a tax invoice/i);
    expect(ar.trader.documents.notTaxInvoice).toContain("ليست فاتورة ضريبية");
  });

  it("translates only the two document types a trader may see", () => {
    expect(Object.keys(en.trader.documents.type).sort()).toEqual(
      [...TRADER_VISIBLE_DOCUMENT_TYPES].sort()
    );
    expect(Object.keys(en.trader.documents.type)).not.toContain("INTERNAL_COMMISSION_DRAFT");
  });

  it("offers no PDF, QR, ZATCA or download affordance", () => {
    for (const forbidden of ["pdf", "PDF", "qr", "QR", "zatca", "ZATCA", "download", "clearance"]) {
      expect([forbidden, DOCUMENTS.includes(forbidden)]).toEqual([forbidden, false]);
    }
    const copy = JSON.stringify({ ar: ar.trader.documents, en: en.trader.documents });
    for (const forbidden of ["PDF", "QR", "ZATCA", "زاتكا", "تنزيل"]) {
      expect([forbidden, copy.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });
});

// ---------------------------------------------------------------- confirm delivery

describe("confirming delivery", () => {
  it("is offered only from SHIPPED, the one state the server claims from", () => {
    // `confirmDeliveryByTrader` claims the transition conditionally and
    // answers 409 otherwise. Offering it elsewhere promises an action
    // that fails.
    expect(ORDER_DETAIL).toContain('allocation.status === "SHIPPED"');
    expect(REPLACEMENT_DETAIL).toContain('replacement.status === "SHIPPED"');
  });

  it("asks before acting, because it cannot be undone", () => {
    expect(CONFIRM).toContain("confirmPrompt");
    expect(en.trader.orders.confirmDelivery.prompt).toMatch(/cannot be undone/i);
  });

  it("guards a double submit", () => {
    expect(CONFIRM).toContain("if (submitting) return");
    expect(CONFIRM).toContain("disabled={submitting}");
  });

  it("re-reads from the server rather than painting a guess", () => {
    // Confirming starts the dispute window and can complete the order.
    // An optimistic update would have to undo all of that on failure.
    expect(CONFIRM).toContain("router.refresh()");
    expect(CONFIRM).not.toContain("setDelivered");
  });

  it("shows a translated message and a request id on failure", () => {
    expect(CONFIRM).toContain("root(failure.messageKey)");
    expect(CONFIRM).toContain("failure.requestId");
    expect(CONFIRM).not.toContain("failure.message}");
  });

  it("hits the real endpoint for both resources", () => {
    expect(CONFIRM).toContain("/trader/${resource}/${id}/confirm-delivery");
    expect(ORDER_DETAIL).toContain('resource="order-allocations"');
    expect(REPLACEMENT_DETAIL).toContain('resource="replacement-obligations"');
  });
});

// ---------------------------------------------------------------- open dispute

describe("opening a dispute follows the API's own contract", () => {
  it("checks eligibility on the SERVER, from the order it read", () => {
    // Someone following a stale link reads why, instead of filling in a
    // form that is refused on submit.
    expect(DISPUTE_GATE).toContain("allocation.disputeId");
    expect(DISPUTE_GATE).toContain('allocation.status !== "DELIVERED"');
    expect(DISPUTE_GATE).toContain("windowOpen");
  });

  it("explains each ineligible case separately", () => {
    for (const key of ["already", "notDelivered", "windowClosed"]) {
      expect([key, typeof en.trader.disputes.open[key].title]).toEqual([key, "string"]);
      expect([key, typeof en.trader.disputes.open[key].description]).toEqual([key, "string"]);
    }
  });

  it("offers exactly the reason codes the DTO accepts", () => {
    expect(DISPUTE_FORM).toContain("DISPUTE_REASON_CODES.map");
    for (const code of DISPUTE_REASON_CODES) {
      expect([code, typeof en.trader.disputes.open.reason[code]]).toEqual([code, "string"]);
      expect([code, typeof ar.trader.disputes.open.reason[code]]).toEqual([code, "string"]);
    }
  });

  it("bounds the description exactly as the DTO does", () => {
    expect(DISPUTE_FORM).toContain("DISPUTE_DESCRIPTION_MIN_LENGTH");
    expect(DISPUTE_FORM).toContain("DISPUTE_DESCRIPTION_MAX_LENGTH");
    expect(DISPUTE_FORM).toContain("maxLength={DISPUTE_DESCRIPTION_MAX_LENGTH}");
  });

  it("enforces the upload limits BEFORE sending a file", () => {
    // A file rejected after it uploads has already cost bandwidth and
    // left a record on the server.
    expect(DISPUTE_EVIDENCE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(DISPUTE_EVIDENCE_MAX_COUNT).toBe(10);
    expect(DISPUTE_FORM).toContain("DISPUTE_EVIDENCE_CONTENT_TYPES");
    expect(DISPUTE_FORM).toContain("file.size > DISPUTE_EVIDENCE_MAX_BYTES");
    expect(DISPUTE_FORM).toMatch(
      /attachments\.length \+ chosen\.length > DISPUTE_EVIDENCE_MAX_COUNT/
    );
  });

  it("offers the picker exactly what the server accepts", () => {
    expect(DISPUTE_FORM).toContain("accept={DISPUTE_EVIDENCE_CONTENT_TYPES.join(\",\")}");
    expect([...DISPUTE_EVIDENCE_CONTENT_TYPES]).toEqual([
      "image/jpeg",
      "image/png",
      "application/pdf",
    ]);
  });

  it("uploads first, then opens the dispute — the order the API forces", () => {
    const uploadAt = DISPUTE_FORM.indexOf("/trader/evidence-uploads");
    const disputeAt = DISPUTE_FORM.indexOf("/disputes`");
    expect(uploadAt).toBeGreaterThan(-1);
    expect(disputeAt).toBeGreaterThan(uploadAt);
  });

  it("never renders a storage key", () => {
    // It is held for step 2 and shown nowhere: a storage key is an
    // internal address with no authorised endpoint to pair it with.
    // What the reader sees is the file's own name.
    expect(DISPUTE_FORM).not.toMatch(/\{attachment\.storageObjectKey\}/);
    expect(DISPUTE_FORM).toContain("{attachment.name}");

    // Every line mentioning the key is data handling, never markup:
    // the field declaration, the value taken from the upload, and the
    // array sent to the dispute endpoint. None is inside an element.
    const lines = DISPUTE_FORM.split("\n").filter((line) => line.includes("storageObjectKey"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect([line, /<\/?[A-Za-z]/.test(line)]).toEqual([line, false]);
    }
  });

  it("claims no dispute opened when the request failed", () => {
    expect(DISPUTE_FORM).toContain("notOpened");
    expect(en.trader.disputes.open.notOpened).toMatch(/NOT opened/i);
    // The navigation happens only after the await resolves.
    const success = DISPUTE_FORM.slice(DISPUTE_FORM.indexOf("const dispute = await"));
    expect(success.slice(0, success.indexOf("catch"))).toContain("router.push");
  });

  it("keeps every input on a failure", () => {
    // Making someone retype a description and re-upload photos already
    // on the server is the worst response to a transient failure.
    const failure = DISPUTE_FORM.slice(DISPUTE_FORM.indexOf("} catch (error) {"));
    expect(failure).not.toContain("setDescription(\"\")");
    expect(failure).not.toContain("setAttachments([])");
  });

  it("guards a double submit", () => {
    expect(DISPUTE_FORM).toContain("if (busy) return");
    expect(DISPUTE_FORM).toContain("disabled={busy}");
  });
});

// ---------------------------------------------------------------- notifications

describe("notification text is built, never stored", () => {
  it("renders from the type and its params through translations", () => {
    expect(NOTIFICATIONS).toContain("t(`message.${item.type}`, { ...item.params })");
    expect(NOTIFICATIONS).not.toContain("dangerouslySetInnerHTML");
    expect(NOTIFICATIONS).not.toContain("item.message");
    expect(NOTIFICATIONS).not.toContain("item.body");
  });

  it("has a message and an action label for every one of the 18 types", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect([type, typeof en.trader.notifications.message[type]]).toEqual([type, "string"]);
      expect([type, typeof ar.trader.notifications.message[type]]).toEqual([type, "string"]);
      expect([type, typeof en.trader.notifications.action[type]]).toEqual([type, "string"]);
      expect([type, typeof ar.trader.notifications.action[type]]).toEqual([type, "string"]);
    }
  });

  it("interpolates only params that type is allowed to carry", () => {
    // A message referencing a param its type never sends would render
    // the placeholder name at a reader.
    for (const type of NOTIFICATION_TYPES) {
      const allowed = new Set<string>(NOTIFICATION_TYPE_PARAM_KEYS[type]);
      for (const locale of [en, ar]) {
        const used = [...locale.trader.notifications.message[type].matchAll(/\{(\w+)\}/g)].map(
          (m) => m[1]
        );
        for (const param of used) {
          expect([type, param, allowed.has(param)]).toEqual([type, param, true]);
        }
      }
    }
  });

  it("mentions no email, delivery or outbox anywhere", () => {
    // This is a feed, not a delivery dashboard — least of all while the
    // provider delivers nothing.
    const copy = JSON.stringify({ ar: ar.trader.notifications, en: en.trader.notifications });
    for (const forbidden of ["email", "inbox", "outbox", "delivered to", "بريد"]) {
      expect([forbidden, copy.toLowerCase().includes(forbidden.toLowerCase())]).toEqual([
        forbidden,
        false,
      ]);
    }
  });
});

describe("a notification's destination comes only from the route resolver", () => {
  const base = { entityId: "22222222-2222-2222-2222-222222222222", params: {} };

  it("builds an internal path for every kind a trader has a page for", () => {
    expect(
      notificationHref({ ...base, type: "ORDER_CREATED", entityType: "master_order" }, "ar-SA")
    ).toBe("/ar-SA/trader/orders/22222222-2222-2222-2222-222222222222");

    expect(
      notificationHref({ ...base, type: "DISPUTE_DECIDED", entityType: "dispute" }, "ar-SA")
    ).toBe("/ar-SA/trader/disputes/22222222-2222-2222-2222-222222222222");

    expect(
      notificationHref(
        { ...base, type: "REPLACEMENT_FAILED", entityType: "replacement_obligation" },
        "ar-SA"
      )
    ).toBe("/ar-SA/trader/replacements/22222222-2222-2222-2222-222222222222");

    expect(
      notificationHref({ ...base, type: "PAYMENT_FAILED", entityType: "checkout_session" }, "ar-SA")
    ).toBe("/ar-SA/trader/checkout/22222222-2222-2222-2222-222222222222");
  });

  it("routes an ALLOCATION event to its order, using params.orderId", () => {
    // There is no allocation page; the allocation is shown within its
    // order, which is why every allocation event must carry orderId.
    expect(
      notificationHref(
        {
          type: "ALLOCATION_SHIPPED",
          entityType: "order_allocation",
          entityId: "alloc-1",
          params: { orderId: "order-9" },
        },
        "en-SA"
      )
    ).toBe("/en-SA/trader/orders/order-9");
  });

  it("returns NULL when the id the route needs is missing", () => {
    // A link to /trader/orders/undefined is worse than no link.
    expect(
      notificationHref(
        { type: "ALLOCATION_SHIPPED", entityType: "order_allocation", entityId: "a", params: {} },
        "en-SA"
      )
    ).toBeNull();
  });

  it("returns NULL for a settlement, which a trader has no page for", () => {
    expect(
      notificationHref(
        { ...base, type: "SETTLEMENT_EXECUTED", entityType: "supplier_payout" },
        "en-SA"
      )
    ).toBeNull();
  });

  it("renders no action affordance when there is no destination", () => {
    expect(NOTIFICATIONS).toContain("{href ? (");
    expect(NOTIFICATIONS).toContain("notificationHref(item, locale)");
  });

  it("uses a LINK for navigation and a BUTTON for marking read", () => {
    expect(NOTIFICATIONS).toMatch(/<Link[\s\S]*?href=\{href\}/);
    expect(NOTIFICATIONS).toMatch(/<Button[\s\S]*?onClick=\{\(\) => markRead\(item\.id\)\}/);
  });
});

describe("notification read state", () => {
  it("lifts unread action-required items to the top", () => {
    const page = strip(read("app/[locale]/trader/notifications/page.tsx"));
    expect(page).toContain("isActionRequired(a.type)");
    // Only among the UNREAD: an action-required item already read is
    // history, and lifting it forever freezes the top of the list.
    expect(page).toContain("a.readAt === null && isActionRequired(a.type)");
  });

  it("names the same action-required set the contract does", () => {
    expect([...ACTION_REQUIRED_NOTIFICATION_TYPES]).toEqual([
      "PAYMENT_FAILED",
      "ORDER_CREATED",
      "DISPUTE_OPENED",
      "REFUND_FAILED",
      "REPLACEMENT_REQUIRED",
      "REPLACEMENT_FAILED",
    ]);
  });

  it("re-reads from the server after marking, rather than painting a guess", () => {
    // The unread badge in the chrome is server-rendered; an optimistic
    // row would put two disagreeing numbers on one screen.
    expect(NOTIFICATIONS).toContain("router.refresh()");
    expect(NOTIFICATIONS).toContain("/trader/notifications/${id}/read");
    expect(NOTIFICATIONS).toContain("/trader/notifications/read-all");
  });

  it("does not block navigation on the mark-read request", () => {
    // Failing to mark it read must not stop someone reaching the thing
    // it points at.
    expect(NOTIFICATIONS).toContain("void markRead(item.id)");
  });
});

// ---------------------------------------------------------------- disputes

describe("the dispute detail keeps the API's boundary", () => {
  it("renders every RESOLVED_* outcome distinctly, never as one word", () => {
    for (const status of DISPUTE_STATUSES) {
      for (const locale of [en, ar]) {
        expect([status, typeof locale.trader.status.dispute[status]]).toEqual([status, "string"]);
        expect([status, typeof locale.trader.disputes.next[status]]).toEqual([status, "string"]);
      }
    }

    const resolved = DISPUTE_STATUSES.filter((s) => s.startsWith("RESOLVED_"));
    const labels = resolved.map((s) => en.trader.status.dispute[s]);
    // Four different results — refunded in full, in part, refused,
    // replaced. Four distinct sentences.
    expect(new Set(labels).size).toBe(4);
    for (const label of labels) expect(label).not.toBe("Resolved");
  });

  it("shows the supplier's reply as a plain text node", () => {
    expect(DISPUTE_DETAIL).toContain("{dispute.supplierResponse.description}");
    expect(DISPUTE_DETAIL).not.toContain("dangerouslySetInnerHTML");
    expect(DISPUTE_DETAIL).toContain("whitespace-pre-wrap");
  });

  it("renders no administrator note or identity", () => {
    for (const forbidden of ["reasonNote", "decidedByAdminUserId", "adminUserId"]) {
      expect([forbidden, DISPUTE_DETAIL.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("renders no storage key and offers no download", () => {
    for (const forbidden of ["storageObjectKey", "objectKey", "download", "href={item"]) {
      expect([forbidden, DISPUTE_DETAIL.includes(forbidden)]).toEqual([forbidden, false]);
    }
    // The absence is stated, not left as a puzzle.
    expect(DISPUTE_DETAIL).toContain("evidence.noDownload");
    expect(en.trader.disputes.evidence.noDownload).toMatch(/not available/i);
  });

  it("says the evidence shown is the trader company's only", () => {
    expect(DISPUTE_DETAIL).toContain("evidence.companyOnly");
    expect(en.trader.disputes.evidence.companyOnly).toMatch(/supplier's are not shown/i);
  });

  it("translates every supplier response and decision type the enum has", () => {
    for (const type of ["ACCEPT", "REJECT", "PARTIAL_ACCEPT", "REPLACEMENT_OFFER"]) {
      expect([type, typeof en.trader.disputes.supplierResponse.type[type]]).toEqual([
        type,
        "string",
      ]);
    }
    for (const type of ["FULL_REFUND", "PARTIAL_REFUND", "REJECTED", "REPLACEMENT"]) {
      expect([type, typeof en.trader.disputes.decisions.type[type]]).toEqual([type, "string"]);
    }
  });
});

// ---------------------------------------------------------------- replacements

describe("replacements", () => {
  it("gives every real status a label and a next step", () => {
    for (const status of REPLACEMENT_OBLIGATION_STATUSES) {
      for (const locale of [en, ar]) {
        expect([status, typeof locale.trader.status.replacement[status]]).toEqual([
          status,
          "string",
        ]);
        expect([status, typeof locale.trader.replacements.next[status]]).toEqual([status, "string"]);
      }
    }
  });

  it("resolves the REPLACEMENT_FAILED notification's action target", () => {
    // Before this route existed, that notification had nowhere to send
    // anyone.
    expect(PAGES).toContain("trader/replacements/[id]/page.tsx");
    expect(
      notificationHref(
        {
          type: "REPLACEMENT_FAILED",
          entityType: "replacement_obligation",
          entityId: "r-1",
          params: {},
        },
        "ar-SA"
      )
    ).toBe("/ar-SA/trader/replacements/r-1");
  });

  it("invents no tracking or provider data", () => {
    // Both fields must exist: a carrier with no number is not something
    // anyone can act on, and there is no URL to build.
    expect(REPLACEMENT_DETAIL).toContain(
      "replacement.carrierCode && replacement.trackingNumber"
    );
    expect(REPLACEMENT_DETAIL).not.toMatch(/href=\{`https?:/);
    expect(REPLACEMENT_DETAIL).not.toContain("estimatedDelivery");
  });

  it("answers a cross-company replacement with one 404", () => {
    expect(REPLACEMENT_DETAIL).toContain("result.notFound) notFound()");
  });
});

// ---------------------------------------------------------------- product reports

describe("product reports", () => {
  it("uses only the endpoints that exist", () => {
    expect(strip(read("lib/trader-data.ts"))).toContain('"/trader/product-reports/mine"');
    expect(REPORTS).toContain("loadMyProductReports");
  });

  it("adds no pager over an unpaginated endpoint", () => {
    // A page control there is a lie about what the next page contains.
    expect(REPORTS).not.toContain("TraderPagination");
    expect(REPORTS).not.toContain("parsePage");
  });

  it("translates the closed reason and status vocabularies", () => {
    for (const code of [
      "COUNTERFEIT",
      "MISLEADING_INFO",
      "SAFETY_CONCERN",
      "REGULATORY_CONCERN",
      "INTELLECTUAL_PROPERTY",
      "INAPPROPRIATE_CONTENT",
      "DUPLICATE_OR_SPAM",
      "OTHER",
    ]) {
      expect([code, typeof en.trader.productReports.reason[code]]).toEqual([code, "string"]);
    }
    for (const status of ["OPEN", "CLARIFICATION_REQUESTED", "DISMISSED", "RESOLVED"]) {
      expect([status, typeof en.trader.productReports.status[status]]).toEqual([status, "string"]);
      expect([status, typeof en.trader.productReports.next[status]]).toEqual([status, "string"]);
    }
  });

  it("shows no internal moderation note", () => {
    for (const forbidden of ["reviewNote", "internalNote", "adminNote", "moderationNote"]) {
      expect([forbidden, REPORTS.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("falls back to the code rather than an empty cell for an unknown value", () => {
    expect(REPORTS).toContain("t.has(`reason.${report.reasonCode}`)");
    expect(REPORTS).toContain("t.has(`status.${report.status}`)");
  });
});

// ---------------------------------------------------------------- portal-wide

describe("every trader page keeps the portal's rules", () => {
  it("guards on the page as well as the layout", () => {
    for (const page of PAGES) {
      expect([page, strip(read(`app/[locale]/${page}`))]).toEqual([
        page,
        expect.stringContaining('requireRoleOrRedirect(appLocale, "TRADER")'),
      ]);
    }
  });

  it("re-wraps no AppShell and repeats no cache directive", () => {
    for (const page of PAGES) {
      const source = strip(read(`app/[locale]/${page}`));
      expect([page, source.includes("<AppShell")]).toEqual([page, false]);
      expect([page, source.includes("force-dynamic")]).toEqual([page, false]);
    }
  });

  it("renders no raw HTML anywhere in the portal", () => {
    for (const page of PAGES) {
      expect([page, strip(read(`app/[locale]/${page}`)).includes("dangerouslySetInnerHTML")]).toEqual(
        [page, false]
      );
    }
  });

  it("has an error and an empty state on every list", () => {
    for (const page of [
      "trader/orders/page.tsx",
      "trader/notifications/page.tsx",
    ]) {
      const source = strip(read(`app/[locale]/${page}`));
      expect([page, source.includes("<ErrorState")]).toEqual([page, true]);
      expect([page, source.includes("<EmptyState")]).toEqual([page, true]);
    }

    // AND THE THREE THAT BECAME CARDS keep both, once per card: a
    // failed read must never be drawn as "nothing here".
    expect(FOLLOW_UP.split("<ErrorState")).toHaveLength(4);
    expect(FOLLOW_UP.split("<EmptyState")).toHaveLength(4);
  });

  it("forwards the three old list addresses rather than 404ing them", () => {
    for (const segment of ["disputes", "replacements", "product-reports"]) {
      const legacy = strip(read(`app/[locale]/trader/${segment}/page.tsx`));
      expect([segment, legacy.includes("redirect(")]).toEqual([segment, true]);
      expect([segment, legacy.includes('requireRoleOrRedirect(appLocale, "TRADER")')]).toEqual([
        segment,
        true,
      ]);
    }
  });

  it("shows a loading state on every detail behind Suspense", () => {
    for (const page of [
      "trader/orders/[id]/page.tsx",
      "trader/disputes/[id]/page.tsx",
      "trader/replacements/[id]/page.tsx",
    ]) {
      const source = strip(read(`app/[locale]/${page}`));
      expect([page, source.includes("<LoadingState")]).toEqual([page, true]);
      expect([page, source.includes("<Suspense")]).toEqual([page, true]);
    }
  });

  it("keeps both locales at exact key parity", () => {
    const keys = (o: unknown, prefix = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
      );

    expect(keys(ar.trader).sort()).toEqual(keys(en.trader).sort());
  });

  it("never shows the English word 'trader' in the Arabic copy", () => {
    expect(JSON.stringify(ar.trader)).not.toMatch(/trader/i);
  });
});
