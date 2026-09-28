import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DISPUTE_SUPPLIER_RESPONSE_TYPES,
  NOTIFICATION_TYPES,
  SUPPLIER_ALLOCATION_ACTIONS,
  SUPPLIER_OPPORTUNITY_REASON_CODES,
  SUPPLIER_REPLACEMENT_ACTIONS,
  type NotificationItem,
} from "@platform/types";
import {
  actionNeedsTracking,
  allocationAction,
  replacementAction,
} from "@/lib/fulfilment-actions";
import { supplierNotificationHref } from "@/lib/supplier-notification-link";
import {
  EMPTY_OPPORTUNITY_FORM,
  isOpportunityDirty,
  opportunityFormFromDetail,
  reasonField,
  toCreateOpportunityBody,
  toUpdateOpportunityBody,
  toLocalInput,
  validateOpportunityForm,
  type OpportunityFormValues,
} from "@/lib/opportunity-form";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SUPPLIER_DIR = join(ROOT, "app", "[locale]", "supplier");

function supplierPages(dir = SUPPLIER_DIR, prefix = "supplier"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return supplierPages(join(dir, entry.name), `${prefix}/${entry.name}`);
    return entry.name === "page.tsx" ? [`${prefix}/page.tsx`] : [];
  });
}

const PAGES = supplierPages();

// ------------------------------------------------------ fulfilment gating

describe("fulfilment gating follows the API's own transitions", () => {
  it.each([
    ["AWAITING_PREPARATION", "start-preparation"],
    ["PREPARING", "mark-ready"],
    ["READY_TO_SHIP", "ship"],
  ] as const)("an allocation in %s offers %s", (status, action) => {
    expect(allocationAction(status)).toBe(action);
  });

  it.each(["SHIPPED", "DELIVERED"] as const)(
    "an allocation in %s offers nothing",
    (status) => {
      // SHIPPED waits on the trader's confirmation; DELIVERED is finished.
      expect(allocationAction(status)).toBeNull();
    },
  );

  it("offers NO supplier action that confirms delivery", () => {
    // Confirming delivery belongs to the trader. The API has no supplier
    // route for it, and a button would be a claim about someone else's
    // goods.
    const segments = [
      ...Object.values(SUPPLIER_ALLOCATION_ACTIONS),
      ...Object.values(SUPPLIER_REPLACEMENT_ACTIONS),
    ];

    for (const segment of segments) {
      expect(segment).not.toContain("deliver");
      expect(segment).not.toContain("confirm");
    }
  });

  it.each([
    ["AWAITING_PREPARATION", "start-preparation"],
    ["PREPARING", "mark-ready"],
    ["READY_TO_SHIP", "ship"],
  ] as const)("a replacement in %s offers %s", (status, action) => {
    expect(replacementAction(status)).toBe(action);
  });

  it.each(["SHIPPED", "DELIVERED", "FAILED"] as const)(
    "a replacement in %s offers nothing",
    (status) => {
      // FAILED is on this enum and no other fulfilment one. It is a
      // terminal state with no supplier action.
      expect(replacementAction(status)).toBeNull();
    },
  );

  it("asks for carrier details on ship, and on nothing else", () => {
    expect(actionNeedsTracking("ship")).toBe(true);
    expect(actionNeedsTracking("start-preparation")).toBe(false);
    expect(actionNeedsTracking("mark-ready")).toBe(false);
    expect(actionNeedsTracking(null)).toBe(false);
  });
});

// -------------------------------------------------- fulfilment component

const FULFILMENT_LABELS = {
  action: {
    "start-preparation": "بدء التجهيز",
    "mark-ready": "جاهز للشحن",
    ship: "تسجيل الشحن",
  },
  prompt: {
    "start-preparation": "تأكيد بدء التجهيز؟",
    "mark-ready": "تأكيد الجاهزية؟",
    ship: "أدخل بيانات الشحن",
  },
  carrierCode: "شركة الشحن",
  trackingNumber: "رقم التتبع",
  trackingHint: "تلميح",
  required: "(مطلوب)",
  confirm: "تأكيد",
  cancel: "إلغاء",
  working: "جارٍ…",
  errorTitle: "تعذّر",
  requestIdLabel: "المرجع",
  fieldRequired: "هذا الحقل مطلوب.",
};

const refreshMock = vi.fn();
const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: pushMock,
    replace: replaceMock,
  }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const { FulfilmentActions } =
  await import("@/components/supplier/fulfilment-actions");
const { DisputeRespondForm } =
  await import("@/components/supplier/dispute-respond-form");
const { SupplierNotificationList } =
  await import("@/components/supplier/supplier-notification-list");

let fetchMock: ReturnType<typeof vi.fn>;

const ok = () =>
  new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  refreshMock.mockReset();
  pushMock.mockReset();
  replaceMock.mockReset();
  fetchMock = vi.fn().mockResolvedValue(ok());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("a fulfilment transition", () => {
  const renderAction = (action: string | null) =>
    render(
      <FulfilmentActions
        resource="order-allocations"
        id="a-1"
        action={action}
        labels={FULFILMENT_LABELS}
      />,
    );

  it("renders nothing when the status allows no action", () => {
    const { container } = renderAction(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks first, then posts to the real endpoint", async () => {
    renderAction("start-preparation");

    fireEvent.click(
      screen.getByText(FULFILMENT_LABELS.action["start-preparation"]),
    );
    expect(
      await screen.findByText(FULFILMENT_LABELS.prompt["start-preparation"]),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(FULFILMENT_LABELS.confirm));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "/supplier/order-allocations/a-1/start-preparation",
    );
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("sends no body for a transition that takes none", async () => {
    renderAction("mark-ready");
    fireEvent.click(screen.getByText(FULFILMENT_LABELS.action["mark-ready"]));
    fireEvent.click(await screen.findByText(FULFILMENT_LABELS.confirm));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({});
  });

  it("requires BOTH carrier fields before shipping, and sends neither empty", async () => {
    renderAction("ship");
    fireEvent.click(screen.getByText(FULFILMENT_LABELS.action.ship));
    fireEvent.click(await screen.findByText(FULFILMENT_LABELS.confirm));

    // `ShipDto` requires both, non-empty. The API's answer names neither,
    // so the form does.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByText(FULFILMENT_LABELS.fieldRequired)).toHaveLength(
      2,
    );
  });

  it("sends the trimmed carrier details", async () => {
    renderAction("ship");
    fireEvent.click(screen.getByText(FULFILMENT_LABELS.action.ship));

    fireEvent.change(await screen.findByLabelText(/شركة الشحن/), {
      target: { value: "  SMSA  " },
    });
    fireEvent.change(screen.getByLabelText(/رقم التتبع/), {
      target: { value: " TRK-1 " },
    });
    fireEvent.click(screen.getByText(FULFILMENT_LABELS.confirm));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      carrierCode: "SMSA",
      trackingNumber: "TRK-1",
    });
  });

  it("guards a double submit", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((r) => (release = r)),
    );

    renderAction("start-preparation");
    fireEvent.click(
      screen.getByText(FULFILMENT_LABELS.action["start-preparation"]),
    );
    const confirm = await screen.findByText(FULFILMENT_LABELS.confirm);

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(ok());
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("keeps the typed carrier details when the request fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "CONFLICT",
            message: "Allocation is not READY_TO_SHIP",
          },
          requestId: "req-1",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );

    renderAction("ship");
    fireEvent.click(screen.getByText(FULFILMENT_LABELS.action.ship));
    fireEvent.change(await screen.findByLabelText(/شركة الشحن/), {
      target: { value: "SMSA" },
    });
    fireEvent.change(screen.getByLabelText(/رقم التتبع/), {
      target: { value: "TRK-9" },
    });
    fireEvent.click(screen.getByText(FULFILMENT_LABELS.confirm));

    await screen.findByRole("alert");

    expect(
      (screen.getByLabelText(/شركة الشحن/) as HTMLInputElement).value,
    ).toBe("SMSA");
    expect(
      (screen.getByLabelText(/رقم التتبع/) as HTMLInputElement).value,
    ).toBe("TRK-9");
    expect(refreshMock).not.toHaveBeenCalled();
    // The closed translated message, never the API's English.
    expect(document.body.textContent).toContain("errors.codes.CONFLICT");
    expect(document.body.textContent).not.toContain("READY_TO_SHIP");
  });

  it("sends no Idempotency-Key — these endpoints take none", async () => {
    renderAction("mark-ready");
    fireEvent.click(screen.getByText(FULFILMENT_LABELS.action["mark-ready"]));
    fireEvent.click(await screen.findByText(FULFILMENT_LABELS.confirm));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(Object.keys(fetchMock.mock.calls[0][1].headers)).not.toContain(
      "Idempotency-Key",
    );
  });
});

// ------------------------------------------------------- dispute respond

const DISPUTE_LABELS = {
  heading: "الردّ",
  responseType: "نوع الردّ",
  responseTypeOption: Object.fromEntries(
    DISPUTE_SUPPLIER_RESPONSE_TYPES.map((type) => [type, `option-${type}`]),
  ),
  description: "التفاصيل",
  descriptionHint: "تلميح",
  placeholder: "اختر",
  required: "(مطلوب)",
  submit: "إرسال",
  submitting: "جارٍ…",
  prompt: "تأكيد الإرسال؟",
  confirm: "تأكيد",
  cancel: "إلغاء",
  errorTitle: "تعذّر",
  requestIdLabel: "المرجع",
  descriptionLength: "بين {min} و{max}",
  typeRequired: "اختر نوع الردّ.",
};

describe("responding to a dispute", () => {
  const renderForm = () =>
    render(<DisputeRespondForm disputeId="d-1" labels={DISPUTE_LABELS} />);

  it("offers exactly the four real response types", () => {
    renderForm();
    const select = screen.getByLabelText(/نوع الردّ/) as HTMLSelectElement;

    // REPLACEMENT_OFFER is easy to miss and is one of them.
    const values = Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean);
    expect(values.sort()).toEqual([...DISPUTE_SUPPLIER_RESPONSE_TYPES].sort());
    expect(values).toContain("REPLACEMENT_OFFER");
  });

  it("pre-selects nothing — which of the four it is, is the decision", () => {
    renderForm();
    expect(
      (screen.getByLabelText(/نوع الردّ/) as HTMLSelectElement).value,
    ).toBe("");
  });

  it("refuses a missing type or a description outside 5–2000", () => {
    renderForm();

    fireEvent.click(screen.getByText(DISPUTE_LABELS.submit));
    expect(screen.getByText(DISPUTE_LABELS.typeRequired)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/نوع الردّ/), {
      target: { value: "REJECT" },
    });
    fireEvent.change(screen.getByLabelText(/التفاصيل/), {
      target: { value: "لا" },
    });
    fireEvent.click(screen.getByText(DISPUTE_LABELS.submit));

    // The bounds are interpolated, so the rendered text carries the real
    // numbers rather than the placeholders.
    expect(screen.getByText("بين 5 و2000")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an Idempotency-Key, and the SAME one on a retry", async () => {
    // The endpoint REQUIRES the header. One key per logical response,
    // reused across retries — a fresh key per attempt would let a
    // double-click record two responses.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "x" } }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/نوع الردّ/), {
      target: { value: "ACCEPT" },
    });
    fireEvent.change(screen.getByLabelText(/التفاصيل/), {
      target: { value: "نقبل النزاع ونرسل بديلاً" },
    });
    fireEvent.click(screen.getByText(DISPUTE_LABELS.submit));
    fireEvent.click(await screen.findByText(DISPUTE_LABELS.confirm));

    await screen.findByRole("alert");
    const firstKey = fetchMock.mock.calls[0][1].headers["Idempotency-Key"];
    expect(firstKey).toBeTruthy();

    fetchMock.mockResolvedValue(ok());
    fireEvent.click(screen.getByText(DISPUTE_LABELS.confirm));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).toBe(
      firstKey,
    );
  });

  it("keeps the typed response when the request fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "CONFLICT", message: "x" } }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/نوع الردّ/), {
      target: { value: "PARTIAL_ACCEPT" },
    });
    fireEvent.change(screen.getByLabelText(/التفاصيل/), {
      target: { value: "ردّ مفصل ومهم" },
    });
    fireEvent.click(screen.getByText(DISPUTE_LABELS.submit));
    fireEvent.click(await screen.findByText(DISPUTE_LABELS.confirm));

    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText(/التفاصيل/) as HTMLTextAreaElement).value,
    ).toBe("ردّ مفصل ومهم");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------- notifications

const NOTIFICATION_LABELS = {
  markRead: "تحديد كمقروء",
  markAllRead: "تحديد الكل",
  working: "جارٍ…",
  open: "فتح",
  unreadBadge: "غير مقروء",
  type: Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => [type, `type-${type}`]),
  ),
  noDestination: "لا توجد صفحة",
  errorTitle: "تعذّر",
  requestIdLabel: "المرجع",
};

const notification = (
  overrides: Partial<NotificationItem> = {},
): NotificationItem =>
  ({
    id: "n-1",
    type: "ORDER_CREATED",
    entityType: "master_order",
    entityId: "o-1",
    params: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    readAt: null,
    ...overrides,
  }) as NotificationItem;

describe("the supplier notification feed", () => {
  it("marks one read against the SUPPLIER endpoint", async () => {
    render(
      <SupplierNotificationList
        locale="ar-SA"
        items={[notification()]}
        unreadCount={1}
        labels={NOTIFICATION_LABELS}
      />,
    );

    fireEvent.click(screen.getByText(NOTIFICATION_LABELS.markRead));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/supplier/notifications/n-1/read",
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/trader/");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("marks all read, and offers that only when something is unread", async () => {
    const { unmount } = render(
      <SupplierNotificationList
        locale="ar-SA"
        items={[notification()]}
        unreadCount={2}
        labels={NOTIFICATION_LABELS}
      />,
    );

    fireEvent.click(screen.getByText(NOTIFICATION_LABELS.markAllRead));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/supplier/notifications/read-all",
    );
    unmount();

    render(
      <SupplierNotificationList
        locale="ar-SA"
        items={[notification({ readAt: "2026-08-02T00:00:00.000Z" })]}
        unreadCount={0}
        labels={NOTIFICATION_LABELS}
      />,
    );
    expect(
      screen.queryByText(NOTIFICATION_LABELS.markAllRead),
    ).not.toBeInTheDocument();
  });

  it("paints no optimistic read state", () => {
    const code = strip(
      read("components/supplier/supplier-notification-list.tsx"),
    );

    expect(code).toContain("router.refresh()");
    expect(code).not.toContain("setItems");
    expect(code).not.toContain("optimistic");
  });

  it("mentions no email, outbox or delivery status", () => {
    // Stripped: the file's own comment says these are deliberately not
    // here, and a comment documenting an absence is not the thing.
    const code = strip(
      read("components/supplier/supplier-notification-list.tsx"),
    ).toLowerCase();
    const messages = JSON.stringify(
      JSON.parse(read("messages/ar-SA.json")).supplier.notifications,
    );

    for (const forbidden of [
      "email",
      "outbox",
      "delivered to",
      "بريد",
      "صندوق الصادر",
    ]) {
      expect(code, forbidden).not.toContain(forbidden.toLowerCase());
      expect(messages, forbidden).not.toContain(forbidden);
    }
  });
});

describe("supplier notification routing", () => {
  it("sends a settlement notification to a REAL settlement page", () => {
    // Unlike the trader resolver, which returns null: a settlement pays
    // the supplier and this is where it is explained.
    expect(
      supplierNotificationHref(
        {
          type: "SETTLEMENT_EXECUTED",
          entityType: "supplier_payout",
          entityId: "s-1",
          params: {},
        } as never,
        "ar-SA",
      ),
    ).toBe("/ar-SA/supplier/settlements/s-1");
  });

  it("routes orders, disputes and replacements to supplier pages", () => {
    expect(
      supplierNotificationHref(
        {
          type: "ORDER_CREATED",
          entityType: "master_order",
          entityId: "o-1",
          params: {},
        } as never,
        "ar-SA",
      ),
    ).toBe("/ar-SA/supplier/orders/o-1");

    expect(
      supplierNotificationHref(
        {
          type: "DISPUTE_OPENED",
          entityType: "dispute",
          entityId: "d-1",
          params: {},
        } as never,
        "ar-SA",
      ),
    ).toBe("/ar-SA/supplier/disputes/d-1");

    expect(
      supplierNotificationHref(
        {
          type: "REPLACEMENT_REQUIRED",
          entityType: "replacement_obligation",
          entityId: "r-1",
          params: {},
        } as never,
        "ar-SA",
      ),
    ).toBe("/ar-SA/supplier/replacement-obligations/r-1");
  });

  it("returns null for a checkout session, which is the trader's", () => {
    expect(
      supplierNotificationHref(
        {
          type: "PAYMENT_SUCCEEDED",
          entityType: "checkout_session",
          entityId: "c-1",
          params: {},
        } as never,
        "ar-SA",
      ),
    ).toBeNull();
  });

  it("never points at a trader route", () => {
    const code = read("lib/supplier-notification-link.ts");
    const paths = [...code.matchAll(/\$\{locale\}\/([a-z-]+)/g)].map(
      (m) => m[1],
    );

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path).toBe("supplier");
  });

  it("translates every notification type in both locales", () => {
    for (const locale of ["ar-SA.json", "en-SA.json"]) {
      const types = JSON.parse(read(`messages/${locale}`)).supplier
        .notifications.type;
      expect(Object.keys(types).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    }
  });
});

// --------------------------------------------------- opportunity form

const OPP_FILLED: OpportunityFormValues = {
  productId: "11111111-1111-4111-8111-111111111111",
  fulfillmentLocationId: "22222222-2222-4222-8222-222222222222",
  targetQuantity: "100",
  unitPriceAmount: "11.50",
  startAt: "2026-09-01T08:00",
  endAt: "2026-09-20T08:00",
  expectedPreparationDays: "3",
  descriptionAr: "",
  descriptionEn: "",
};

describe("the opportunity form's rules", () => {
  it("passes a complete form and reports every gap at once", () => {
    expect(validateOpportunityForm(OPP_FILLED)).toEqual({});
    expect(
      Object.keys(validateOpportunityForm(EMPTY_OPPORTUNITY_FORM)).sort(),
    ).toEqual(
      [
        "productId",
        "fulfillmentLocationId",
        "unitPriceAmount",
        "targetQuantity",
        "expectedPreparationDays",
        "startAt",
        "endAt",
      ].sort(),
    );
  });

  it.each(["1e3", "12,50", "+5", "5.", "abc", "-1", "0"])(
    "refuses %s as a price before anything parses it",
    (bad) => {
      expect(
        validateOpportunityForm({ ...OPP_FILLED, unitPriceAmount: bad })
          .unitPriceAmount,
      ).toBeTruthy();
    },
  );

  it("bounds the price to the money scale and the column ceiling", () => {
    expect(
      validateOpportunityForm({ ...OPP_FILLED, unitPriceAmount: "11.505" })
        .unitPriceAmount,
    ).toEqual({ key: "tooPrecise", values: { scale: 2 } });
    expect(
      validateOpportunityForm({
        ...OPP_FILLED,
        unitPriceAmount: "9999999999.99",
      }).unitPriceAmount,
    ).toBeUndefined();
    expect(
      validateOpportunityForm({
        ...OPP_FILLED,
        unitPriceAmount: "10000000000.00",
      }).unitPriceAmount,
    ).toBeTruthy();
  });

  it.each(["1.5", "0", "-3", "abc", "1e3"])(
    "refuses %s as a quantity",
    (bad) => {
      expect(
        validateOpportunityForm({ ...OPP_FILLED, targetQuantity: bad })
          .targetQuantity,
      ).toBeTruthy();
    },
  );

  it("requires the window to end after it starts", () => {
    expect(
      validateOpportunityForm({ ...OPP_FILLED, endAt: "2026-08-01T08:00" })
        .endAt,
    ).toEqual({ key: "endBeforeStart" });
  });

  it("states no duration or quantity bound it cannot know", () => {
    // Those are admin-configured and no endpoint exposes them, so the
    // server refuses and names the bound instead.
    const code = strip(read("lib/opportunity-form.ts"));

    expect(code).not.toContain("minDurationHours");
    expect(code).not.toContain("maxDurationDays");
    expect(code).not.toContain("minTargetQuantity");
  });

  it("converts to JSON numbers once, at the boundary", () => {
    const body = toCreateOpportunityBody(OPP_FILLED);

    expect(typeof body.unitPriceAmount).toBe("number");
    expect(body.unitPriceAmount).toBe(11.5);
    expect(body.targetQuantity).toBe(100);
    expect(body.expectedPreparationDays).toBe(3);
    // Dates become ISO at the boundary too.
    expect(body.startAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("omits an empty optional rather than sending null", () => {
    // `UpdateOpportunityDto` accepts no null — clearing a description is
    // not something this endpoint offers.
    const body = toCreateOpportunityBody(OPP_FILLED);

    expect("descriptionAr" in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain("null");
  });

  it("PATCHes only what changed", () => {
    expect(toUpdateOpportunityBody(OPP_FILLED, OPP_FILLED)).toEqual({});
    expect(
      toUpdateOpportunityBody(
        { ...OPP_FILLED, targetQuantity: "200" },
        OPP_FILLED,
      ),
    ).toEqual({
      targetQuantity: 200,
    });
  });

  it("does not re-send a date the reader never touched", () => {
    // Compared as the LOCAL strings they were shown as, so a round trip
    // through `toIso` cannot make an untouched value look edited.
    const initial = opportunityFormFromDetail({
      productId: OPP_FILLED.productId,
      fulfillmentLocationId: OPP_FILLED.fulfillmentLocationId,
      targetQuantity: 100,
      unitPriceAmount: "11.50",
      startAt: "2026-09-01T05:00:00.000Z",
      endAt: "2026-09-20T05:00:00.000Z",
      expectedPreparationDays: 3,
      descriptionAr: null,
      descriptionEn: null,
    } as never);

    expect(toUpdateOpportunityBody(initial, initial)).toEqual({});
    expect(isOpportunityDirty(initial, initial)).toBe(false);
  });

  it("renders the window in the business zone, not the browser's", () => {
    // Every deadline in this product is enforced in Asia/Riyadh; showing
    // a supplier abroad their own zone would show a different cut-off
    // from the one that applies.
    expect(toLocalInput("2026-09-01T05:00:00.000Z")).toBe("2026-09-01T08:00");
  });

  it("keeps the price string exactly as the API sent it", () => {
    const values = opportunityFormFromDetail({
      productId: "p",
      fulfillmentLocationId: "l",
      targetQuantity: 1,
      unitPriceAmount: "11.50",
      startAt: "2026-09-01T05:00:00.000Z",
      endAt: "2026-09-20T05:00:00.000Z",
      expectedPreparationDays: 1,
      descriptionAr: null,
      descriptionEn: null,
    } as never);

    expect(values.unitPriceAmount).toBe("11.50");
  });

  it("computes no total, tax split or share size", () => {
    const code = strip(read("lib/opportunity-form.ts"));
    const form = strip(read("components/supplier/opportunity-form.tsx"));

    for (const source of [code, form]) {
      expect(source).not.toMatch(/unitPrice[^\n]*\*/);
      expect(source).not.toContain("taxRatePercent");
      expect(source).not.toContain("totalValue");
      expect(source).not.toContain("shareQuantity");
    }
  });
});

describe("ACTION_REQUIRED reaches a real fix", () => {
  it("maps seven reasons to a field and four to nowhere on the form", () => {
    const mapped = SUPPLIER_OPPORTUNITY_REASON_CODES.filter(
      (code) => reasonField(code) !== null,
    );
    const elsewhere = SUPPLIER_OPPORTUNITY_REASON_CODES.filter(
      (code) => reasonField(code) === null,
    );

    // SEVEN since LOCATION_REGION_INACTIVE joined: the region is what a
    // branch is recorded against, and the fix is the same field — pick
    // a different branch.
    expect(mapped).toHaveLength(7);
    expect(elsewhere.sort()).toEqual(
      [
        "PRODUCT_NOT_APPROVED",
        "SUPPLIER_NOT_VERIFIED",
        "SUPPLIER_NOT_FINANCIALLY_READY",
        "TAX_RATE_NOT_CONFIGURED",
      ].sort(),
    );
  });

  it("routes a location reason to the location field", () => {
    expect(reasonField("LOCATION_INACTIVE")).toBe("fulfillmentLocationId");
    expect(reasonField("LOCATION_CITY_INACTIVE")).toBe("fulfillmentLocationId");
    expect(reasonField("PURCHASE_QUANTITY_NOT_COMPATIBLE")).toBe(
      "targetQuantity",
    );
  });

  it("says plainly when the form cannot fix it", () => {
    const page = strip(
      read("app/[locale]/supplier/opportunities/[id]/edit/page.tsx"),
    );

    expect(page).toContain("reasonField(inlineReason) === null");
    expect(page).toContain("fixedElsewhere");
  });

  it("has a fix for every reason in both locales", () => {
    for (const locale of ["ar-SA.json", "en-SA.json"]) {
      const fixes = JSON.parse(read(`messages/${locale}`)).supplier
        .opportunities.reasonFix;
      expect(Object.keys(fixes).sort()).toEqual(
        [...SUPPLIER_OPPORTUNITY_REASON_CODES].sort(),
      );
    }
  });
});

// ------------------------------------------------------------ the pages

describe("every supplier page", () => {
  it("covers every route the portal now offers", () => {
    // THREE READ-ONLY ACCOUNT SCREENS ARE GONE — company, locations and
    // bank account. None of them could change anything, which is why a
    // supplier could not add its own branch or its own payout account;
    // all three are cards inside «بيانات المنشأة» now. Billing keeps its
    // page: it is a different concern, still entered after approval.
    //
    // AND THE TWO LISTS ARE TWO THINGS AGAIN. `products` holds the
    // supplier's own record of what it stocks and nobody else sees;
    // `opportunities` holds the offers made on those records, one after
    // another on the same product. Creating an offer is the one address
    // that sits under the PRODUCT — `products/[id]/offers/new` — because
    // an offer with no product to be an offer ON is not a thing.
    expect(PAGES.sort()).toEqual(
      [
        "supplier/page.tsx",
        "supplier/account/page.tsx",
        "supplier/account/billing/page.tsx",
        "supplier/disputes/page.tsx",
        "supplier/disputes/[id]/page.tsx",
        "supplier/notifications/page.tsx",
        "supplier/products/page.tsx",
        "supplier/products/[id]/page.tsx",
        "supplier/products/[id]/edit/page.tsx",
        // TWO WAYS TO SELL ONE PRODUCT, and each has its own address
        // under it — «بجانب المنتج خياران واضحان: بيع مباشر وإنشاء
        // عرض». They are the same form with one field's difference, and
        // separate routes are what let each open with its own title,
        // its own buttons and its own notice about a listing already
        // running in THAT mode.
        "supplier/products/[id]/direct/new/page.tsx",
        "supplier/products/[id]/offers/new/page.tsx",
        "supplier/products/new/page.tsx",
        "supplier/orders/page.tsx",
        "supplier/orders/[id]/page.tsx",
        "supplier/follow-up/page.tsx",
        "supplier/opportunities/page.tsx",
        "supplier/opportunities/[id]/page.tsx",
        "supplier/opportunities/[id]/edit/page.tsx",
        "supplier/opportunities/new/page.tsx",
        "supplier/replacement-obligations/page.tsx",
        "supplier/replacement-obligations/[id]/page.tsx",
        "supplier/settlements/page.tsx",
        "supplier/settlements/[id]/page.tsx",
      ].sort(),
    );
  });

  it("keeps every RETIRED address as a forward, never as a dead end", () => {
    // Six addresses now point somewhere rather than answering:
    //
    //   opportunities/new        an offer is created ON a product
    //   settlements              «المتابعة» holds the payouts
    //   disputes                 and the disputes
    //   replacement-obligations  and the returns
    //   account/billing          «بيانات المنشأة» already shows and
    //                            edits those two fields
    //
    // Each still re-guards, so a visitor with no session meets the
    // sign-in page here rather than being bounced to an address that
    // then sends them there.
    const FORWARDS: Record<string, string> = {
      "supplier/settlements/page.tsx": "/supplier/follow-up",
      "supplier/disputes/page.tsx": "/supplier/follow-up",
      "supplier/replacement-obligations/page.tsx": "/supplier/follow-up",
      "supplier/account/billing/page.tsx": "/supplier/account",
    };

    for (const [page, destination] of Object.entries(FORWARDS)) {
      expect([page, PAGES.includes(page)]).toEqual([page, true]);
      const source = strip(read(`app/[locale]/${page}`));
      expect([page, source.includes("redirect(")]).toEqual([page, true]);
      expect([page, source.includes(destination)]).toEqual([page, true]);
      expect([
        page,
        source.includes('requireRoleOrRedirect(appLocale, "SUPPLIER")'),
      ]).toEqual([page, true]);
    }

    // AND THE RECORDS THEY LED TO ARE UNTOUCHED. A link in a
    // notification sent last month still opens the settlement, the
    // dispute or the return it named.
    for (const detail of [
      "supplier/settlements/[id]/page.tsx",
      "supplier/disputes/[id]/page.tsx",
      "supplier/replacement-obligations/[id]/page.tsx",
    ]) {
      expect([detail, PAGES.includes(detail)]).toEqual([detail, true]);
      expect([detail, strip(read(`app/[locale]/${detail}`)).includes("redirect(")]).toEqual([
        detail,
        false,
      ]);
    }
  });

  it("keeps the offer-creation address as a FORWARD, never as a dead end", () => {
    // A page that merely redirects still re-guards — a visitor with no
    // session meets the sign-in page here rather than being bounced to
    // an address that then sends them there.
    //
    // ONE FORWARD IS LEFT under «عروضي»: the offer list and the offer's
    // own pages all answer again, and only `opportunities/new` has
    // nowhere of its own to go — an offer is created on a product, so
    // the address that named "create an offer" with no product now
    // points at the catalogue, which is the question it used to open by
    // asking.
    const RETIRED = ["supplier/opportunities/new/page.tsx"];
    expect(PAGES).toContain(RETIRED[0]);

    for (const page of RETIRED) {
      const source = strip(read(`app/[locale]/${page}`));
      expect([page, source.includes("redirect(")]).toEqual([page, true]);
      expect([page, source.includes("/supplier/products")]).toEqual([page, true]);
      expect([page, source.includes('requireRoleOrRedirect(appLocale, "SUPPLIER")')]).toEqual([
        page,
        true,
      ]);
    }
  });

  it.each(PAGES)(
    "%s re-guards, adds no shell and declares no cache directive",
    (page) => {
      const source = strip(read(`app/[locale]/${page}`));

      expect(source).toContain('requireRoleOrRedirect(appLocale, "SUPPLIER")');
      expect(source).not.toContain("<AppShell");
      expect(source).not.toContain("force-dynamic");
      expect(source).not.toContain("generateStaticParams");
    },
  );

  it.each(
    PAGES.filter(
      (page) => page.includes("[id]") && !page.startsWith("supplier/opportunities/"),
    ),
  )(
    "%s answers unknown and cross-company with a real 404",
    (page) => {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source).toContain("notFound()");
    },
  );

  it("builds no standalone documents page", () => {
    // `GET /supplier/orders/:id/documents` is per-order with no flat
    // list; a standalone page could only fan out over the orders list.
    expect(existsSync(join(SUPPLIER_DIR, "documents"))).toBe(false);
    expect(PAGES.some((page) => page.includes("documents"))).toBe(false);
    expect(strip(read("app/[locale]/supplier/orders/[id]/page.tsx"))).toContain(
      "loadSupplierOrderDocuments",
    );
  });

  it("shows no trader identity, storage key or admin note anywhere", () => {
    // Comments stripped: several pages document by name what they
    // deliberately do NOT carry, and that documentation is the opposite
    // of the leak.
    for (const page of PAGES) {
      const source = strip(read(`app/[locale]/${page}`));
      for (const forbidden of [
        "traderCompanyId",
        "storageObjectKey",
        "objectKey",
        "reasonNote",
        "decidedByAdminUserId",
        "externalTransferReference",
        "executedByAdminUserId",
        "supplierBankAccountId",
        "journalEntry",
        "latitude",
        "longitude",
      ]) {
        expect([page, forbidden, source.includes(forbidden)]).toEqual([
          page,
          forbidden,
          false,
        ]);
      }
    }
  });

  it("makes no tax-invoice claim on any page", () => {
    for (const page of PAGES) {
      const source = strip(read(`app/[locale]/${page}`));
      for (const forbidden of ["ZATCA", "qrCode", "clearance", "taxInvoice"]) {
        expect([page, forbidden, source.includes(forbidden)]).toEqual([
          page,
          forbidden,
          false,
        ]);
      }
    }
  });

  it("keeps every supplier read no-store with a forwarded cookie", () => {
    const code = strip(read("lib/supplier-data.ts"));
    const requests = code.match(/apiClient\.get<[^>]*>\([^)]*\)/gs) ?? [];

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request).toContain('cache: "no-store"');
      expect(request).toContain("cookieHeader");
    }
  });

  it("links every nav destination to a page that exists", async () => {
    const { SUPPLIER_PORTAL_MAP } =
      await import("@/components/supplier/supplier-portal-nav");
    const { portalPages } = await import("@/components/portal/portal-nav");

    for (const page of portalPages(SUPPLIER_PORTAL_MAP)) {
      const expected = page.segment
        ? `supplier/${page.segment}/page.tsx`
        : "supplier/page.tsx";

      expect(PAGES, page.key).toContain(expected);
    }
  });

  it("points every dashboard destination at a real screen", () => {
    // THE DESTINATIONS MOVED WITH THE PANELS. The home screen was
    // rebuilt to the owner's approved reference and its links now live
    // in the panel components; the RULE is unchanged — every place the
    // dashboard sends somebody has to be a page that exists.
    const panels = strip(read("components/supplier/dashboard-panels.tsx"));
    const hrefs = [
      ...panels.matchAll(/\/\$\{locale\}\/supplier\/([a-z-]*)/g),
    ].map((m) => m[1]);

    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    for (const segment of hrefs) {
      const expected = segment
        ? `supplier/${segment}/page.tsx`
        : "supplier/page.tsx";
      expect(PAGES, segment).toContain(expected);
    }
  });
});

describe("message parity across the whole supplier namespace", () => {
  const flatten = (value: unknown, prefix = ""): string[] =>
    typeof value !== "object" || value === null
      ? [prefix]
      : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
          flatten(v, prefix ? `${prefix}.${k}` : k),
        );

  it("ships identical keys in both locales", () => {
    const ar = JSON.parse(read("messages/ar-SA.json")).supplier;
    const en = JSON.parse(read("messages/en-SA.json")).supplier;

    expect(flatten(ar).sort()).toEqual(flatten(en).sort());
  });

  it("gives every allocation, replacement and dispute status a next step", () => {
    const ar = JSON.parse(read("messages/ar-SA.json")).supplier;

    expect(Object.keys(ar.replacements.nextStep).sort()).toEqual(
      [
        "AWAITING_PREPARATION",
        "PREPARING",
        "READY_TO_SHIP",
        "SHIPPED",
        "DELIVERED",
        "FAILED",
      ].sort(),
    );
    expect(Object.keys(ar.disputes.nextStep).sort()).toEqual(
      [
        "OPEN",
        "SUPPLIER_RESPONDED",
        "AWAITING_REPLACEMENT",
        "RESOLVED_ACCEPTED",
        "RESOLVED_PARTIAL",
        "RESOLVED_REJECTED",
        "RESOLVED_REPLACED",
      ].sort(),
    );
  });

  it("names every fulfilment action segment in both locales", () => {
    const segments = Object.values(SUPPLIER_ALLOCATION_ACTIONS).sort();

    for (const locale of ["ar-SA.json", "en-SA.json"]) {
      const fulfilment = JSON.parse(read(`messages/${locale}`)).supplier
        .fulfilment;
      expect(Object.keys(fulfilment.action).sort()).toEqual(segments);
      expect(Object.keys(fulfilment.prompt).sort()).toEqual(segments);
    }
  });
});
