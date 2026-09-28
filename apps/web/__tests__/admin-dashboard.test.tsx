import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { AdminOrderStageInsight, FollowUpCase } from "@platform/types";
import messages from "@/messages/ar-SA.json";
import en from "@/messages/en-SA.json";
import {
  Delta,
  MetricCard,
  PeriodPicker,
} from "@/components/admin/dashboard-chrome";
import {
  GrowthChart,
  LineChart,
  StatusBar,
} from "@/components/admin/dashboard-charts";
import { NeedsAttention } from "@/components/admin/dashboard-panels";
import {
  hasDrawableTrend,
  niceAxis,
  niceCountAxis,
} from "@/lib/dashboard-scale";
import { formatMoney } from "@/lib/money";
import { OrderStagePath } from "@/components/admin/order-stage-path";
import { FollowUpTable } from "@/components/admin/follow-up-table";

/**
 * The three screens of the overview decision.
 *
 * What is pinned here is the handful of things that would be wrong in a
 * way nobody notices: a comparison rendered as 0% when it could not be
 * made, a figure whose label sits at the other end of the card, a
 * follow-up case that disappears because somebody looked at it.
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const OVERVIEW = strip(read("app/[locale]/admin/page.tsx"));
const ORDERS = strip(read("app/[locale]/admin/orders/page.tsx"));
const FOLLOW_UP = strip(read("app/[locale]/admin/follow-up/page.tsx"));
const PANELS = strip(read("components/admin/dashboard-panels.tsx"));

const push = vi.fn();
const refresh = vi.fn();
const post = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/ar-SA/admin/orders",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: { post: (...args: unknown[]) => post(...args) },
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}));

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  post.mockReset().mockResolvedValue({});
  search = "";
});

describe("a comparison that cannot be made is an em dash", () => {
  it("renders `—` for null, not 0%", () => {
    wrap(<Delta value={null} testId="delta" />);

    // "0%" would claim nothing moved when in truth nothing was known —
    // the first week of trading, or a period with no predecessor.
    expect(screen.getByTestId("delta")).toHaveTextContent("—");
    expect(screen.getByTestId("delta")).not.toHaveTextContent("0%");
  });

  it("renders a rise and a fall with their signs", () => {
    const { rerender } = wrap(<Delta value={12.4} testId="delta" />);
    expect(screen.getByTestId("delta")).toHaveTextContent("+12.4%");

    rerender(
      <NextIntlClientProvider locale="ar-SA" messages={messages}>
        <Delta value={-3.1} testId="delta" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("delta")).toHaveTextContent("-3.1%");
  });

  it("renders no change as a real zero", () => {
    wrap(<Delta value={0} testId="delta" />);

    // Zero here is a measurement, not a missing one.
    expect(screen.getByTestId("delta")).toHaveTextContent("0%");
  });
});

describe("the metric cards", () => {
  it("keeps the figure under its own label in Arabic", () => {
    wrap(
      <MetricCard
        testId="card"
        icon={<span />}
        label="إيرادات المنصة"
        value="128,475.00 ر.س"
        delta={8.7}
        note="متوسط العمولة 10%"
      />,
    );

    const card = screen.getByTestId("card");
    // `dir="ltr"` on the value would move it to the opposite end of the
    // card from its label; `<bdi>` isolates the digits without doing
    // that.
    expect(card.querySelector("bdi")).not.toBeNull();
    expect(card.querySelector('[dir="ltr"]')).toBeNull();
    expect(card).toHaveTextContent("128,475.00");
  });

  it("carries no sparkline", () => {
    const chrome = strip(read("components/admin/dashboard-chrome.tsx"));

    // The approved design says numbers and arrows. A twelve-pixel chart
    // says less than the arrow and takes the note's space.
    expect(chrome).not.toContain("sparkline");
    expect(chrome).not.toContain("<svg");
  });
});

describe("the period control", () => {
  it("puts the window in the URL", async () => {
    const user = userEvent.setup();
    wrap(
      <PeriodPicker
        period="30d"
        generatedAt="اليوم 10:35 ص"
        labels={{
          label: "الفترة",
          comparison: "مقارنة بالفترة السابقة",
          lastUpdated: "آخر تحديث:",
          refresh: "تحديث",
          options: {
            "7d": "آخر 7 أيام",
            "30d": "آخر 30 يومًا",
            "90d": "آخر 90 يومًا",
            ytd: "هذا العام",
          },
        }}
      />,
    );

    await user.selectOptions(screen.getByTestId("period-select"), "7d");

    await waitFor(() => expect(push).toHaveBeenCalled());
    // In the URL, so it survives a reload, travels with the links to
    // the other two screens, and comes back with the Back button.
    expect(push.mock.calls[0][0]).toContain("period=7d");
  });

  it("returns to page one, because a new window is a new result set", async () => {
    search = "page=4";
    const user = userEvent.setup();
    wrap(
      <PeriodPicker
        period="30d"
        generatedAt="—"
        labels={{
          label: "الفترة",
          comparison: "—",
          lastUpdated: "—",
          refresh: "تحديث",
          options: { "7d": "7", "30d": "30", "90d": "90", ytd: "y" },
        }}
      />,
    );

    await user.selectOptions(screen.getByTestId("period-select"), "90d");

    expect(push.mock.calls[0][0]).not.toContain("page=");
  });

  it("offers a manual refresh", async () => {
    const user = userEvent.setup();
    wrap(
      <PeriodPicker
        period="30d"
        generatedAt="—"
        labels={{
          label: "الفترة",
          comparison: "—",
          lastUpdated: "آخر تحديث:",
          refresh: "تحديث",
          options: { "7d": "7", "30d": "30", "90d": "90", ytd: "y" },
        }}
      />,
    );

    await user.click(screen.getByTestId("refresh"));

    expect(refresh).toHaveBeenCalled();
  });
});

describe("the charts", () => {
  /** Two buckets carrying a value: enough to have a shape. */
  const points = [
    { at: "2026-08-01T00:00:00.000Z", label: "1", value: "1000.00" },
    { at: "2026-08-08T00:00:00.000Z", label: "2", value: "2500.00" },
  ];

  const chartLabels = {
    chart: "قيمة الطلبات",
    units: { thousand: "ألف", million: "مليون" },
    bucketNames: ["الأسبوع 1", "الأسبوع 2"],
    notEnoughData: "لا توجد بيانات كافية لرسم الاتجاه خلال هذه الفترة",
  };

  it("draws the value and the revenue as SEPARATE panels", () => {
    // On one axis the commission is a flat line along the bottom: the
    // two differ by an order of magnitude.
    expect(PANELS).toContain('testId: "chart-paid-orders"');
    expect(PANELS).toContain('testId: "chart-revenue"');
    expect(PANELS).toMatch(/tone: "primary"/);
    expect(PANELS).toMatch(/tone: "accent"/);
  });

  it("names each chart for a reader who cannot see it", () => {
    wrap(
      <LineChart
        points={points}
        granularity="weekly"
        locale="ar-SA"
        tone="primary"
        drawable
        labels={chartLabels}
        testId="chart"
      />,
    );

    expect(
      screen.getByRole("img", { name: "قيمة الطلبات" }),
    ).toBeInTheDocument();
  });

  /**
   * THE MISLEADING SHAPE, refused.
   *
   * One bucket with a value between buckets that simply have no orders
   * yet draws a spike out of nothing and back into nothing — a reader
   * sees a business that appeared and collapsed inside a month. The
   * total is still shown, by the panel; the line is not.
   */
  it("refuses to draw a trend from a single point", () => {
    const lonely = [
      { at: "2026-08-01T00:00:00.000Z", label: "1", value: "0" },
      { at: "2026-08-08T00:00:00.000Z", label: "2", value: "2925.00" },
      { at: "2026-08-15T00:00:00.000Z", label: "3", value: "0" },
    ];

    expect(hasDrawableTrend(lonely)).toBe(false);

    wrap(
      <LineChart
        points={lonely}
        granularity="weekly"
        locale="ar-SA"
        tone="primary"
        drawable={hasDrawableTrend(lonely)}
        labels={{
          ...chartLabels,
          bucketNames: ["الأسبوع 1", "الأسبوع 2", "الأسبوع 3"],
        }}
        testId="chart"
      />,
    );

    expect(screen.getByTestId("chart-insufficient")).toHaveTextContent(
      "لا توجد بيانات كافية لرسم الاتجاه",
    );
    // No line, no area, no spike.
    expect(screen.queryByRole("img", { name: "قيمة الطلبات" })).toBeNull();
  });

  it("draws the line once two buckets carry a value", () => {
    expect(hasDrawableTrend(points)).toBe(true);

    wrap(
      <LineChart
        points={points}
        granularity="weekly"
        locale="ar-SA"
        tone="primary"
        drawable
        labels={chartLabels}
        testId="chart"
      />,
    );

    expect(screen.queryByTestId("chart-insufficient")).toBeNull();
    expect(
      screen.getByRole("img", { name: "قيمة الطلبات" }),
    ).toBeInTheDocument();
  });

  it("survives a period with no data at all", () => {
    const empty = [
      { at: "2026-08-01T00:00:00.000Z", label: "1", value: "0" },
      { at: "2026-08-08T00:00:00.000Z", label: "2", value: "0" },
    ];

    wrap(
      <LineChart
        points={empty}
        granularity="weekly"
        locale="ar-SA"
        tone="accent"
        drawable={hasDrawableTrend(empty)}
        labels={chartLabels}
        testId="chart"
      />,
    );

    // An empty window is a real answer, not a crash — and a flat line
    // along the axis says nothing the total does not already say.
    expect(screen.getByTestId("chart-insufficient")).toBeInTheDocument();
  });

  it("gives every bucket a name and its dates under the plot", () => {
    wrap(
      <LineChart
        points={points}
        granularity="weekly"
        locale="ar-SA"
        tone="primary"
        drawable
        labels={chartLabels}
        testId="chart"
      />,
    );

    const axis = screen.getByTestId("chart-axis");
    expect(axis).toHaveTextContent("الأسبوع 1");
    expect(axis).toHaveTextContent("الأسبوع 2");
    // The week's own dates, so "week 2" is not a number with no anchor.
    expect(axis.textContent).toMatch(/\d/);
  });

  it("gives the exact figure to a keyboard, not only to a mouse", async () => {
    const user = userEvent.setup();
    wrap(
      <LineChart
        points={points}
        granularity="weekly"
        locale="ar-SA"
        tone="primary"
        drawable
        labels={chartLabels}
        testId="chart"
      />,
    );

    await user.tab();
    await waitFor(() =>
      expect(screen.getByTestId("chart-tooltip")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("chart-tooltip")).toHaveTextContent("1000.00");
  });

  it("shows growth as pairs of columns, not a stack", () => {
    wrap(
      <GrowthChart
        points={[
          {
            at: "2026-08-01T00:00:00.000Z",
            label: "1",
            buyers: 70,
            suppliers: 36,
          },
          {
            at: "2026-08-08T00:00:00.000Z",
            label: "2",
            buyers: 88,
            suppliers: 47,
          },
        ]}
        granularity="weekly"
        locale="ar-SA"
        labels={{
          ...chartLabels,
          chart: "نمو المنشآت",
          buyers: "مشترون",
          suppliers: "موردون",
          empty: "لا توجد تسجيلات جديدة خلال هذه الفترة",
        }}
        testId="growth"
      />,
    );

    // A stacked bar answers "how many altogether", which is not the
    // question the card asks: each bucket gets its own two columns.
    expect(screen.getByTestId("growth-buyers-0")).toBeInTheDocument();
    expect(screen.getByTestId("growth-suppliers-0")).toBeInTheDocument();
    expect(screen.getByTestId("growth-buyers-1")).toBeInTheDocument();
    expect(screen.getByTestId("growth-suppliers-1")).toBeInTheDocument();
  });

  it("keeps a slot and a name for a bucket nobody registered in", () => {
    wrap(
      <GrowthChart
        points={[
          {
            at: "2026-08-01T00:00:00.000Z",
            label: "1",
            buyers: 0,
            suppliers: 0,
          },
          {
            at: "2026-08-08T00:00:00.000Z",
            label: "2",
            buyers: 4,
            suppliers: 1,
          },
        ]}
        granularity="weekly"
        locale="ar-SA"
        labels={{
          ...chartLabels,
          chart: "نمو المنشآت",
          buyers: "مشترون",
          suppliers: "موردون",
          empty: "لا توجد تسجيلات جديدة خلال هذه الفترة",
        }}
        testId="growth"
      />,
    );

    // The quiet week is a zero with a name under it, not a gap — and
    // not two columns floating in an empty card.
    expect(screen.getByTestId("growth-bucket-0")).toBeInTheDocument();
    expect(screen.getByTestId("growth-axis")).toHaveTextContent("الأسبوع 1");
  });

  it("says so plainly when nobody registered at all", () => {
    wrap(
      <GrowthChart
        points={[
          {
            at: "2026-08-01T00:00:00.000Z",
            label: "1",
            buyers: 0,
            suppliers: 0,
          },
          {
            at: "2026-08-08T00:00:00.000Z",
            label: "2",
            buyers: 0,
            suppliers: 0,
          },
        ]}
        granularity="weekly"
        locale="ar-SA"
        labels={{
          ...chartLabels,
          chart: "نمو المنشآت",
          buyers: "مشترون",
          suppliers: "موردون",
          empty: "لا توجد تسجيلات جديدة خلال هذه الفترة",
        }}
        testId="growth"
      />,
    );

    expect(screen.getByTestId("growth-empty")).toHaveTextContent(
      "لا توجد تسجيلات جديدة",
    );
  });

  it("keeps one registration a short column rather than a full card", () => {
    // A ceiling equal to the only value would draw a bar the height of
    // the plot and call it a scale.
    expect(niceCountAxis(1).ceiling).toBeGreaterThanOrEqual(4);
    expect(niceCountAxis(1).ticks.every((tick) => Number.isInteger(tick))).toBe(
      true,
    );
  });

  it("splits the orders bar into the three exclusive stages", () => {
    wrap(
      <StatusBar
        testId="status"
        segments={[
          { key: "completed", label: "مكتملة", count: 212, tone: "bg-primary" },
          {
            key: "inFulfilment",
            label: "قيد التنفيذ",
            count: 75,
            tone: "bg-accent",
          },
          { key: "troubled", label: "متعثرة", count: 25, tone: "bg-danger" },
        ]}
      />,
    );

    expect(screen.getByTestId("status-completed")).toHaveTextContent("212");
    expect(screen.getByTestId("status-inFulfilment")).toHaveTextContent("75");
    expect(screen.getByTestId("status-troubled")).toHaveTextContent("25");
  });
});

/**
 * WHAT AN ARROW MEANS, which is not the same as which way a number moved.
 *
 * More money taken is good news; more money refunded is not. Colouring
 * both green because the figure rose is the dashboard telling an
 * operator the opposite of the truth in the most confident way it has,
 * and it is silent — nothing throws, the number is even correct.
 */
describe("an arrow carries the meaning of its own metric", () => {
  function renderDelta(
    value: number | null,
    intent?: "more-is-good" | "more-is-bad" | "neutral",
  ) {
    const view = wrap(<Delta value={value} intent={intent} testId="delta" />);
    return { view, el: screen.getByTestId("delta") };
  }

  it("paints a rise in order value as success", () => {
    const { el } = renderDelta(12.4, "more-is-good");

    expect(el.className).toContain("text-success");
    expect(el).toHaveAttribute("data-direction", "up");
  });

  it("paints a fall in order value as a loss", () => {
    const { el } = renderDelta(-3.1, "more-is-good");

    expect(el.className).toContain("text-danger");
    expect(el).toHaveAttribute("data-direction", "down");
  });

  it("paints a RISE IN REFUNDS as a loss, not a success", () => {
    const { el } = renderDelta(4.2, "more-is-bad");

    // The arrow still points up — the figure did rise — but nothing on
    // this screen calls more money going back to buyers good news.
    expect(el).toHaveAttribute("data-direction", "up");
    expect(el.className).toContain("text-danger");
    expect(el.className).not.toContain("text-success");
  });

  it("paints a FALL IN REFUNDS as a success", () => {
    const { el } = renderDelta(-4.2, "more-is-bad");

    expect(el).toHaveAttribute("data-direction", "down");
    expect(el.className).toContain("text-success");
  });

  it("gives supplier payable no verdict at all", () => {
    const up = renderDelta(30, "neutral");
    expect(up.el.className).not.toContain("text-success");
    expect(up.el.className).not.toContain("text-danger");
    up.view.unmount();

    const down = renderDelta(-30, "neutral");
    expect(down.el.className).not.toContain("text-success");
    expect(down.el.className).not.toContain("text-danger");
  });

  it("draws NO ARROW when there is no comparison to make", () => {
    const { el } = renderDelta(null);

    expect(el).toHaveTextContent("—");
    expect(el.querySelector("svg")).toBeNull();
  });

  it("draws NO ARROW when nothing moved", () => {
    const { el } = renderDelta(0);

    // A figure that did not move did not rise, and an upward arrow
    // beside "0%" contradicts itself on one line.
    expect(el).toHaveTextContent("0%");
    expect(el).toHaveAttribute("data-direction", "flat");
    expect(el.querySelector("svg")).toBeNull();
  });

  it("assigns each card the intent its own figure deserves", () => {
    // Read from the page, because the intent is a decision the page
    // makes per metric — and getting it wrong is invisible in a
    // component test that passes its own prop.
    expect(OVERVIEW).toMatch(
      /testId="card-refunded"[\s\S]*?deltaIntent="more-is-bad"/,
    );
    expect(OVERVIEW).toMatch(
      /testId="card-payable"[\s\S]*?deltaIntent="neutral"/,
    );
    expect(OVERVIEW).toMatch(
      /testId="card-paid-orders"[\s\S]*?deltaIntent="more-is-good"/,
    );
    expect(OVERVIEW).toMatch(
      /testId="card-revenue"[\s\S]*?deltaIntent="more-is-good"/,
    );
  });
});

describe("money on a card", () => {
  it("puts the amount and the comparison on SEPARATE lines", () => {
    wrap(
      <MetricCard
        testId="card"
        icon={<span />}
        label="إجمالي قيمة الطلبات المدفوعة"
        value="2,925.00 ر.س"
        delta={null}
      />,
    );

    // The two used to share a line, which produced «2,925.00 ر.س. —» —
    // an amount and an em dash reading as one broken value.
    const value = screen.getByTestId("card").querySelector("bdi");
    expect(value).toHaveTextContent("2,925.00");
    expect(value?.textContent).not.toContain("—");
    expect(screen.getByTestId("card-delta")).toHaveTextContent("—");
  });

  it("shows a financial zero as an amount, never as a dash", () => {
    // A zero is a measurement: nothing was taken. A dash would mean
    // nobody knows, which is a different and worse claim.
    const zero = formatMoney("0.00", "SAR", "ar-SA");

    expect(zero).not.toBeNull();
    expect(zero).toContain("0.00");
    expect(zero).not.toContain("—");
  });

  it("formats from the decimal STRING, keeping the last place", () => {
    expect(formatMoney("1284750.55", "SAR", "en-SA")).toContain("1,284,750.55");
  });
});

describe("what fits on one screen", () => {
  /**
   * MEASURED IN THE SOURCE, not guessed. There is no layout engine in
   * this test runner, so what is pinned is the arrangement that makes
   * the height possible — the gaps, the paddings and the plot sizes
   * that were changed to bring the page back inside one window. The
   * rendered height itself is measured in a real browser and reported
   * separately.
   */
  it("keeps the overview to compact gaps", () => {
    expect(OVERVIEW).toContain('className="flex min-w-0 flex-col gap-3"');
    expect(OVERVIEW).not.toMatch(/flex-col gap-[5-9]/);
  });

  it("keeps the console's own inset tight", () => {
    const chrome = strip(read("components/portal/portal-chrome.tsx"));

    expect(chrome).toContain("py-4");

    // A DEEPER INSET EXISTS IN THIS FILE, and it is not the
    // console's: the supplier asks for a SHEET under its file tabs
    // and that sheet carries the page's padding. What this case
    // guards is that the console — which passes no such thing —
    // never picks it up, so every deeper figure must sit inside the
    // branch only a portal that asked for a surface can reach.
    const surface = chrome.slice(chrome.indexOf("mainSurface"));
    const before = chrome.slice(0, chrome.indexOf("mainSurface"));

    expect(before).not.toContain("py-6");
    for (const deeper of chrome.match(/py-6/g) ?? []) {
      expect([deeper, surface.includes(deeper)]).toEqual([deeper, true]);
    }
  });

  it("draws no breadcrumb on the segment root", () => {
    // A trail whose only entry is the page the reader is already on
    // says nothing and costs a row the charts need.
    const chrome = strip(read("components/portal/portal-chrome.tsx"));

    expect(chrome).toContain('here.page.segment !== ""');
  });

  it("keeps the eight cards in two rows of four", () => {
    expect(OVERVIEW).toContain("sm:grid-cols-2 lg:grid-cols-4");
  });

  it("puts the two chart panels and the two summary panels side by side", () => {
    const rows =
      OVERVIEW.match(/lg:grid-cols-\[minmax\(0,7fr\)_minmax\(0,5fr\)\]/g) ?? [];
    expect(rows).toHaveLength(2);
  });

  it("holds the approved order of the six blocks", () => {
    // The USAGE, not the import: the import list is alphabetical, so
    // matching a bare name would measure the wrong thing entirely.
    const order = [
      "<PeriodPicker",
      'testId="card-paid-orders"',
      'testId="card-payment-rate"',
      "<FinancialPerformance",
      "<CompanyGrowth",
      "<OrderStatus",
      "<NeedsAttention",
    ].map((token) => OVERVIEW.indexOf(token));

    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("the axis a person would draw", () => {
  it("rounds a ceiling up to a readable number", () => {
    expect(niceAxis(383_177).ceiling).toBe(400_000);
    expect(niceAxis(1_284_750).ceiling).toBe(1_500_000);
  });

  it("always reaches the largest value", () => {
    for (const max of [1, 7, 99, 2925, 128_475, 1_284_750]) {
      expect(niceAxis(max).ceiling).toBeGreaterThanOrEqual(max);
    }
  });

  it("gives an empty series a real baseline rather than nothing", () => {
    // "Everything is zero" is an answer, and it deserves an axis.
    expect(niceAxis(0).ticks).toEqual([0, 1]);
  });

  it("counts people in whole numbers", () => {
    for (const max of [1, 3, 5, 31]) {
      expect(niceCountAxis(max).ticks.every(Number.isInteger)).toBe(true);
    }
  });
});

describe("the needs-attention panel", () => {
  const rows = [
    {
      kind: "PAYMENT_REPEATEDLY_FAILED" as const,
      count: 8,
      priority: "CRITICAL" as const,
      oldestAgeHours: 2,
      href: "/admin/orders?stage=troubled",
    },
    {
      kind: "SETTLEMENT_OVERDUE" as const,
      count: 3,
      priority: "CRITICAL" as const,
      oldestAgeHours: 144,
      href: "/admin/settlements",
    },
    {
      kind: "BANK_ACCOUNT_REVIEW" as const,
      count: 5,
      priority: "REVIEW" as const,
      oldestAgeHours: 40,
      href: "/admin/bank-accounts",
    },
    {
      kind: "DISPUTE_OPEN" as const,
      count: 3,
      priority: "OVERDUE" as const,
      oldestAgeHours: 96,
      href: "/admin/disputes",
    },
    {
      kind: "SUPPLIER_VERIFICATION" as const,
      count: 8,
      priority: "REVIEW" as const,
      oldestAgeHours: 12,
      href: "/admin/companies",
    },
  ];

  const labels = {
    title: "يتطلب انتباهك",
    link: "عرض جميع التنبيهات",
    empty: "لا توجد حالات تحتاج تدخلًا",
    caseName: (row: { kind: string; count: number }) =>
      `${row.count} — ${row.kind}`,
    priorityName: (priority: string) => priority,
    age: (hours: number) => `منذ ${hours} ساعة`,
  };

  it("shows at most four, most urgent first and oldest within a priority", () => {
    wrap(
      <NeedsAttention
        rows={rows}
        locale="ar-SA"
        href="/ar-SA/admin/follow-up"
        labels={labels}
      />,
    );

    const shown = screen.getAllByTestId(/^attention-/);
    expect(shown).toHaveLength(4);

    const order = shown.map((el) => el.getAttribute("data-testid"));
    // Both criticals first, the older of the two leading; then the
    // overdue; then the older review. SUPPLIER_VERIFICATION is the fifth
    // and is the one dropped — the newest row of the lowest priority.
    expect(order).toEqual([
      "attention-SETTLEMENT_OVERDUE",
      "attention-PAYMENT_REPEATEDLY_FAILED",
      "attention-DISPUTE_OPEN",
      "attention-BANK_ACCOUNT_REVIEW",
    ]);
  });

  it("says so in one line when nothing is waiting", () => {
    wrap(
      <NeedsAttention
        rows={[]}
        locale="ar-SA"
        href="/ar-SA/admin/follow-up"
        labels={labels}
      />,
    );

    expect(screen.getByTestId("attention-empty")).toHaveTextContent(
      "لا توجد حالات تحتاج تدخلًا",
    );
    expect(screen.queryAllByTestId(/^attention-[A-Z]/)).toHaveLength(0);
  });

  it("leads to the whole list with a real control, not an underlined phrase", () => {
    wrap(
      <NeedsAttention
        rows={rows}
        locale="ar-SA"
        href="/ar-SA/admin/follow-up"
        labels={labels}
      />,
    );

    const link = screen.getByTestId("link-follow-up");
    expect(link).toHaveAttribute("href", "/ar-SA/admin/follow-up");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.className).not.toContain("underline");
  });

  it("OPENS a case without closing it", () => {
    wrap(
      <NeedsAttention
        rows={rows}
        locale="ar-SA"
        href="/ar-SA/admin/follow-up"
        labels={labels}
      />,
    );

    // A link, so nothing is mutated by looking — the row is still there
    // on the way back.
    const row = screen.getByTestId("attention-SETTLEMENT_OVERDUE");
    expect(row.tagName).toBe("A");
    expect(row).toHaveAttribute("href", "/ar-SA/admin/settlements");
  });
});

describe("the orders path", () => {
  const INSIGHT: AdminOrderStageInsight = {
    paid: 312,
    inFulfilment: 75,
    completed: 212,
    troubled: 25,
    paymentSuccessRate: 94.8,
    averageStartHours: 6,
    averageCompletionDays: 3.2,
    troubledRatePercent: 8,
    changePercent: 9.5,
  };

  const LABELS = {
    title: "مسار الطلبات",
    hint: "اضغط على أي مرحلة",
    stages: {
      paid: "تم الدفع",
      inFulfilment: "قيد التنفيذ",
      completed: "مكتملة",
      troubled: "متعثرة",
    },
    notes: {
      paid: "نجاح الدفع",
      inFulfilment: "متوسط بدء التنفيذ",
      completed: "متوسط الإكمال",
      troubled: "التعثر",
    },
    change: "مقارنة",
  };

  /**
   * The four figures, ALREADY WORDED.
   *
   * They used to be formatters on `LABELS` — `(value) => `${value}
   * ساعة`` — and the page passed the same shape. That made the orders
   * screen a 500 on every request, because this component runs in the
   * browser and React refuses to serialise a function across the
   * boundary. Nothing caught it: TypeScript was satisfied, the build
   * passed, and THIS TEST passed too — because a test renders the
   * component directly, with no boundary between them.
   */
  const FIGURES = {
    paid: "94.8%",
    inFulfilment: "6 ساعة",
    completed: "4 أيام",
    troubled: "8%",
  };

  const ICONS = {
    paid: <span />,
    inFulfilment: <span />,
    completed: <span />,
    troubled: <span />,
  };

  it("shows all four stages with their figures", () => {
    wrap(
      <OrderStagePath
        insight={INSIGHT}
        activeStage={null}
        labels={LABELS}
        figures={FIGURES}
        icons={ICONS}
      />,
    );

    expect(screen.getByTestId("stage-paid")).toHaveTextContent("312");
    expect(screen.getByTestId("stage-inFulfilment")).toHaveTextContent("75");
    expect(screen.getByTestId("stage-completed")).toHaveTextContent("212");
    expect(screen.getByTestId("stage-troubled")).toHaveTextContent("25");
  });

  it("adds up: the three stages equal the paid total", () => {
    // `paid` is the total, not a fourth slice — every order is paid,
    // because `master_orders` cannot exist without a payment.
    expect(INSIGHT.inFulfilment + INSIGHT.completed + INSIGHT.troubled).toBe(
      INSIGHT.paid,
    );
  });

  it("filters the table when a stage is pressed", async () => {
    const user = userEvent.setup();
    wrap(
      <OrderStagePath
        insight={INSIGHT}
        activeStage={null}
        labels={LABELS}
        figures={FIGURES}
        icons={ICONS}
      />,
    );

    await user.click(screen.getByTestId("stage-troubled"));

    expect(push.mock.calls[0][0]).toContain("stage=troubled");
  });

  it("clears the filter when the active stage is pressed again", async () => {
    const user = userEvent.setup();
    search = "stage=troubled";
    wrap(
      <OrderStagePath
        insight={INSIGHT}
        activeStage="troubled"
        labels={LABELS}
        figures={FIGURES}
        icons={ICONS}
      />,
    );

    await user.click(screen.getByTestId("stage-troubled"));

    expect(push.mock.calls[0][0]).not.toContain("stage=");
  });

  it("treats `paid` as everything, not as a filter", async () => {
    const user = userEvent.setup();
    search = "stage=completed";
    wrap(
      <OrderStagePath
        insight={INSIGHT}
        activeStage="completed"
        labels={LABELS}
        figures={FIGURES}
        icons={ICONS}
      />,
    );

    await user.click(screen.getByTestId("stage-paid"));

    expect(push.mock.calls[0][0]).not.toContain("stage=");
  });

  it("shows an em dash for an operational figure it does not have", () => {
    wrap(
      <OrderStagePath
        insight={{
          ...INSIGHT,
          averageStartHours: null,
          paymentSuccessRate: null,
        }}
        activeStage={null}
        labels={LABELS}
        figures={{ ...FIGURES, paid: "—", inFulfilment: "—" }}
        icons={ICONS}
      />,
    );

    expect(screen.getByTestId("stage-note-inFulfilment")).toHaveTextContent(
      "—",
    );
    expect(screen.getByTestId("stage-note-paid")).toHaveTextContent("—");
  });

  it("shows no unpaid column anywhere on the orders screen", () => {
    // `master_orders` cannot hold one, so displaying the state would be
    // showing a row that cannot exist.
    expect(ORDERS).not.toContain("unpaid");
    expect(ORDERS).toContain('label={t("paid")}');
  });
});

describe("the follow-up centre", () => {
  const CASES: FollowUpCase[] = [
    {
      id: "SETTLEMENT_OVERDUE:alloc-1",
      kind: "SETTLEMENT_OVERDUE",
      caseRef: "alloc-1",
      priority: "CRITICAL",
      subject: "تسوية المورد SUP-4821",
      ageHours: 6 * 24,
      assigneeId: null,
      assigneeName: null,
      inProgress: false,
      actionHref: "/admin/settlements",
    },
    {
      id: "PAYMENT_REPEATEDLY_FAILED:chk-9911",
      kind: "PAYMENT_REPEATEDLY_FAILED",
      caseRef: "chk-9911",
      priority: "REVIEW",
      subject: "جلسة الدفع chk-9911",
      ageHours: 5,
      assigneeId: "admin-1",
      assigneeName: "ops@forsa.sa",
      inProgress: true,
      actionHref: "/admin/orders?stage=troubled",
    },
  ];

  const LABELS = {
    caseStatus: "الحالة",
    priority: "الأولوية",
    item: "العنصر",
    duration: "المدة",
    assignee: "المسؤول",
    action: "الإجراء",
    selectRow: "تحديد الحالة",
    selectAll: "تحديد الكل",
    assignAction: "تعيين المسؤول",
    markInProgress: "وضع علامة قيد المعالجة",
    unassigned: "غير معيّن",
    inProgressBadge: "قيد المعالجة",
    emptyTitle: "لا توجد حالات",
    emptyDescription: "لا شيء الآن.",
    tableCaption: "حالات المتابعة",
    working: "جارٍ…",
    cancel: "إلغاء",
    confirm: "تأكيد",
    errorTitle: "خطأ",
    requestIdLabel: "المرجع:",
    priorities: { CRITICAL: "حرج", OVERDUE: "متأخر", REVIEW: "مراجعة" },
    caseNames: {
      SETTLEMENT_OVERDUE: "تسوية متأخرة",
      PAYMENT_REPEATEDLY_FAILED: "محاولات دفع فاشلة متكررة",
    },
    openActions: {
      SETTLEMENT_OVERDUE: "فتح التسوية",
      PAYMENT_REPEATEDLY_FAILED: "فتح الطلب المتعثّر",
    },
    rowsPerPage: "صفًا لكل صفحة",
    rowsPerPageUnit: "صف",
  };

  const PAGINATION = {
    navLabel: "التنقل",
    first: "الأولى",
    previous: "السابق",
    next: "التالي",
    last: "الأخيرة",
    range: "عرض 1–2 من 2",
  };

  function renderTable(cases: FollowUpCase[] = CASES) {
    return wrap(
      <FollowUpTable
        locale="ar-SA"
        cases={cases}
        // Worded on the server in the real page, for the same reason the
        // stage figures are.
        ages={Object.fromEntries(
          cases.map((row) => [row.id, `منذ ${row.ageHours} ساعة`]),
        )}
        assignees={[{ id: "admin-1", name: "ops@forsa.sa" }]}
        page={1}
        pageSize={25}
        total={cases.length}
        labels={LABELS}
        pagination={PAGINATION}
      />,
    );
  }

  it("shows the case, its priority, its age and who owns it", () => {
    renderTable();

    expect(screen.getByText("تسوية متأخرة")).toBeInTheDocument();
    expect(screen.getByText("حرج")).toBeInTheDocument();
    expect(screen.getByTestId("assignee-alloc-1")).toHaveTextContent(
      "غير معيّن",
    );
    expect(screen.getByTestId("assignee-chk-9911")).toHaveTextContent(
      "ops@forsa.sa",
    );
  });

  it("marks a case that somebody has started", () => {
    renderTable();

    expect(screen.getByTestId("in-progress-chk-9911")).toBeInTheDocument();
    expect(screen.queryByTestId("in-progress-alloc-1")).toBeNull();
  });

  it("offers the direct action for each kind", () => {
    renderTable();

    expect(screen.getByTestId("action-alloc-1")).toHaveTextContent(
      "فتح التسوية",
    );
    expect(screen.getByTestId("action-chk-9911")).toHaveTextContent(
      "فتح الطلب المتعثّر",
    );
  });

  it("OPENING A CASE IS A LINK, not a state change", () => {
    renderTable();

    const action = screen.getByTestId("action-alloc-1");
    // Following it is how the work gets done. Nothing about it writes.
    expect(action.tagName).toBe("A");
    expect(action).toHaveAttribute("href", "/ar-SA/admin/settlements");
    expect(post).not.toHaveBeenCalled();
  });

  it("hides the bulk controls until something is selected", async () => {
    const user = userEvent.setup();
    renderTable();

    expect(screen.queryByTestId("bulk-actions")).toBeNull();

    await user.click(screen.getByTestId("select-alloc-1"));

    expect(screen.getByTestId("bulk-actions")).toBeInTheDocument();
  });

  it("assigns without closing", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByTestId("select-alloc-1"));
    await user.click(screen.getByTestId("open-assign"));
    await user.selectOptions(
      await screen.findByTestId("assign-select"),
      "admin-1",
    );

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe(
      "/admin/follow-up/SETTLEMENT_OVERDUE/alloc-1/assign",
    );
    expect(post.mock.calls[0][1]).toEqual({ assigneeId: "admin-1" });
    // NOTHING here says "resolved", "closed" or "done".
    expect(JSON.stringify(post.mock.calls)).not.toMatch(
      /closed|resolved|dismiss/i,
    );
  });

  it("takes a case off somebody", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByTestId("select-chk-9911"));
    await user.click(screen.getByTestId("open-assign"));
    await user.selectOptions(
      await screen.findByTestId("assign-select"),
      "UNASSIGNED",
    );

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ assigneeId: null });
  });

  it("marks in progress without closing", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByTestId("select-alloc-1"));
    await user.click(screen.getByTestId("mark-in-progress"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toContain("/in-progress");
    expect(post.mock.calls[0][1]).toEqual({ inProgress: true });
  });

  it("says so plainly when nothing is waiting", () => {
    renderTable([]);

    expect(screen.getByTestId("follow-up-empty")).toHaveTextContent(
      "لا توجد حالات",
    );
  });

  it("carries no control that could close a case", () => {
    const table = strip(read("components/admin/follow-up-table.tsx"));

    // The requirement, made structural: there is no such request to
    // make, because the API has no route that would accept it.
    expect(table).not.toMatch(/\/close|\/resolve|\/dismiss/);
    expect(table).not.toContain("closed");
  });
});

describe("the three screens are linked by one period", () => {
  it("carries the window from the overview to the orders screen", () => {
    // The page decides the destination; the panel renders the control.
    expect(OVERVIEW).toContain('withPeriod("/orders")');
    expect(PANELS).toContain('testId="link-orders"');
  });

  it("carries it to the follow-up centre too", () => {
    expect(OVERVIEW).toContain('withPeriod("/follow-up")');
    expect(PANELS).toContain('testId="link-follow-up"');
  });

  it("reads the window back on both destinations", () => {
    for (const source of [ORDERS, FOLLOW_UP]) {
      expect(source).toContain("DASHBOARD_PERIODS");
      expect(source).toContain("firstParam(query.period)");
    }
  });

  it("links each attention row to its own filtered list", () => {
    expect(PANELS).toContain("attention-${row.kind}");
    expect(PANELS).toContain("`/${locale}${row.href}`");
  });
});

describe("both languages", () => {
  it("carries every dashboard label in English too", () => {
    for (const key of [
      "title",
      "paidOrders",
      "platformRevenue",
      "needsAttention",
      "orderStatus",
    ]) {
      expect(en.admin.overview).toHaveProperty(key);
    }
    for (const key of ["title", "pathTitle", "orderNumber"]) {
      expect(en.admin.ordersDetail).toHaveProperty(key);
    }
    for (const key of ["title", "subtitle", "assignAction"]) {
      expect(en.admin.followUp).toHaveProperty(key);
    }
  });

  it("says «مركز المتابعة», and calls it what it is", () => {
    expect(messages.admin.followUp.title).toBe("مركز المتابعة");
    expect(messages.admin.followUp.subtitle).toContain("تدخّلًا إداريًا");
  });
});
