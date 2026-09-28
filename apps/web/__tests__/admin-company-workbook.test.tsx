import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { CompanyImportPreview } from "@platform/types";
import messages from "@/messages/ar-SA.json";
import {
  CompanyWorkbookActions,
  type CompanyWorkbookLabels,
} from "@/components/admin/company-workbook-actions";

/**
 * The import wizard, tested on the promise it makes.
 *
 * The promise is that choosing a file changes NOTHING — and that the
 * second press is the one that writes. A component that quietly
 * committed on upload would look identical in a screenshot, so the
 * assertion here is on the calls, not the markup.
 *
 * The other promise is that a partial import is STATED. An operator
 * whose file had three bad rows out of ten must read that seven will be
 * imported and three left, before the button, in their own language.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const uploadFile = vi.fn();
const post = vi.fn();
const downloadFile = vi.fn();

vi.mock("@/lib/api-client", () => ({
  uploadFile: (...args: unknown[]) => uploadFile(...args),
  downloadFile: (...args: unknown[]) => downloadFile(...args),
  apiClient: { post: (...args: unknown[]) => post(...args) },
}));

const workbook = messages.admin.companyWorkbook;

const LABELS: CompanyWorkbookLabels = {
  exportAction: workbook.exportAction,
  exportEmpty: workbook.exportEmpty,
  templateAction: workbook.templateAction,
  importAction: workbook.importAction,
  previewTitle: workbook.previewTitle,
  previewFile: workbook.previewFile,
  previewTotal: workbook.previewTotal,
  previewValid: workbook.previewValid,
  previewRejected: workbook.previewRejected,
  previewDuplicates: workbook.previewDuplicates,
  previewNothing: workbook.previewNothing,
  previewPartial: workbook.previewPartial,
  previewAll: workbook.previewAll,
  rowsTitle: workbook.rowsTitle,
  rowNumber: workbook.rowNumber,
  rowReason: workbook.rowReason,
  downloadErrors: workbook.downloadErrors,
  commitAction: workbook.commitAction,
  cancel: messages.admin.actions.cancel,
  working: messages.admin.actions.working,
  doneTitle: workbook.doneTitle,
  doneCreated: workbook.doneCreated,
  doneSkipped: workbook.doneSkipped,
  doneInvited: workbook.doneInvited,
  close: workbook.close,
  errorTitle: messages.states.errorTitle,
  requestIdLabel: messages.states.requestIdLabel,
  unknownReason: workbook.unknownReason,
  reasons: workbook.reasons,
};

function preview(
  overrides: Partial<CompanyImportPreview> = {},
): CompanyImportPreview {
  return {
    importId: "11111111-1111-1111-1111-111111111111",
    fileName: "companies.xlsx",
    total: 3,
    valid: 3,
    rejected: 0,
    duplicates: 0,
    errors: [],
    ...overrides,
  };
}

function renderActions(
  query = "?accountType=TRADER",
  accountType: "TRADER" | "SUPPLIER" = "TRADER",
) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <CompanyWorkbookActions
        accountType={accountType}
        query={query}
        exportColumns={["الاسم النظامي", "السجل التجاري"]}
        exportFileLabel={accountType === "SUPPLIER" ? "الموردون" : "المشترون"}
        statusLabels={{ VERIFIED: "موثّق" }}
        labels={LABELS}
      />
    </NextIntlClientProvider>,
  );
}

/** Puts a file into the hidden input the visible button clicks. */
async function chooseFile(user: ReturnType<typeof userEvent.setup>) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await user.upload(
    input,
    new File(["x"], "companies.xlsx", { type: "application/vnd.ms-excel" }),
  );
}

describe("CompanyWorkbookActions", () => {
  beforeEach(() => {
    uploadFile.mockReset().mockResolvedValue(preview());
    post
      .mockReset()
      .mockResolvedValue({ created: 3, skipped: 0, invited: 3, errors: [] });
    downloadFile.mockReset().mockResolvedValue(undefined);
    refresh.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the three actions", () => {
    renderActions();

    expect(
      screen.getByRole("button", { name: workbook.exportAction }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: workbook.templateAction }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: workbook.importAction }),
    ).toBeInTheDocument();
  });

  it("exports with the list's filters, not just the page", async () => {
    const user = userEvent.setup();
    renderActions(
      "?accountType=SUPPLIER&verificationStatus=PENDING_VERIFICATION",
      "SUPPLIER",
    );

    await user.click(
      screen.getByRole("button", { name: workbook.exportAction }),
    );

    const [path] = downloadFile.mock.calls[0];
    // THE FILTERS THE TABLE IS SHOWING, not the page in front of the
    // reader — and the tab, which is what keeps the two files apart.
    expect(path).toContain("accountType=SUPPLIER");
    expect(path).toContain("verificationStatus=PENDING_VERIFICATION");
  });

  it("exports the OPEN TAB and never the other one", async () => {
    const user = userEvent.setup();
    renderActions("?accountType=TRADER", "TRADER");

    await user.click(
      screen.getByRole("button", { name: workbook.exportAction }),
    );

    const [path] = downloadFile.mock.calls[0];
    expect(path).toContain("accountType=TRADER");
    expect(path).not.toContain("accountType=SUPPLIER");
  });

  it("sends the open tab's own column headings with the request", async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(
      screen.getByRole("button", { name: workbook.exportAction }),
    );

    const [path] = downloadFile.mock.calls[0];
    // A file whose columns differ from the table it came from is a file
    // nobody can check against what they were looking at.
    // `URLSearchParams` writes a space as `+`, which
    // `decodeURIComponent` leaves alone — so the query is read back
    // the way a server would read it rather than by hand.
    const sent = new URLSearchParams(path.slice(path.indexOf("?")));
    expect(sent.get("c1")).toBe("الاسم النظامي");
    expect(sent.get("c2")).toBe("السجل التجاري");
    expect(sent.get("fileLabel")).toBe("المشترون");
  });

  it("downloads the template for the OPEN TAB", async () => {
    const user = userEvent.setup();
    renderActions("?accountType=SUPPLIER", "SUPPLIER");

    await user.click(
      screen.getByRole("button", { name: workbook.templateAction }),
    );

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const [path] = downloadFile.mock.calls[0];
    expect(path).toContain("accountType=SUPPLIER");
  });

  it("uploads into the OPEN TAB, so the two registers cannot mix", async () => {
    const user = userEvent.setup();
    renderActions("?accountType=SUPPLIER", "SUPPLIER");

    await chooseFile(user);

    await waitFor(() => expect(uploadFile).toHaveBeenCalled());
    expect(uploadFile.mock.calls[0][0]).toContain("accountType=SUPPLIER");
  });

  it("uploading a file COMMITS NOTHING", async () => {
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);

    await waitFor(() => expect(uploadFile).toHaveBeenCalledOnce());
    // The whole point of two steps.
    expect(post).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the counts and the file name after reading it", async () => {
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);

    expect(await screen.findByText(workbook.previewTitle)).toBeInTheDocument();
    expect(screen.getByText("companies.xlsx")).toBeInTheDocument();
    expect(screen.getByText(workbook.previewAll)).toBeInTheDocument();
  });

  it("states that a partial import leaves the rest, before the button", async () => {
    uploadFile.mockResolvedValue(
      preview({
        total: 10,
        valid: 7,
        rejected: 3,
        duplicates: 1,
        errors: [
          { rowNumber: 4, reason: "DUPLICATE_CR_IN_FILE", values: [] },
          { rowNumber: 5, reason: "INVALID_EMAIL", values: [] },
          { rowNumber: 9, reason: "CR_ALREADY_REGISTERED", values: [] },
        ],
      }),
    );
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);

    expect(
      await screen.findByText(workbook.previewPartial),
    ).toBeInTheDocument();
    // The count is ON the button, so the number imported is read at the
    // moment of pressing rather than remembered from a panel above.
    expect(
      screen.getByRole("button", { name: `${workbook.commitAction} (7)` }),
    ).toBeEnabled();
  });

  it("lists every rejected row with its number and a translated reason", async () => {
    uploadFile.mockResolvedValue(
      preview({
        total: 2,
        valid: 1,
        rejected: 1,
        errors: [{ rowNumber: 3, reason: "INVALID_CR_FORMAT", values: [] }],
      }),
    );
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(
      screen.getByText(workbook.reasons.INVALID_CR_FORMAT),
    ).toBeInTheDocument();
    // Not the machine code, which means nothing to an operator.
    expect(screen.queryByText("INVALID_CR_FORMAT")).not.toBeInTheDocument();
  });

  it("falls back to a readable line for a reason this build does not know", async () => {
    uploadFile.mockResolvedValue(
      preview({
        total: 1,
        valid: 0,
        rejected: 1,
        errors: [{ rowNumber: 2, reason: "SOMETHING_NEW", values: [] }],
      }),
    );
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);

    expect(await screen.findByText(workbook.unknownReason)).toBeInTheDocument();
  });

  it("cannot be committed when nothing is valid", async () => {
    uploadFile.mockResolvedValue(
      preview({
        total: 2,
        valid: 0,
        rejected: 2,
        errors: [{ rowNumber: 2, reason: "INVALID_EMAIL", values: [] }],
      }),
    );
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);

    expect(
      await screen.findByText(workbook.previewNothing),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${workbook.commitAction} (0)` }),
    ).toBeDisabled();
  });

  it("commits only when the second button is pressed, and refreshes after", async () => {
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);
    await user.click(
      await screen.findByRole("button", {
        name: `${workbook.commitAction} (3)`,
      }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/admin/companies/import/11111111-1111-1111-1111-111111111111/commit",
      ),
    );
    expect(refresh).toHaveBeenCalled();
    expect(await screen.findByText(workbook.doneTitle)).toBeInTheDocument();
  });

  it("cancelling leaves the staged file uncommitted", async () => {
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);
    await user.click(
      await screen.findByRole("button", {
        name: messages.admin.actions.cancel,
      }),
    );

    expect(screen.queryByText(workbook.previewTitle)).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("reports a rejected upload with its reference rather than a blank panel", async () => {
    uploadFile.mockRejectedValue(
      Object.assign(new Error("nope"), {
        name: "ApiError",
        kind: "validation",
        code: "VALIDATION_FAILED",
        requestId: "abc-123",
      }),
    );
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.states.errorTitle,
    );
    expect(screen.queryByText(workbook.previewTitle)).not.toBeInTheDocument();
  });

  it("offers the rejected rows as a file to correct", async () => {
    uploadFile.mockResolvedValue(
      preview({
        total: 2,
        valid: 1,
        rejected: 1,
        errors: [{ rowNumber: 3, reason: "INVALID_EMAIL", values: [] }],
      }),
    );
    const user = userEvent.setup();
    renderActions();

    await chooseFile(user);

    expect(
      await screen.findByRole("button", { name: workbook.downloadErrors }),
    ).toBeInTheDocument();
  });
});
