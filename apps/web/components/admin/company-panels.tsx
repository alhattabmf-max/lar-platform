"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MapPin, Pencil, Plus, Trash2, PauseCircle, Play } from "lucide-react";
import type {
  AdminCompanyDetail,
  AdminCompanyLocation,
  CompanyDeletionEligibility,
} from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { looksLikeAPlace } from "@/lib/map-link";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CopyValue } from "@/components/admin/copy-value";

/**
 * Everything on a company's page that does something.
 *
 * ONE PAGE, NO TABS. The screen this replaces split a company across
 * two halves, and an operator checking a branch's telephone had to know
 * which half it lived in. Each section here is a compact card in the
 * order the work happens: what the company is, where it is, what it has
 * done, what has been done to it, and — last — the two things that stop
 * it.
 *
 * NO FORM IS OPEN UNTIL IT IS ASKED FOR. A page of open inputs is a
 * page where a stray keystroke edits something; every form here starts
 * closed and opens in place.
 *
 * TWO OPERATIONS ASK FOR A CODE, and only two: rewriting the commercial
 * registration, and removal. A code on every correction teaches people
 * to keep an authenticator open all day, which is the habit that makes
 * it worthless where it counts.
 */

export interface CompanyPanelLabels {
  /** — the company card */
  detailsTitle: string;
  legalName: string;
  crNumber: string;
  email: string;
  phones: string;
  registeredAt: string;
  operationalStatus: string;
  /** Already resolved by the server — one value, not a branch here. */
  operationalValue: string;
  edit: string;
  copyEmail: string;
  copiedEmail: string;
  copyCrNumber: string;
  copiedCrNumber: string;
  noPhones: string;
  mobile1: string;
  mobile2: string;

  /** — branches */
  branchesTitle: string;
  branchName: string;
  /** Where a branch is. Required. */
  branchRegion: string;
  regionPlaceholder: string;
  regionNoMatch: string;
  branchCity: string;
  /** The same field, labelled as the optional refinement it is. */
  branchCityOptional: string;
  cityPlaceholder: string;
  cityNoMatch: string;
  branchAddress: string;
  branchPhone: string;
  branchLocation: string;
  branchContact: string;
  openLocation: string;
  addBranch: string;
  editBranch: string;
  mapUrl: string;
  mapUrlHint: string;
  mapUrlRejected: string;
  crNumberHint: string;
  noBranches: string;


  /** — audit */
  auditTitle: string;
  auditAt: string;
  auditAction: string;
  auditActor: string;
  auditDetails: string;
  noAudit: string;

  /** — suspension */
  suspendTitle: string;
  suspendReason: string;
  suspend: string;
  reactivateTitle: string;
  reactivate: string;

  /** — what the accounts table used to say about the one login */
  loginPasswordSet: string;
  loginPasswordPending: string;
  loginEmailVerified: string;
  loginEmailUnverified: string;

  /** — the payout account, read only */
  bankTitle: string;
  bankState: string;
  bankActive: string;
  bankPending: string;
  bankHolder: string;
  bankName: string;
  bankIban: string;
  noBankAccount: string;

  /** — removal */
  deleteTitle: string;
  /** The word beside the field a stop-button opens. */
  confirmAction: string;
  deleteReason: string;
  deleteAction: string;
  deleteBlocked: string;
  deleteConfirmLabel: string;

  /** — shared */
  save: string;
  cancel: string;
  working: string;
  errorTitle: string;
  requestIdLabel: string;
  reasonRequired: string;
}

type Busy = null | "edit" | "branch" | "suspend" | "reactivate" | "delete";

export function CompanyPanels({
  company,
  registeredAtLabel,
  auditExport,
  eligibility,
  blockerNames,
  regions,
  cities,
  accountActions,
  audit,
  labels,
}: {
  company: AdminCompanyDetail;
  /** Already formatted in the reader's locale. */
  registeredAtLabel: string;
  /** The export button, built by the page that knows the headings. */
  auditExport: React.ReactNode;
  eligibility: CompanyDeletionEligibility | null;
  blockerNames: Record<string, string>;
  /** WHERE A BRANCH IS. Required by every branch row. */
  regions: readonly {
    id: string;
    name: string;
    /** The other language's name, so either one finds the row. */
    alternateName: string;
  }[];
  /** The optional refinement, each carrying the region it is under. */
  cities: readonly {
    id: string;
    name: string;
    regionId: string;
    /** The region it belongs to — shown under the name and searched. */
    group: string;
    /** The other language's name, so either one finds the row. */
    alternateName: string;
  }[];
  /**
   * THE TWO THINGS AN ADMINISTRATOR MAY DO TO THE LOGIN, built by the
   * page and carried in the band.
   *
   * «حتى حساب الدخول لا أحتاجه وبياناته، لأنه مكرّر: الإيميل، والدخول
   *  أصلًا عن طريق رقم السجل… أمّا استرجاع كلمة المرور وإنهاء الجلسة
   *  نقدر نحتفظ بها وتكون في الشريط الداكن.»
   *
   * THE TABLE THEY STOOD ON IS GONE, and the arithmetic is his:
   * `USER_COMPANY_ROLES` holds exactly one role, so that table was
   * always one row; login is by COMMERCIAL REGISTRATION, not by the
   * address; and the address itself is already a field of the record
   * above. What is left is two actions and three small facts — the
   * actions ride in the band, and the facts stand beside the address
   * they are about.
   *
   * A node rather than data, because both are `AdminAction`: the page
   * renders them server-side and neither needs a gram of the state this
   * client component holds.
   */
  accountActions: ReactNode;
  /** Already formatted dates and translated action names. */
  audit: readonly {
    id: string;
    at: string;
    action: string;
    actor: string;
    details: string;
  }[];
  labels: CompanyPanelLabels;
}) {
  const router = useRouter();
  const root = useTranslations();

  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const base = `/admin/companies/${encodeURIComponent(company.id)}`;
  const suspended = company.verificationStatus === "SUSPENDED";

  const owner =
    company.users.find((user) => user.role === "OWNER") ?? company.users[0];

  /**
   * ONE EDIT FOR THE WHOLE RECORD — «خلّ تعديل البيانات يعدّل البيانات
   * اللي موجودة، صلاحية كاملة على البيانات، وخلّها في جدول واحد وليس
   * لكل جزء تعديل… خلّها نفس نظام بطاقة بيانات المنشأة في صفحة المورّد
   * والمشتري: جدول واحد قابل للتعديل.»
   *
   * WHAT THIS REPLACES: two separate forms that opened BELOW the thing
   * they edited — one for the company, one for a single branch at a
   * time — so correcting a name and a branch telephone was two openings,
   * two saves and two audit entries, and neither form was where the
   * values were.
   *
   * NOW THE TABLE IS THE FORM. Pressing «تعديل البيانات» turns every
   * cell that holds a value into the field that writes it, in place; the
   * band's button becomes «حفظ»; and one press writes the company patch
   * and every branch that moved.
   *
   * THE DRAFT IS SEEDED FROM THE RECORD each time editing opens, so a
   * cancelled edit leaves nothing behind and a refresh brings the server
   * back rather than what was typed over it.
   */
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => companyForm(company, owner));
  const [branchRows, setBranchRows] = useState<BranchRow[]>(() =>
    company.locations.map(toBranchRow),
  );

  function openEditor(withBlankBranch = false) {
    setForm(companyForm(company, owner));
    setBranchRows([
      ...company.locations.map(toBranchRow),
      ...(withBlankBranch ? [blankBranchRow()] : []),
    ]);
    setEditing(true);
  }

  function closeEditor() {
    setEditing(false);
    setFailure(null);
  }

  const setRow = (index: number, patch: Partial<BranchRow>) =>
    setBranchRows((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  /** The active cities under one region. */
  const citiesInRegion = (id: string) =>
    cities.filter((city) => city.regionId === id);

  // ONLY WHAT MOVED IS SENT. A patch echoing unchanged values would
  // write audit entries for edits nobody made.
  const companyPatch = companyPatchFrom(form, company, owner);

  const rowsReady = branchRows.every((row) => branchRowIsComplete(row));
  const somethingToSave =
    Object.keys(companyPatch).length > 0 ||
    branchRows.some((row, index) => branchRowChanged(row, company.locations[index]));

  async function run(kind: Exclude<Busy, null>, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(kind);
    setFailure(null);
    try {
      await action();
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(null);
    }
  }

  /**
   * ONE PRESS, IN ORDER: the company first, then each branch that moved.
   *
   * SEQUENTIAL, NOT PARALLEL. Every one of these writes an audit entry
   * and the server serialises them anyway; firing them together would
   * only make the order in the log depend on the network.
   *
   * A FAILURE STOPS THE REST. What already committed stays — there is no
   * transaction across HTTP calls — and the refusal is shown with the
   * record re-read, so the reader sees exactly which part landed.
   */
  function saveAll() {
    return run("edit", async () => {
      if (Object.keys(companyPatch).length > 0) {
        await apiClient.patch(base, companyPatch);
      }
      for (const [index, row] of branchRows.entries()) {
        const stored = company.locations[index];
        if (!branchRowChanged(row, stored)) continue;
        const body = branchBody(row);
        if (row.id === null) await apiClient.post(`${base}/branches`, body);
        else await apiClient.patch(`${base}/branches/${row.id}`, body);
      }
      setEditing(false);
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {failure ? (
        <div
          role="alert"
          className="rounded-md border border-danger bg-surface p-3 text-sm text-danger"
          data-testid="company-panel-error"
        >
          <span className="font-medium">{labels.errorTitle}:</span>{" "}
          {root(failure.messageKey)}
          {failure.requestId ? (
            <span className="ms-2 select-all font-mono text-xs">
              {labels.requestIdLabel} {failure.requestId}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* ---------- ONE CARD: THE RECORD, AND WHAT STOPS IT ----------

          «بالنسبة لبطاقة حسابات الدخول وبيانات المنشأة والفروع وإيقاف
           مؤقت وشطب نهائي، حط المعلومات فيها كلها في بطاقة وحدة مضغوطة.»

          FIVE BORDERED BOXES BECAME ONE. Each carried its own frame, its
          own shadow and its own padding, and stacked they spent more of
          the page on the space between them than on anything they said.
          What separates the blocks now is a hairline.

          THE ORDER IS THE WORK'S: what the company is, where it trades
          from, who can sign in — and last, at the foot, the two things
          that stop it. */}
      <form
        data-testid="card-company-record"
        className="flex min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (editing && rowsReady && somethingToSave && busy === null) {
            void saveAll();
          }
        }}
      >
        {/* EVERY BUTTON THE RECORD HAS, IN THE DARK BAND — «ارفع الأزرار
            كلها في الشريط الكحلي الداكن، ما عدا زر إيقاف مؤقت وشطب».

            They were scattered one per block: edit above the fields, add
            above the branches, export above the accounts. Three actions
            on one record, on three different lines, each pushing its
            block down by a row. The band had the width for all of them
            and was carrying a title alone. */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-primary px-card-x py-2">
          <h2 className="min-w-0 truncate text-sm font-semibold text-primary-foreground">
            {labels.detailsTitle}
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null || !rowsReady || !somethingToSave}
                  data-testid="save-company"
                >
                  {busy === "edit" ? labels.working : labels.save}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={closeEditor}
                  data-testid="cancel-edit-company"
                >
                  {labels.cancel}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                data-testid="open-edit-company"
                onClick={() => openEditor()}
              >
                <Pencil className="size-4" aria-hidden />
                {labels.edit}
              </Button>
            )}

            {/* ADDING A BRANCH IS AN EDIT. It opens the editor if it is
                closed and appends an empty row to the same table, so
                there is one save for everything on the card. */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              data-testid="open-add-branch"
              onClick={() =>
                editing
                  ? setBranchRows((rows) => [...rows, blankBranchRow()])
                  : openEditor(true)
              }
            >
              <Plus className="size-4" aria-hidden />
              {labels.addBranch}
            </Button>

            {accountActions}
          </div>
        </div>

        <Block testId="card-company-details">
          {/* THE FIELDS ARE THE FIRST ROWS OF THE TABLE, and in edit mode
              each value cell holds the field that writes it. A form that
              opened underneath was a second copy of the record to read
              against the first. */}
          <dl className="grid min-w-0 overflow-hidden rounded-card border-s border-t border-line sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label={labels.legalName}
              value={
                editing ? (
                  <Input
                    aria-label={labels.legalName}
                    value={form.legalName}
                    onChange={(event) =>
                      setForm((p) => ({ ...p, legalName: event.target.value }))
                    }
                    data-testid="edit-legal-name"
                  />
                ) : (
                  company.legalName
                )
              }
            />
            {/* THE REGISTRATION, IN THE ORDINARY EDIT AND WITHOUT A CODE.
                The server still refuses a duplicate, and still refuses to
                rewrite the number a VERIFIED company was verified
                against. */}
            <Field
              label={labels.crNumber}
              value={
                editing ? (
                  <Input
                    dir="ltr"
                    aria-label={labels.crNumber}
                    value={form.crNumber}
                    onChange={(event) =>
                      setForm((p) => ({ ...p, crNumber: event.target.value }))
                    }
                    data-testid="edit-cr-number"
                  />
                ) : (
                  <CopyValue
                    value={company.crNumber}
                    copyLabel={labels.copyCrNumber}
                    copiedLabel={labels.copiedCrNumber}
                    testId="company-cr-number"
                  />
                )
              }
            />
            <Field
              label={labels.email}
              value={
                editing ? (
                  <Input
                    type="email"
                    dir="ltr"
                    aria-label={labels.email}
                    value={form.email}
                    onChange={(event) =>
                      setForm((p) => ({ ...p, email: event.target.value }))
                    }
                    data-testid="edit-email"
                  />
                ) : company.ownerEmail ? (
                  // THE THREE FACTS THE ACCOUNTS TABLE CARRIED, beside
                  // the address they are about rather than in a table
                  // of their own — «حتى حساب الدخول لا أحتاجه وبياناته
                  // لأنه مكرّر». Whether a password exists, and whether
                  // this address has been confirmed, are things about
                  // THIS address; a row repeating it to say them was
                  // the duplication.
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <CopyValue
                      value={company.ownerEmail}
                      copyLabel={labels.copyEmail}
                      copiedLabel={labels.copiedEmail}
                      testId="company-owner-email"
                    />
                    {owner ? (
                      <span
                        className="flex flex-wrap gap-x-2 text-xs text-content-muted"
                        data-testid="company-login-marks"
                      >
                        <span>
                          {owner.hasPassword
                            ? labels.loginPasswordSet
                            : labels.loginPasswordPending}
                        </span>
                        <span>
                          {owner.emailVerificationStatus === "VERIFIED"
                            ? labels.loginEmailVerified
                            : labels.loginEmailUnverified}
                        </span>
                      </span>
                    ) : null}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            {/* EVERY NUMBER IN ONE FIELD when reading; the OWNER'S two
                when writing, because those are the only ones this record
                owns — the rest belong to the branches below and to the
                company's own contacts. */}
            <Field
              label={labels.phones}
              value={
                editing ? (
                  <div className="flex flex-col gap-1">
                    <Input
                      dir="ltr"
                      aria-label={labels.mobile1}
                      value={form.mobile1}
                      onChange={(event) =>
                        setForm((p) => ({ ...p, mobile1: event.target.value }))
                      }
                      data-testid="edit-mobile-1"
                    />
                    <Input
                      dir="ltr"
                      aria-label={labels.mobile2}
                      value={form.mobile2}
                      onChange={(event) =>
                        setForm((p) => ({ ...p, mobile2: event.target.value }))
                      }
                      data-testid="edit-mobile-2"
                    />
                  </div>
                ) : company.phones.length === 0 ? (
                  <span className="text-content-muted">{labels.noPhones}</span>
                ) : (
                  <ul
                    className="flex list-none flex-col gap-0.5"
                    data-testid="company-phones"
                  >
                    {company.phones.map((phone) => (
                      <li
                        key={`${phone.source}-${phone.value}`}
                        className="flex flex-wrap gap-2"
                      >
                        <bdi>{phone.value}</bdi>
                        {phone.label ? (
                          <span className="text-xs text-content-muted">
                            {phone.label}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )
              }
            />
            <Field label={labels.registeredAt} value={registeredAtLabel} />
            <Field
              label={labels.operationalStatus}
              value={labels.operationalValue}
              testId="company-operational"
            />
          </dl>
          {editing ? (
            <p className="text-xs text-content-muted">{labels.crNumberHint}</p>
          ) : null}
        </Block>

        <Block ruled title={labels.branchesTitle} testId="card-branches">
          {branchRows.length === 0 ? (
            <p className="text-sm text-content-muted" data-testid="no-branches">
              {labels.noBranches}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table flush caption={labels.branchesTitle}>
                <THead appearance="plain">
                  <TR>
                    <TH>{labels.branchName}</TH>
                    <TH>{labels.branchRegion}</TH>
                    <TH>{labels.branchAddress}</TH>
                    <TH>{labels.branchPhone}</TH>
                    <TH>{labels.branchLocation}</TH>
                    <TH>{labels.branchContact}</TH>
                  </TR>
                </THead>
                <TBody>
                  {branchRows.map((row, index) => {
                    const stored = company.locations[index];
                    return (
                      <TR key={row.id ?? `new-${index}`}>
                        <TD>
                          {editing ? (
                            <Input
                              aria-label={labels.branchName}
                              value={row.name}
                              onChange={(event) =>
                                setRow(index, { name: event.target.value })
                              }
                              data-testid="branch-name"
                            />
                          ) : (
                            stored?.name
                          )}
                        </TD>
                        {/*
                          THE REGION, NARROWED BY THE CITY WHEN THERE IS
                          ONE. A branch may name no city, and an em dash
                          in a place column reads as missing data rather
                          than as "this branch is recorded by region".
                        */}
                        <TD className="min-w-[14rem]">
                          {editing ? (
                            <div className="flex flex-col gap-1">
                              <SearchableSelect
                                value={row.regionId}
                                options={regions}
                                placeholder={labels.regionPlaceholder}
                                searchLabel={labels.branchRegion}
                                emptyLabel={labels.regionNoMatch}
                                // CHANGING THE REGION CLEARS A CITY THAT
                                // IS NOT UNDER IT. Keeping it would leave
                                // the row holding a pair the server
                                // refuses, and the operator would read
                                // the refusal as being about the region
                                // they just picked.
                                onChange={(next) =>
                                  setRow(index, {
                                    regionId: next,
                                    cityId: citiesInRegion(next).some(
                                      (city) => city.id === row.cityId,
                                    )
                                      ? row.cityId
                                      : "",
                                  })
                                }
                                testId="branch-region"
                              />
                              {/* OPTIONAL, AND ONLY WHERE THERE ARE ANY.
                                  An empty picker labelled "optional" is a
                                  question with no answers. */}
                              {row.regionId !== "" &&
                              citiesInRegion(row.regionId).length > 0 ? (
                                <SearchableSelect
                                  value={row.cityId}
                                  options={citiesInRegion(row.regionId)}
                                  placeholder={labels.cityPlaceholder}
                                  searchLabel={labels.branchCityOptional}
                                  emptyLabel={labels.cityNoMatch}
                                  onChange={(next) =>
                                    setRow(index, { cityId: next })
                                  }
                                  testId="branch-city"
                                />
                              ) : null}
                            </div>
                          ) : (
                            [stored?.regionName, stored?.cityName]
                              .filter(Boolean)
                              .join(" — ")
                          )}
                        </TD>
                        <TD className="max-w-[14rem] break-words">
                          {editing ? (
                            <Input
                              aria-label={labels.branchAddress}
                              value={row.shortAddress}
                              onChange={(event) =>
                                setRow(index, {
                                  shortAddress: event.target.value,
                                })
                              }
                              data-testid="branch-address"
                            />
                          ) : (
                            stored?.shortAddress
                          )}
                        </TD>
                        <TD>
                          {editing ? (
                            <Input
                              dir="ltr"
                              aria-label={labels.branchPhone}
                              value={row.contactPhone}
                              onChange={(event) =>
                                setRow(index, {
                                  contactPhone: event.target.value,
                                })
                              }
                              data-testid="branch-phone"
                            />
                          ) : (
                            <bdi>{stored?.contactPhone}</bdi>
                          )}
                        </TD>
                        <TD className="min-w-[12rem]">
                          {editing ? (
                            <div className="flex flex-col gap-1">
                              <Input
                                dir="ltr"
                                aria-label={labels.mapUrl}
                                placeholder={
                                  stored ? labels.mapUrlHint : undefined
                                }
                                value={row.mapUrl}
                                onChange={(event) =>
                                  setRow(index, { mapUrl: event.target.value })
                                }
                                data-testid="branch-map-url"
                              />
                              {/* THE SAME SHAPES THE SERVER READS,
                                  checked where the value is typed. An
                                  existing branch may keep the position it
                                  has; a new one cannot be stored without
                                  one. */}
                              {row.mapUrl.trim() !== "" &&
                              !looksLikeAPlace(row.mapUrl) ? (
                                <span
                                  className="text-xs text-danger"
                                  data-testid="branch-map-rejected"
                                >
                                  {labels.mapUrlRejected}
                                </span>
                              ) : null}
                            </div>
                          ) : stored?.mapUrl ? (
                            /* A BUTTON, NOT THE URL. A maps link is
                               sixty characters of noise in a cell that
                               has six. */
                            <a
                              href={stored.mapUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid={`branch-map-${stored.id}`}
                              className="inline-flex items-center gap-1 rounded-sm text-sm text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                            >
                              <MapPin className="size-3.5" aria-hidden />
                              {labels.openLocation}
                            </a>
                          ) : (
                            "—"
                          )}
                        </TD>
                        <TD>
                          {editing ? (
                            <Input
                              aria-label={labels.branchContact}
                              value={row.contactName}
                              onChange={(event) =>
                                setRow(index, {
                                  contactName: event.target.value,
                                })
                              }
                              data-testid="branch-contact"
                            />
                          ) : (
                            stored?.contactName
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          )}
        </Block>

        {/* WHERE THE MONEY GOES — «الحسابات البنكية… المفروض إنها في
            بيانات المورّد».

            THE DECISION AND ITS EVIDENCE ON ONE PAGE. The console
            could approve a supplier's verification — which is what
            makes an account the payout account — without ever
            seeing the account. The approve button is at the top of
            this page; this is what it approves.

            READ ONLY, and that is not an omission. An administrator
            who could rewrite an IBAN could redirect a supplier's
            money; it is the one write this console does not have,
            and the four digits are what the evidence is checked
            against.

            A BUYER HAS NONE, and is never asked for one. */}
        {company.accountType === "SUPPLIER" ? (
          <Block ruled title={labels.bankTitle} testId="card-company-bank">
            {company.bankAccounts.active === null &&
            company.bankAccounts.pending === null ? (
              <p
                className="text-sm text-content-muted"
                data-testid="no-bank-account"
              >
                {labels.noBankAccount}
              </p>
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                {(
                  [
                    [labels.bankActive, company.bankAccounts.active],
                    [labels.bankPending, company.bankAccounts.pending],
                  ] as const
                ).map(([which, account]) =>
                  account ? (
                    <dl
                      key={account.id}
                      className="grid min-w-0 overflow-hidden rounded-card border-s border-t border-line sm:grid-cols-2 lg:grid-cols-4"
                      data-testid={
                        account === company.bankAccounts.active
                          ? "bank-active"
                          : "bank-pending"
                      }
                    >
                      <Field label={labels.bankState} value={which} />
                      <Field
                        label={labels.bankHolder}
                        value={account.accountHolderName}
                      />
                      <Field label={labels.bankName} value={account.bankName} />
                      {/* THE LAST FOUR, AND NEVER THE NUMBER. The IBAN is
                          stored encrypted and no route in the platform
                          decrypts it. */}
                      <Field
                        label={labels.bankIban}
                        value={<bdi>{`•••• ${account.ibanLast4}`}</bdi>}
                      />
                    </dl>
                  ) : null,
                )}
              </div>
            )}
          </Block>
        ) : null}

        {/* THE TWO THINGS THAT STOP A COMPANY, at the foot, as two
            buttons and nothing else — «خلّها زرّين فقط بدون حقل سبب، إذا
            ضغطت الزر يفتح لي حقل السبب وجنبه كلمة تأكيد». They are the
            two the band does NOT carry: «ما عدا زر إيقاف مؤقت وشطب». */}
        <StopActions
          company={company}
          suspended={suspended}
          eligibility={eligibility}
          blockerNames={blockerNames}
          labels={labels}
          busy={busy}
          onSuspend={(reason) =>
            run("suspend", () => apiClient.post(`${base}/suspend`, { reason }))
          }
          onReactivate={(reason) =>
            run("reactivate", () =>
              apiClient.post(`${base}/reactivate`, { reason }),
            )
          }
          onDelete={(body) =>
            run("delete", async () => {
              await apiClient.delete(base, body);
              router.push("..");
            })
          }
        />
      </form>

      {/* ---------- the audit trail, LAST ----------

          It is the only section that GROWS without limit. Sitting above
          the two operations that stop a company, it pushed both further
          down the page with every recorded action — so the longer a
          company's history, the harder its controls were to reach. At
          the bottom it can grow as much as it likes and move nothing. */}
      <Card title={labels.auditTitle} testId="card-audit" actions={auditExport}>
        {audit.length === 0 ? (
          <p className="text-sm text-content-muted" data-testid="no-audit">
            {labels.noAudit}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table caption={labels.auditTitle}>
              <THead>
                <TR>
                  <TH>{labels.auditAt}</TH>
                  <TH>{labels.auditAction}</TH>
                  <TH>{labels.auditActor}</TH>
                  <TH>{labels.auditDetails}</TH>
                </TR>
              </THead>
              <TBody>
                {audit.map((entry) => (
                  <TR key={entry.id}>
                    <TD className="whitespace-nowrap text-xs">{entry.at}</TD>
                    <TD>{entry.action}</TD>
                    <TD>{entry.actor}</TD>
                    <TD className="max-w-[20rem] break-words text-content-muted">
                      {entry.details || "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** One branch, as the table edits it. `id` is null for a new row. */
interface BranchRow {
  id: string | null;
  name: string;
  regionId: string;
  cityId: string;
  shortAddress: string;
  contactName: string;
  contactPhone: string;
  /**
   * EMPTY MEANS "KEEP WHAT IS STORED".
   *
   * A stored branch's map URL is never read back into the field: it is
   * sixty characters of query string, and showing it invites an edit
   * nobody meant to make. A new branch cannot be saved without one.
   */
  mapUrl: string;
}

const toBranchRow = (branch: AdminCompanyLocation): BranchRow => ({
  id: branch.id,
  name: branch.name,
  regionId: branch.regionId ?? "",
  cityId: branch.cityId ?? "",
  shortAddress: branch.shortAddress,
  contactName: branch.contactName,
  contactPhone: branch.contactPhone,
  mapUrl: "",
});

const blankBranchRow = (): BranchRow => ({
  id: null,
  name: "",
  regionId: "",
  cityId: "",
  shortAddress: "",
  contactName: "",
  contactPhone: "",
  mapUrl: "",
});

/** Everything a branch needs before it can be written. */
function branchRowIsComplete(row: BranchRow): boolean {
  const filled =
    row.name.trim() !== "" &&
    // THE REGION IS REQUIRED; the city is not.
    row.regionId !== "" &&
    row.shortAddress.trim() !== "" &&
    row.contactName.trim() !== "" &&
    row.contactPhone.trim() !== "";
  if (!filled) return false;
  // A NEW branch cannot be stored without a position; an existing one
  // may keep the one it has.
  if (row.id === null && row.mapUrl.trim() === "") return false;
  return row.mapUrl.trim() === "" || looksLikeAPlace(row.mapUrl);
}

function branchRowChanged(
  row: BranchRow,
  stored: AdminCompanyLocation | undefined,
): boolean {
  if (!stored) return true;
  return (
    row.name.trim() !== stored.name ||
    row.regionId !== (stored.regionId ?? "") ||
    row.cityId !== (stored.cityId ?? "") ||
    row.shortAddress.trim() !== stored.shortAddress ||
    row.contactName.trim() !== stored.contactName ||
    row.contactPhone.trim() !== stored.contactPhone ||
    row.mapUrl.trim() !== ""
  );
}

function branchBody(row: BranchRow): Record<string, string | null> {
  const body: Record<string, string | null> = {
    name: row.name.trim(),
    regionId: row.regionId,
    // Null when none was chosen, never omitted: on an edit an omitted
    // field means "leave it alone" and null means "clear it", and those
    // are different instructions.
    cityId: row.cityId === "" ? null : row.cityId,
    shortAddress: row.shortAddress.trim(),
    contactName: row.contactName.trim(),
    contactPhone: row.contactPhone.trim(),
  };
  if (row.mapUrl.trim() !== "") body.mapUrl = row.mapUrl.trim();
  return body;
}

interface CompanyForm {
  legalName: string;
  crNumber: string;
  email: string;
  mobile1: string;
  mobile2: string;
}

const companyForm = (
  company: AdminCompanyDetail,
  owner: AdminCompanyDetail["users"][number] | undefined,
): CompanyForm => ({
  legalName: company.legalName,
  crNumber: company.crNumber,
  email: company.ownerEmail ?? "",
  mobile1: owner?.primaryMobile1 ?? "",
  mobile2: owner?.primaryMobile2 ?? "",
});

function companyPatchFrom(
  form: CompanyForm,
  company: AdminCompanyDetail,
  owner: AdminCompanyDetail["users"][number] | undefined,
): Record<string, string> {
  const stored = companyForm(company, owner);
  const patch: Record<string, string> = {};
  if (form.legalName.trim() && form.legalName.trim() !== stored.legalName) {
    patch.legalName = form.legalName.trim();
  }
  if (form.crNumber.trim() && form.crNumber.trim() !== stored.crNumber) {
    patch.crNumber = form.crNumber.trim();
  }
  if (form.email.trim() && form.email.trim() !== stored.email) {
    patch.ownerEmail = form.email.trim();
  }
  if (form.mobile1.trim() && form.mobile1.trim() !== stored.mobile1) {
    patch.primaryMobile1 = form.mobile1.trim();
  }
  if (form.mobile2.trim() && form.mobile2.trim() !== stored.mobile2) {
    patch.primaryMobile2 = form.mobile2.trim();
  }
  return patch;
}


function Block({
  title,
  testId,
  actions,
  ruled = false,
  children,
}: {
  /** Omitted where the card's own band already names what follows. */
  title?: string;
  testId: string;
  actions?: React.ReactNode;
  ruled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={
        "flex min-w-0 flex-col gap-2 px-card-x py-2" +
        (ruled ? " border-t border-line" : "")
      }
    >
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h3 className="text-xs font-semibold text-content-muted">{title}</h3>
          ) : (
            <span />
          )}
          {actions ?? null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function Card({
  title,
  testId,
  actions,
  tone = "plain",
  children,
}: {
  title: string;
  testId: string;
  actions?: React.ReactNode;
  tone?: "plain" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const border =
    tone === "danger"
      ? "border-danger"
      : tone === "warning"
        ? "border-warning"
        : "border-line";
  const heading =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning-text"
        : "text-content";

  return (
    <section
      data-testid={testId}
      className={`flex min-w-0 flex-col gap-3 rounded-md border ${border} bg-surface shadow-card px-card-x py-card-y`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`text-sm font-semibold ${heading}`}>{title}</h2>
        {actions ?? null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex min-w-0 border-b border-e border-line">
      <dt
        className={
          "w-28 shrink-0 self-stretch px-4 py-1.5 text-xs text-content-muted " +
          "bg-[color-mix(in_srgb,var(--color-primary)_7%,var(--color-surface))]"
        }
      >
        {label}
      </dt>
      <dd
        className="min-w-0 break-words px-4 py-1.5 text-sm text-content flex-1"
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StopActions({
  company,
  suspended,
  eligibility,
  blockerNames,
  labels,
  busy,
  onSuspend,
  onReactivate,
  onDelete,
}: {
  company: AdminCompanyDetail;
  suspended: boolean;
  eligibility: CompanyDeletionEligibility | null;
  blockerNames: Record<string, string>;
  labels: CompanyPanelLabels;
  busy: Busy;
  onSuspend: (reason: string) => void;
  onReactivate: (reason: string) => void;
  onDelete: (body: { reason: string; confirmation: string }) => void;
}) {
  const [open, setOpen] = useState<null | "stop" | "delete">(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const stopKind = suspended ? "reactivate" : "suspend";
  const disabled = busy !== null;

  // THE SERVER DECIDES. This mirrors the check the delete route runs
  // inside its own transaction, so a screen that got it wrong is
  // refused rather than obeyed.
  const allowed = eligibility?.allowed === true;
  const typedOk =
    confirmation.trim() === company.legalName.trim() ||
    confirmation.trim() === company.crNumber.trim();

  const reasonGiven = reason.trim().length >= 5;
  const ready =
    open === "delete" ? allowed && reasonGiven && typedOk : reasonGiven;

  function toggle(which: "stop" | "delete") {
    setReason("");
    setConfirmation("");
    setOpen((current) => (current === which ? null : which));
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-2 border-t border-line px-card-x py-2"
      data-testid="card-company-stop"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={suspended ? "accentInteractive" : "ghost"}
          disabled={disabled}
          aria-expanded={open === "stop"}
          data-testid={`company-${stopKind}-open`}
          onClick={() => toggle("stop")}
        >
          {suspended ? (
            <Play className="size-4" aria-hidden />
          ) : (
            <PauseCircle className="size-4" aria-hidden />
          )}
          {suspended ? labels.reactivate : labels.suspend}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={disabled}
          aria-expanded={open === "delete"}
          data-testid="delete-open"
          onClick={() => toggle("delete")}
        >
          <Trash2 className="size-4" aria-hidden />
          {labels.deleteAction}
        </Button>
      </div>

      {open === null ? null : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || disabled) return;
            if (open === "delete") {
              onDelete({
                reason: reason.trim(),
                confirmation: confirmation.trim(),
              });
            } else if (suspended) {
              onReactivate(reason.trim());
            } else {
              onSuspend(reason.trim());
            }
          }}
        >
          {/* WHAT STOPS IT, named and counted — inside the row the
              operator opened, not above a button they had not pressed. */}
          {open === "delete" && eligibility && !eligibility.allowed ? (
            <p
              className="w-full text-sm text-danger"
              data-testid="delete-blocked"
            >
              {labels.deleteBlocked}{" "}
              <span className="text-content">
                {eligibility.blockers
                  .map(
                    (blocker) =>
                      `${blockerNames[blocker.kind] ?? blocker.kind} (${blocker.count})`,
                  )
                  .join(" · ")}
              </span>
            </p>
          ) : null}

          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
            <Label
              htmlFor={
                open === "delete" ? "delete-reason" : `company-${stopKind}-reason`
              }
            >
              {open === "delete" ? labels.deleteReason : labels.suspendReason}
            </Label>
            <Input
              id={
                open === "delete" ? "delete-reason" : `company-${stopKind}-reason`
              }
              value={reason}
              disabled={open === "delete" && !allowed}
              autoFocus
              onChange={(event) => setReason(event.target.value)}
              data-testid={
                open === "delete" ? "delete-reason" : `company-${stopKind}-reason`
              }
            />
          </div>

          {/* THE TYPED NAME APPEARS ONLY WHEN REMOVAL IS ACTUALLY
              POSSIBLE. Asking an operator to type a company's name for a
              button that cannot be pressed is work spent to reach a
              refusal.

              WHAT TO TYPE IS SHOWN IN THE FIELD: the placeholder is the
              company's own registration number, one of the two accepted
              values. A line of prose repeating that is the standing
              explanation this console does not carry — and the button
              stays unpressable until what is typed matches, so the rule
              is enforced rather than narrated. */}
          {open === "delete" && allowed ? (
            <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
              <Label htmlFor="delete-confirmation">
                {labels.deleteConfirmLabel}
              </Label>
              <Input
                id="delete-confirmation"
                value={confirmation}
                placeholder={company.crNumber}
                onChange={(event) => setConfirmation(event.target.value)}
                data-testid="delete-confirmation"
              />
            </div>
          ) : null}

          {/* THE WORD BESIDE THE FIELD. The rule is visible: it cannot be
              pressed until the reason exists, rather than failing after
              the press. */}
          <Button
            type="submit"
            size="sm"
            variant={open === "delete" ? "danger" : "accentInteractive"}
            disabled={disabled || !ready}
            data-testid={
              open === "delete" ? "delete-submit" : `company-${stopKind}-submit`
            }
          >
            {busy === (open === "delete" ? "delete" : stopKind)
              ? labels.working
              : labels.confirmAction}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => setOpen(null)}
          >
            {labels.cancel}
          </Button>
        </form>
      )}
    </div>
  );
}

