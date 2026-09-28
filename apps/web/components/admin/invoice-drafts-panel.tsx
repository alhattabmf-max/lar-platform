"use client";

import { useState, type ReactNode } from "react";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  InvoiceAdjustmentForm,
  type InvoiceAdjustmentLabels,
} from "@/components/admin/invoice-adjustment-form";

/**
 * The invoice documents raised on one order, and the correction path
 * they never had.
 *
 * THE FORM IS NOT IN THE TABLE. It was, in a sixth column, and a table
 * cell is sized by the table's own layout: the whole three-field form
 * was rendered eighty-one pixels wide. A form is a form and a row is a
 * row — the row carries a button, and the form opens underneath at the
 * card's full width.
 *
 * ONE AT A TIME. Which draft is being adjusted is state, which is why
 * this is a client component; everything it renders is passed in
 * already translated and already formatted.
 */

export interface InvoiceDraftRow {
  id: string;
  /** Already translated. */
  documentType: string;
  internalDocumentReference: string;
  /**
   * Already formatted in the reader's locale, or "—".
   *
   * A NODE: the riyal's official symbol has no Unicode code point, so
   * an amount is drawn rather than typed, and a drawing does not fit
   * in a string.
   */
  amount: ReactNode;
  issuedAt: string;
  /** Already formatted. */
  issuedAtLabel: string;
}

export function InvoiceDraftsPanel({
  rows,
  labels,
  adjustmentLabels,
}: {
  rows: readonly InvoiceDraftRow[];
  labels: {
    caption: string;
    documentType: string;
    documentReference: string;
    amount: string;
    issuedAt: string;
    adjustmentColumn: string;
    adjustmentOpen: string;
  };
  adjustmentLabels: InvoiceAdjustmentLabels;
}) {
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const open = rows.find((row) => row.id === adjusting);

  return (
    <div className="flex flex-col gap-4">
      <Table caption={labels.caption} className="min-w-[44rem]">
        <THead>
          <TR>
            <TH>{labels.documentType}</TH>
            <TH>{labels.documentReference}</TH>
            <TH>{labels.amount}</TH>
            <TH>{labels.issuedAt}</TH>
            <TH>{labels.adjustmentColumn}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              <TD className="whitespace-nowrap">{row.documentType}</TD>
              <TD className="break-all font-mono text-xs">
                {row.internalDocumentReference}
              </TD>
              <TD className="whitespace-nowrap">{row.amount}</TD>
              <TD className="whitespace-nowrap">
                <time dateTime={row.issuedAt}>{row.issuedAtLabel}</time>
              </TD>
              <TD>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="whitespace-nowrap"
                  onClick={() =>
                    setAdjusting((current) => (current === row.id ? null : row.id))
                  }
                  data-testid={`adjust-${row.id}`}
                >
                  {labels.adjustmentOpen}
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {/* UNDER the table, at the card's width. The reference of the
          document being adjusted is repeated, because by the time the
          form is open the row it came from may have scrolled away. */}
      {open ? (
        <div className="rounded-md border border-line bg-background p-4">
          <p className="pb-3 font-mono text-xs text-content-muted">
            {open.internalDocumentReference}
          </p>
          <InvoiceAdjustmentForm
            documentId={open.id}
            labels={adjustmentLabels}
            onDone={() => setAdjusting(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
