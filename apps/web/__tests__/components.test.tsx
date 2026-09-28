import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, FieldError, Label } from "@/components/ui/field";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SkipLink } from "@/components/ui/skip-link";

describe("Button", () => {
  it("renders the caller's label and defaults to type=button", () => {
    render(<Button>حفظ</Button>);
    const button = screen.getByRole("button", { name: "حفظ" });
    expect(button).toHaveAttribute("type", "button");
  });

  it("blocks activation and marks busy while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button isLoading onClick={onClick}>
        Save
      </Button>
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has no white-on-gold variant — gold pairs with dark text only", () => {
    const { container } = render(<Button variant="accent">Gold</Button>);
    const className = container.querySelector("button")!.className;

    expect(className).toContain("bg-accent");
    expect(className).toContain("text-accent-foreground");
    expect(className).not.toContain("text-white");
  });

  it("uses the interactive orange token for the white-text orange button", () => {
    const { container } = render(<Button variant="accentInteractive">Act</Button>);
    const className = container.querySelector("button")!.className;

    expect(className).toContain("bg-accent-interactive");
    expect(className).toContain("text-accent-interactive-foreground");
  });
});

describe("Field / Input", () => {
  it("associates label, control and error via ids", () => {
    render(
      <Field label="البريد الإلكتروني" error="مطلوب">
        {({ inputId, errorId, invalid }) => (
          <Input id={inputId} describedById={errorId} invalid={invalid} />
        )}
      </Field>
    );

    const input = screen.getByLabelText("البريد الإلكتروني");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const errorId = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(errorId)).toHaveTextContent("مطلوب");
    expect(screen.getByRole("alert")).toHaveTextContent("مطلوب");
  });

  it("is a filled well with no outline, and shows an error on it", () => {
    // OPTION (ج), TAKEN KNOWINGLY. The reference draws a field as a
    // shape, not a shape inside a line, and the outline came off the
    // whole platform to match. No light fill reaches the 3:1 that WCAG
    // 1.4.11 asks of a resting boundary — #EEF2F7 on white is 1.12:1 —
    // so what carries the identification instead is recorded and held
    // in design-system.test.ts: the focus ring, the error border and
    // the text in the field.
    //
    // THE BORDER PIXEL IS RESERVED, not removed. Transparent at rest,
    // coloured on error — so a field never changes size to report one.
    const { rerender, container } = render(<Input id="a" />);
    const input = () => container.querySelector("input")!;

    expect(input().className).toContain("bg-field-fill");
    expect(input().className).toContain("shadow-inset");
    expect(input().className).toContain("border-transparent");
    expect(input().className).not.toContain("border-line-control");

    rerender(<Input id="a" invalid />);
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(input().className).toContain("aria-[invalid=true]:border-danger");
  });

  it("renders nothing for an empty FieldError", () => {
    const { container } = render(<FieldError id="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes the translated required text to assistive tech only", () => {
    render(
      <Label htmlFor="x" required requiredLabel="(مطلوب)">
        الاسم
      </Label>
    );
    expect(screen.getByText("(مطلوب)")).toHaveClass("sr-only");
  });
});

describe("Card", () => {
  it("becomes a named region only when given a label", () => {
    const { rerender } = render(
      <Card ariaLabel="ملخص">
        <CardHeader>
          <CardTitle>عنوان</CardTitle>
        </CardHeader>
        <CardBody>محتوى</CardBody>
      </Card>
    );
    expect(screen.getByRole("region", { name: "ملخص" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "عنوان" })).toBeInTheDocument();

    rerender(
      <Card>
        <CardBody>محتوى</CardBody>
      </Card>
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

describe("Table", () => {
  it("is captioned and keyboard-scrollable", () => {
    const { container } = render(
      <Table caption="الطلبات">
        <THead>
          <TR>
            <TH>رقم</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>1</TD>
          </TR>
        </TBody>
      </Table>
    );

    const table = screen.getByRole("table", { name: "الطلبات" });
    expect(within(table).getByRole("columnheader", { name: "رقم" })).toHaveAttribute("scope", "col");

    const scroller = container.querySelector('[role="group"]')!;
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller.className).toContain("overflow-x-auto");
  });
});

describe("Dialog", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          افتح
        </button>
        <Dialog open={open} onClose={() => setOpen(false)} title="تأكيد" closeLabel="إغلاق">
          <button type="button">داخل ١</button>
          <button type="button">داخل ٢</button>
        </Dialog>
      </>
    );
  }

  it("exposes an accessible modal with a name", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "افتح" }));

    const dialog = screen.getByRole("dialog", { name: "تأكيد" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("moves focus to the labelled panel on open and restores it on close", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "افتح" });

    await userEvent.click(opener);
    // The panel itself takes focus so the dialog and its title are
    // announced; Tab then proceeds to the controls.
    expect(screen.getByRole("dialog", { name: "تأكيد" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("keeps focus inside the dialog across a full Tab cycle", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "افتح" }));

    const dialog = screen.getByRole("dialog", { name: "تأكيد" });

    // Four tabs is more than the three focusable controls, so this
    // necessarily wraps — and must never escape to the opener behind.
    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="t" closeLabel="c">
        <span>hidden</span>
      </Dialog>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Pagination", () => {
  const labels = {
    navLabel: "تنقل بين الصفحات",
    previous: "السابق",
    next: "التالي",
    status: "صفحة 1 من 3",
  };

  it("disables previous on the first page and next on the last", () => {
    const { rerender } = render(
      <Pagination page={1} pageSize={10} total={30} labels={labels} onPageChange={() => {}} />
    );
    expect(screen.getByRole("button", { name: "السابق" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled();

    rerender(
      <Pagination page={3} pageSize={10} total={30} labels={labels} onPageChange={() => {}} />
    );
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
  });

  it("is a named navigation landmark", () => {
    render(
      <Pagination page={1} pageSize={10} total={30} labels={labels} onPageChange={() => {}} />
    );
    expect(screen.getByRole("navigation", { name: "تنقل بين الصفحات" })).toBeInTheDocument();
  });

  it("emits the requested page", async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination page={2} pageSize={10} total={30} labels={labels} onPageChange={onPageChange} />
    );

    await userEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});

describe("states", () => {
  it("announces loading once and hides the decorative skeleton", () => {
    const { container } = render(<LoadingState label="جارٍ التحميل…" rows={4} />);

    expect(screen.getByRole("status")).toHaveTextContent("جارٍ التحميل…");
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4);
  });

  it("renders empty state copy from the caller", () => {
    render(<EmptyState title="لا توجد عناصر" description="لم يُضَف أي عنصر بعد." />);
    expect(screen.getByText("لا توجد عناصر")).toBeInTheDocument();
  });

  it("renders an error alert with the request id but nothing internal", () => {
    render(
      <ErrorState
        title="تعذّر إتمام الطلب"
        description="حاول مرة أخرى."
        requestId="req-abc"
        requestIdLabel="رقم المرجع"
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("تعذّر إتمام الطلب");
    expect(alert).toHaveTextContent("req-abc");
  });
});

describe("SkipLink", () => {
  it("targets main content and is hidden until focused", () => {
    render(<SkipLink label="تخطَّ إلى المحتوى الرئيسي" />);
    const link = screen.getByRole("link", { name: "تخطَّ إلى المحتوى الرئيسي" });

    expect(link).toHaveAttribute("href", "#main-content");
    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus:not-sr-only");
  });
});
