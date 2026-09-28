import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  FAQ_ITEMS_SETTING_KEY,
  FAQ_ITEM_LIMITS,
  FAQ_MAX_ITEMS,
  PUBLIC_FAQ_ITEM_KEYS,
  isFaqItem,
  type FaqItem,
} from "@platform/types";
import { FaqList } from "@/components/shell/faq-list";
import { routing } from "@/i18n/routing";
import arMessages from "../messages/ar-SA.json";
import enMessages from "../messages/en-SA.json";

/**
 * The FAQ as ITEMS, not one block of text.
 *
 * Stored under a single settings key and validated by the same registry
 * that guards every other setting — no table, no migration, no endpoint
 * of its own.
 */

const item = (over: Partial<FaqItem> = {}): FaqItem => ({
  id: "11111111-1111-4111-8111-111111111111",
  questionAr: "كيف أشتري؟",
  questionEn: "How do I buy?",
  answerAr: "سجّل حسابًا ثم اختر عرضًا.",
  answerEn: "Register an account, then choose an offer.",
  sortOrder: 0,
  isActive: true,
  ...over,
});

describe("a FAQ item is validated, not trusted", () => {
  it("accepts a well-formed item", () => {
    expect(isFaqItem(item())).toBe(true);
  });

  it.each([
    ["a missing id", { id: "" }],
    ["a blank Arabic question", { questionAr: "   " }],
    ["a blank English answer", { answerEn: "" }],
    ["a non-integer order", { sortOrder: 1.5 }],
    ["a non-boolean active flag", { isActive: "yes" as unknown as boolean }],
  ])("rejects %s", (_why, over) => {
    expect(isFaqItem(item(over))).toBe(false);
  });

  it("rejects a question longer than the stored column allows", () => {
    expect(
      isFaqItem(item({ questionAr: "س".repeat(FAQ_ITEM_LIMITS.question + 1) })),
    ).toBe(false);
  });

  it("rejects an answer longer than the limit", () => {
    expect(
      isFaqItem(item({ answerEn: "x".repeat(FAQ_ITEM_LIMITS.answer + 1) })),
    ).toBe(false);
  });

  it.each([null, undefined, "text", 42, []])("rejects %s outright", (value) => {
    expect(isFaqItem(value)).toBe(false);
  });

  it("bounds the list, because more than this is a knowledge base", () => {
    expect(FAQ_MAX_ITEMS).toBeGreaterThan(0);
    expect(FAQ_MAX_ITEMS).toBeLessThanOrEqual(100);
  });
});

describe("the public shape carries no operator-only field", () => {
  it("exposes the question and answer, and nothing else", () => {
    expect([...PUBLIC_FAQ_ITEM_KEYS].sort()).toEqual(
      ["id", "questionAr", "questionEn", "answerAr", "answerEn"].sort(),
    );
  });

  it.each(["isActive", "sortOrder"])(
    "keeps %s off the public shape",
    (field) => {
      // A retired question must not be discoverable by reading a payload,
      // and the ordering is already expressed by the array.
      expect(PUBLIC_FAQ_ITEM_KEYS).not.toContain(field);
    },
  );
});

describe("the FAQ page renders questions as disclosures", () => {
  const ITEMS = [
    {
      id: "a",
      questionAr: "س١",
      questionEn: "Q1",
      answerAr: "ج١",
      answerEn: "A1",
    },
    {
      id: "b",
      questionAr: "س٢",
      questionEn: "Q2",
      answerAr: "ج٢",
      answerEn: "A2",
    },
  ];

  it.each([...routing.locales])("shows every question in %s", (locale) => {
    render(<FaqList items={ITEMS} locale={locale} />);

    const expected = locale === "ar-SA" ? ["س١", "س٢"] : ["Q1", "Q2"];
    for (const question of expected) {
      expect(screen.getByText(question)).toBeInTheDocument();
    }
  });

  it("uses native disclosures, so it works without JavaScript", () => {
    const { container } = render(<FaqList items={ITEMS} locale="en-SA" />);

    // A FAQ is exactly the content that must work when nothing else
    // does — <details> is keyboard operable and announced by the
    // browser itself.
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect(container.querySelectorAll("summary")).toHaveLength(2);
  });

  it("renders answers as text, never as markup", () => {
    const { container } = render(
      <FaqList
        items={[{ ...ITEMS[0], answerEn: "<script>alert(1)</script>" }]}
        locale="en-SA"
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("keeps the order it was given", () => {
    const { container } = render(<FaqList items={ITEMS} locale="en-SA" />);
    const summaries = [...container.querySelectorAll("summary")].map(
      (s) => s.textContent,
    );
    expect(summaries).toEqual(["Q1", "Q2"]);
  });
});

describe("the FAQ is stored and edited through what already exists", () => {
  it("writes to one settings key, so it needs no table and no migration", () => {
    expect(FAQ_ITEMS_SETTING_KEY).toBe("faq_items");
  });

  it("the admin manager targets that same key", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(__dirname, "..", "components/admin/faq-manager.tsx"),
      "utf8",
    );

    // A key typed into the browser is how a portal ends up writing to
    // something nothing reads.
    expect(source).toContain("FAQ_ITEMS_SETTING_KEY");
    expect(source).toContain("/admin/settings/");
  });

  it("offers add, reorder, activate and delete", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(__dirname, "..", "components/admin/faq-manager.tsx"),
      "utf8",
    );

    expect(source).toContain("labels.add");
    expect(source).toContain("labels.moveUp");
    expect(source).toContain("labels.deactivate");
    expect(source).toContain("labels.remove");
  });

  it("asks in the page before deleting, never with a native dialog", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const raw = readFileSync(
      join(__dirname, "..", "components/admin/faq-manager.tsx"),
      "utf8",
    );

    // Comments are stripped first, the way the repo-wide admin rules
    // test does it: a comment EXPLAINING why a native dialog is not
    // used is not the same as calling one.
    const source = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(source).toContain("removePrompt");
    expect(source).not.toContain("window.confirm");
  });

  it("carries its copy in both locales", () => {
    for (const faq of [arMessages.admin.faq, enMessages.admin.faq]) {
      for (const value of [
        faq.title,
        faq.addLegend,
        faq.questionAr,
        faq.answerEn,
        faq.removePrompt,
      ]) {
        expect(typeof value).toBe("string");
        expect(value.trim()).not.toBe("");
      }
    }
    // Genuinely translated, not the same string twice.
    expect(arMessages.admin.faq.title).not.toBe(enMessages.admin.faq.title);
  });
});
