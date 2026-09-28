"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  PORTAL_STRIP_SLOT,
} from "@/components/portal/portal-page-bar";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  ChevronLeft,
  ChevronRight,
  Info,
  Lock,
  MapPin,
  Warehouse,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  isValidSaudiIban,
  normalizeSaudiIban,
  saudiBankFromIban,
} from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { LocationPicker, type Position } from "./location-picker";
import { useLiveCities } from "./use-live-cities";
import {
  IconAddress,
  IconBank,
  IconBranches,
  IconInvoice,
  IconCity,
  IconEmail,
  IconIban,
  IconPerson,
  IconPhone,
  IconPlace,
  IconRegion,
  IconVat,
} from "./field-icons";
import type {
  CompanyBranch,
  CompanyContact,
} from "@/lib/company-profile-data";
import type { CompanyRecordLabels } from "./company-record-labels";

/**
 * «استكمال بيانات المنشأة» — ONE CARD, ONE EDIT BUTTON.
 *
 * WHAT THIS REPLACED, and why it had to. The record used to be five
 * separate cards stacked down the page — details, branches, contacts,
 * bank, billing — each with its own «تعديل», its own save and its own
 * idea of what "done" meant. It ran to three screens, and a company
 * filling it in had to find and press five different buttons to record
 * one set of facts about itself. The approved reference draws it as a
 * single card, and it is right: this is ONE record.
 *
 * THREE STATES, ONE DESIGN. The same card is what a company sees while
 * its record is still short, what it sees once everything is answered,
 * and what it sees while editing. Nothing moves between those states —
 * the values become fields and the fields become values, in place.
 *
 * WHAT IS NOT EDITABLE, and why each one:
 *
 *   · THE LEGAL NAME and THE REGISTRATION NUMBER are what the platform
 *     verified this company by. Letting a company change either from
 *     its own portal would let it become a different company after
 *     approval. An administrator changes them, through the console,
 *     where the change is recorded against whoever made it.
 *   · THE EMAIL has its own flow, with its own verification. Editing
 *     it beside a billing name would silently break the one address
 *     the platform can reach this company on.
 *   · THE BANK is read out of the IBAN and never chosen.
 *
 * ONE PRESS, SEVERAL ENDPOINTS. There is no single "save the company"
 * endpoint and this card does not invent one: it sends only what
 * CHANGED, to the endpoint that owns it, and stops at the first
 * refusal with that refusal on screen. Nothing is written twice, and a
 * field nobody touched is never sent — which is what keeps an edit
 * from re-submitting a bank account or moving a branch that nobody
 * moved.
 */

/** A branch as this form holds it — either an existing row or a new one. */
interface BranchDraft {
  /** Null while it has never been saved. */
  id: string | null;
  name: string;
  regionId: string;
  cityId: string;
  shortAddress: string;
  contactName: string;
  contactPhone: string;
  /** Set only when the pin was CONFIRMED in this editing session. */
  moved: Position | null;
  /** Where its map opens — its saved position, if it has one. */
  at: Position | null;
}

/** A contact as this form holds it. */
interface ContactDraft {
  id: string | null;
  name: string;
  phone: string;
}

const emptyBranch = (): BranchDraft => ({
  id: null,
  name: "",
  regionId: "",
  cityId: "",
  shortAddress: "",
  contactName: "",
  contactPhone: "",
  moved: null,
  at: null,
});


/**
 * WHO THE RECORD BELONGS TO, in one row.
 *
 * TWO TONES, ONE MARKUP. `band` is the navy header the buyer's card
 * still wears; `strip` is the same three facts laid into the open
 * tab's own row. Written twice they would drift — one would gain a
 * field, or lose the lock, and only one reader would ever see it.
 *
 * THE STRIP TONE ADDS NO HEIGHT. Its labels sit BEFORE their values
 * rather than above them, nothing wraps, and the name is the only thing
 * allowed to shrink — «بدون ما تزود في ارتفاع الشريط أو نزوله للأسفل».
 *
 * THE CHIP KEEPS ITS OWN COLOUR in both. Verified is the platform's
 * green wherever it is read; a state that changed colour with its
 * background would be a second thing to learn.
 *
 * AT MODULE SCOPE, so it is not a new component type on every keystroke
 * of the form below it.
 */
function IdentityRow({
  isSupplier,
  legalName,
  verified,
  underReview,
  labels,
  tone,
}: {
  isSupplier: boolean;
  legalName: string;
  verified: boolean;
  underReview: boolean;
  labels: {
    legalName: string;
    statusVerified: string;
    statusUnderReview: string;
    statusInProgress: string;
    lockedNotice: string;
  };
  tone: "band" | "strip";
}) {
  const strip = tone === "strip";
  /**
   * AND THE INK FOLLOWS THE SURFACE, WHICH HAS CHANGED TWICE.
   *
   * «معك اسم المنشأة في بياناتي غير ظاهر، يمكن جايٍ باللون الأبيض في
   *  سطح المكتب والجوال.»
   *
   * EXACTLY THAT. The line was amber once and took dark ink; then it
   * became the identity's navy and took white, because the dark ink
   * measured 1.07:1 on it — present in the DOM and invisible on the
   * screen. The line has no surface at all now — «بنلغي الشريط من
   *  جميع الصفحات» — so it stands on the page card's own white, and
   * white on white is the same defect a third time.
   *
   * SO IT IS THE PAGE'S OWN INK: 15.7:1 on that white, and the same
   * ink every other line of this page is written in.
   */
  const ink = strip ? "text-content" : "text-primary-foreground";

  /**
   * THE RULE THAT PARTS A LABEL FROM ITS VALUE.
   *
   * «احذف الخط الفاصل اللي أنت حاطه بين الاسم والسجل، وخلّه يكون بعد
   * اسم المنشأة يفصل بينه وبين الاسم، وواحد ثانٍ يفصل بين السجل ورقمه».
   * It used to stand between the two HALVES, which needed no rule: they
   * are already at opposite ends of the strip. Where a rule earns its
   * place is between a name and the thing it names, which sit two
   * millimetres apart.
   */
  const rule = (
    <span
      aria-hidden
      className={
        "h-4 w-px shrink-0 " +
        // AND SO IS THE RULE, for the same reason. On the page's own
        // white it is the platform's hairline, which is what parts
        // everything else on this page.
        (strip
          ? "bg-line"
          : "bg-[color-mix(in_srgb,var(--color-on-primary)_35%,transparent)]")
      }
    />
  );

  const status = verified
    ? labels.statusVerified
    : underReview
      ? labels.statusUnderReview
      : labels.statusInProgress;

  /**
   * WHAT THE COMPANY'S STANDING LOOKS LIKE.
   *
   * IN THE STRIP IT IS A MARK AND NO WORD — «بدل كلمة منشأة موثقة
   *  نكتفي بالصح الأخضر جنب الاسم». The strip is one line and the
   * NAME is what it is for; «منشأة موثقة» spelled out beside it cost
   * about seventy pixels of a phone's width and the name was showing
   * half of itself. A shield with a tick says the same thing to
   * anyone looking, and `title` plus `sr-only` say it in words to
   * anyone who cannot see it — so nothing is lost but the room.
   *
   * THE BAND KEEPS ITS WORDS. It is a block inside the page with a
   * line to itself, and a bare glyph there would be a riddle.
   */
  const chip = strip ? (
    <span
      className={
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full " +
        (verified
          ? "bg-success text-success-foreground"
          : "bg-accent text-accent-foreground")
      }
      title={status}
      data-testid="identity-status"
    >
      <ShieldCheck className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">{status}</span>
    </span>
  ) : (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
        (verified
          ? "bg-success text-success-foreground"
          : "bg-accent text-accent-foreground")
      }
      data-testid="identity-status"
    >
      <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
      {status}
    </span>
  );

  /* WHAT THE COMPANY IS TO THIS PLATFORM. «خلّها ترمز لمورد أو مستودع»
     — a supplier is a place goods come out of, and a warehouse says
     that where a generic office block said only "a company". A BUYER
     keeps the block: it is not a warehouse, and the same card serves
     both. */
  const Mark = isSupplier ? Warehouse : Building2;


  if (strip) {
    return (
      // THE TWO HALVES TAKE THE TWO ENDS — «اجعل الأيقونة واسم المنشأة
      // والاسم وأيقونة التوثيق على يمين الشريط، وأبقِ السجل على يساره».
      // `justify-between` and nothing else decides which end is which:
      // in Arabic the row runs right to left and the name leads, in
      // English it leads from the left. One rule, no direction branch.
      //
      // AND NO RULE BETWEEN THEM. The width itself parts them; a line
      // there was separating two things that were already apart.
      <div
        className="flex w-full min-w-0 items-center justify-between gap-4 whitespace-nowrap"
        data-testid="company-identity-band"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Mark className={"size-4 shrink-0 " + ink} aria-hidden />
          <span className={"shrink-0 text-xs font-medium " + ink}>{labels.legalName}</span>
          {rule}
          <span
            className={"min-w-0 truncate text-sm font-semibold " + ink}
            data-testid="identity-legal-name"
          >
            {legalName}
          </span>
          {chip}
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-t-card bg-primary px-card-x py-3"
      data-testid="company-identity-band"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-card bg-[color-mix(in_srgb,var(--color-on-primary)_16%,transparent)]"
          aria-hidden
        >
          <Mark className="size-6 text-primary-foreground" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className={"text-start text-xs " + ink}>{labels.legalName}</span>
          {/* THE NAME AND ITS STATE ON ONE LINE. The chip qualifies the
              name, so it belongs beside it — and it wraps under only
              when there is genuinely no width for both. */}
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={"truncate text-base font-semibold " + ink}
              data-testid="identity-legal-name"
            >
              {legalName}
            </span>
            {chip}
          </span>
        </span>
      </div>


    </div>
  );
}

/**
 * A ROW NOBODY HAS TOUCHED IS NOT A BRANCH.
 *
 * The card seeds a blank main branch when a company has none yet, so
 * there is somewhere to type. If that blank counted as a branch, a
 * supplier who came here only to record a billing name would find the
 * save refused for a branch they never started — so a row that was
 * never saved and is entirely empty is skipped by the save and by
 * everything that decides whether a save may happen.
 */
const isBlank = (row: BranchDraft): boolean =>
  row.id === null &&
  row.moved === null &&
  row.name.trim() === "" &&
  row.regionId === "" &&
  row.cityId === "" &&
  row.shortAddress.trim() === "" &&
  row.contactName.trim() === "" &&
  row.contactPhone.trim() === "";

const branchDraft = (branch: CompanyBranch): BranchDraft => ({
  id: branch.id,
  name: branch.name,
  regionId: branch.regionId,
  cityId: branch.cityId ?? "",
  shortAddress: branch.shortAddress,
  contactName: branch.contactName,
  contactPhone: branch.contactPhone,
  moved: null,
  at: { latitude: branch.latitude, longitude: branch.longitude },
});

export function CompanyRecordCard({
  company,
  email,
  billing,
  bank,
  branches,
  contacts,
  regions,
  cities,
  isSupplier,
  verified,
  underReview,
  met,
  total,
  canSubmit,
  locked,
  identityInStrip = false,
  backHref,
  labels,
}: {
  company: { legalName: string; crNumber: string };
  email: string;
  /** Null for a buyer, which is never asked for one. */
  billing: {
    invoicingLegalName: string | null;
    isVatRegistered: boolean | null;
    vatNumber: string | null;
  } | null;
  /** The account in force, if any. Null for a buyer. */
  bank: { accountHolderName: string; bankName: string; ibanLast4: string } | null;
  branches: readonly CompanyBranch[];
  contacts: readonly CompanyContact[];
  regions: readonly { id: string; name: string; alternateName: string }[];
  cities: readonly {
    id: string;
    regionId: string;
    name: string;
    group: string;
    alternateName: string;
  }[];
  isSupplier: boolean;
  /** The SERVER's verdict — never a completion count reaching 100%. */
  verified: boolean;
  /** A request is open. Never true for one unsent or refused. */
  underReview: boolean;
  met: number;
  total: number;
  /** The server's own verdict on whether the record may be sent. */
  canSubmit: boolean;
  /** True while a request is under review — the whole record closes. */
  locked: boolean;
  /**
   * The chrome above this card draws a strip, and the identity belongs
   * in it — «ألغِ البطاقة الداكنة وانقل اللي فيها للشريط».
   *
   * TOLD RATHER THAN DISCOVERED. Looking for the slot after mount meant
   * the server rendered the dark band and the browser then took it
   * away, so the bar flashed on every load of the page whose whole
   * point was that the bar is gone. The supplier's portal passes true;
   * the buyer's passes nothing and keeps the band it always had.
   */
  identityInStrip?: boolean;
  backHref: string;
  labels: CompanyRecordLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const locale = useLocale();
  const rtl = locale.startsWith("ar");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  // THE OPEN TAB'S STRIP, once the document has one.
  //
  // WHETHER there is one is told, not discovered: `identityInStrip` is
  // the supplier's chrome saying it draws a strip. Discovering it after
  // mount meant the server rendered the band and the browser then took
  // it away — a dark bar that flashed on every load of the page whose
  // whole point was that the bar is gone.
  //
  // The buyer's portal passes nothing and keeps the band it always had:
  // «لا تعمّم التصميم إلا بموافقتي الصريحة».
  const [strip, setStrip] = useState<HTMLElement | null>(null);
  /**
   * THERE IS ONE SLOT NOW, NOT TWO.
   *
   * The chrome used to draw a wide strip and a narrow row, one of
   * which the stylesheet hid, so this filled BOTH — choosing between
   * them in JavaScript would have meant listening to a media query
   * and re-portalling on every rotation. The strips are gone: what
   * is left is a line inside the PAGE — «ما أحتاج شريط، وأي معلومات
   *  كانت في الأشرطة السابقة تنزل في الصفحة» — and one line means
   * one target at every width.
   */
  useEffect(() => {
    if (!identityInStrip) return;
    setStrip(document.getElementById(PORTAL_STRIP_SLOT));
  }, [identityInStrip]);

  /** What the identity says, gathered once for whichever shape draws it. */
  const identity = {
    isSupplier,
    legalName: company.legalName,
    verified,
    underReview,
    labels: {
      legalName: labels.legalName,
      statusVerified: labels.statusVerified,
      statusUnderReview: labels.statusUnderReview,
      statusInProgress: labels.statusInProgress,
      lockedNotice: labels.lockedNotice,
    },
  };
  /** Which branch row has its map open, by index. */
  const [pickingAt, setPickingAt] = useState<number | null>(null);

  const [form, setForm] = useState({
    email,
    vatNumber: billing?.vatNumber ?? "",
    accountHolderName: bank?.accountHolderName ?? "",
    iban: "",
  });
  const [branchRows, setBranchRows] = useState<BranchDraft[]>(
    branches.map(branchDraft),
  );
  const [contactRows, setContactRows] = useState<ContactDraft[]>(
    contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
  );

  /**
   * THE CITY LIST, READ LIVE.
   *
   * THE FAULT. The server read `/cities/active` through a 300-second
   * Next.js data cache, so switching a city on in the console changed
   * nothing here for up to five minutes — and the only thing that ever
   * looked like it helped was changing the region and changing it
   * back, which merely re-derived the list from props that were
   * already stale. Re-rendering the page would have re-read it and
   * thrown away everything typed.
   *
   * The server's list is still the first paint; this replaces it with
   * a live read, and nothing else on the card moves.
   */
  const { cities: liveCityRows } = useLiveCities(null);

  /**
   * The live rows in the shape this card's picker wants.
   *
   * WHEN THE LIVE READ HAS NOT ANSWERED YET the server's list stands —
   * so the picker is never empty for the first moment of a page load,
   * and never stale for longer than one request after that.
   */
  const liveCities = useMemo(() => {
    if (liveCityRows === null) return cities;
    return liveCityRows.map((city) => ({
      id: city.id,
      regionId: city.region.id,
      name: rtl ? city.nameAr : city.nameEn,
      alternateName: rtl ? city.nameEn : city.nameAr,
      group: rtl ? city.region.nameAr : city.region.nameEn,
    }));
  }, [liveCityRows, cities, rtl]);

  // `met`/`total` stay in the contract because the page head still
  // draws a progress bar from them while the record is unfinished;
  // the BAND no longer shows a percentage of its own.
  void met;
  void total;

  /**
   * THE MAIN BRANCH — the establishment's own address.
   *
   * This platform has no company-level address: a company's address IS
   * its first branch's, which is why the reference's top-of-card
   * «العنوان الوطني المختصر» and «المدينة» are bound to it here. A
   * company with no branch yet edits a blank one, and saving creates it.
   */
  const mainBranch = branchRows[0] ?? emptyBranch();
  const setMain = (patchRow: Partial<BranchDraft>) =>
    setBranchRows((rows) =>
      rows.length === 0
        ? [{ ...emptyBranch(), ...patchRow }]
        : rows.map((r, i) => (i === 0 ? { ...r, ...patchRow } : r)),
    );

  /** Where the main branch's pin stands: moved this session, or saved. */
  const mainPosition: Position | null = mainBranch.moved ?? mainBranch.at;

  /**
   * OPENING THE CARD ALWAYS OPENS A MAIN BRANCH.
   *
   * A company with none yet would otherwise see the grid's address and
   * city over nothing, and its name, its contact and its pin nowhere
   * at all — the reference always draws «الفرع الرئيسي», and there is
   * always one to fill in. The row is only seeded, never saved: an
   * edit that is cancelled leaves the company exactly as it was.
   */
  function beginEditing() {
    if (branchRows.length === 0) setBranchRows([emptyBranch()]);
    setEditing(true);
  }

  /* ------------------------------------------------ the IBAN, as typed */
  const read = useMemo(() => {
    const normalized = normalizeSaudiIban(form.iban);
    if (normalized === "") return { state: "empty" as const };
    if (!isValidSaudiIban(normalized)) return { state: "invalid" as const };
    return { state: "valid" as const, bank: saudiBankFromIban(normalized) };
  }, [form.iban]);

  const derivedBank =
    read.state === "valid" && read.bank
      ? rtl
        ? read.bank.nameAr
        : read.bank.nameEn
      : null;

  /**
   * THE VAT NUMBER IS REQUIRED AND IT IS TYPED.
   *
   * The «مسجّلة / غير مسجّلة» question is gone from this form by the
   * owner's rule: a supplier on this platform HAS a registration, so
   * the form asks for the number and nothing else. An empty field is
   * therefore not merely unanswered — it is missing, and it stops the
   * save rather than sending half an answer.
   *
   * THE SERVER'S RULE IS UNCHANGED. `PUT /tax-profile` still accepts
   * «not registered», so a record entered before this decision keeps
   * working and keeps reading back correctly; this form simply never
   * produces that answer again.
   */
  /**
   * THE SAME SHAPE THE SERVER APPLIES, said beside the field so a
   * typo is answered before a round trip rather than after one. The
   * server's `@IsEmail()` remains the authority; this only refuses
   * what could never be an address under any reading.
   */
  const emailBad =
    form.email.trim() !== "" && !/^[^s@]+@[^s@]+.[^s@]+$/.test(form.email.trim());
  const emailMissing = form.email.trim() === "";

  const vatBad =
    isSupplier &&
    form.vatNumber.trim() !== "" &&
    !/^\d{15}$/.test(form.vatNumber.trim());
  const vatMissing = isSupplier && form.vatNumber.trim() === "";

  /**
   * WHAT STOPS A SAVE. Only what is genuinely wrong — a half-typed
   * field is not an error until somebody asks to keep it, and this
   * card never asks for a field that account type is not asked for.
   */
  /**
   * WHY THE SAVE IS REFUSED — named, not merely greyed out.
   *
   * THE FAULT THIS FIXES. The button simply disabled itself, and the
   * two fields that most often held it back — a branch's name and its
   * telephone — were down in a list rather than on the grid the
   * person was looking at. There was nothing on the screen to read.
   * Now every reason is listed under the button, and the button is
   * still disabled: a refusal that says nothing is the fault, not the
   * refusal itself.
   *
   * THE MAIN BRANCH IS NOT ON THIS LIST for a name or a contact,
   * because it is no longer asked for either — see `mainBranchBody`.
   */
  const blockers: string[] = [];
  if (isSupplier && vatMissing) blockers.push(labels.blockVatMissing);
  if (vatBad) blockers.push(labels.blockVatInvalid);
  if (read.state === "invalid") blockers.push(labels.blockIbanInvalid);
  /**
   * THE IBAN AND THE HOLDER ARE A PAIR, and this is the fault it fixes.
   *
   * The card offered the save for a well-formed IBAN with the holder
   * left blank, then POSTed an empty name — which the server refuses
   * with `@MinLength(1)`, so the press produced a 400 and a reference
   * number instead of a saved account. Whichever half is present, the
   * other is now named as missing BEFORE the button is pressed.
   *
   * NEITHER HALF IS REQUIRED ON ITS OWN. A supplier editing something
   * else entirely leaves both alone and the account on file stands —
   * this only refuses HALF an account.
   */
  const holderTyped = form.accountHolderName.trim() !== "";
  if (read.state === "valid" && !holderTyped)
    blockers.push(labels.blockAccountHolder);
  if (holderTyped && read.state === "empty" && bank === null)
    blockers.push(labels.blockIbanMissing);
  if (emailMissing) blockers.push(labels.blockEmailMissing);
  if (emailBad) blockers.push(labels.blockEmailInvalid);
  // THE BILLING NAME IS NOT ON THIS LIST, and that is the point of it
  // being automatic: it is filled from the legal name on save, so it
  // can never be the invisible reason a save is refused.
  if (!isBlank(mainBranch) || mainBranch.id !== null) {
    if (mainBranch.shortAddress.trim() === "")
      blockers.push(labels.blockAddress);
    if (mainBranch.regionId === "") blockers.push(labels.blockRegion);
    if (mainBranch.id === null && mainBranch.moved === null)
      blockers.push(labels.blockPosition);
  }
  // ADDITIONAL branches keep every field they always had.
  const extras = branchRows.slice(1).filter((b) => !isBlank(b));
  if (
    extras.some(
      (b) =>
        b.name.trim() === "" ||
        b.regionId === "" ||
        b.shortAddress.trim() === "" ||
        b.contactName.trim() === "" ||
        b.contactPhone.trim() === "" ||
        (b.id === null && b.moved === null),
    )
  ) {
    blockers.push(labels.blockExtraBranch);
  }
  if (contactRows.some((c) => c.name.trim() === "" || c.phone.trim() === ""))
    blockers.push(labels.blockContact);

  const savable = !saving && blockers.length === 0;

  function reset() {
    setForm({
      email,
      vatNumber: billing?.vatNumber ?? "",
      accountHolderName: bank?.accountHolderName ?? "",
      iban: "",
    });
    setBranchRows(branches.map(branchDraft));
    setContactRows(
      contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
    );
    setPickingAt(null);
    setFailure(null);
  }

  /* --------------------------------------------------------- saving */
  async function save() {
    if (!savable) return;
    setSaving(true);
    setFailure(null);

    try {
      /**
       * THE ADDRESS FIRST, because it is the one thing on this card
       * whose refusal a person most needs to see against the field
       * they changed — a taken address comes back 409 and nothing
       * else has been written yet.
       */
      const nextEmail = form.email.trim();
      if (nextEmail !== "" && nextEmail.toLowerCase() !== email.toLowerCase()) {
        await apiClient.put("/me/email", { email: nextEmail });
      }

      if (isSupplier) {
        /**
         * THE BILLING NAME IS THE LEGAL NAME, and it is written here
         * rather than asked for.
         *
         * The name on the commercial registration IS the name a
         * document is addressed to, so a second field for it was two
         * places to answer one question — and the one most often left
         * blank, which made it the commonest invisible reason a save
         * was refused.
         *
         * IT IS NOT A HIDDEN FIELD. Nothing about it can block a save:
         * it is derived, sent only when it differs from what is
         * stored, and it counts towards completion the moment it is
         * written. Invoices already issued are untouched — this
         * changes what is ASKED for, not what was recorded.
         */
        const nextName = company.legalName.trim();
        if (nextName !== "" && nextName !== (billing?.invoicingLegalName ?? "")) {
          await apiClient.put("/companies/me/invoicing-profile", {
            invoicingLegalName: nextName,
          });
        }

        // ALWAYS REGISTERED, ALWAYS WITH THE NUMBER. The form no
        // longer offers the other answer, so it never sends it.
        const nextVat = form.vatNumber.trim();
        if (
          nextVat !== "" &&
          (nextVat !== (billing?.vatNumber ?? "") ||
            billing?.isVatRegistered !== true)
        ) {
          await apiClient.put("/companies/me/tax-profile", {
            isVatRegistered: true,
            vatNumber: nextVat,
          });
        }

        // A BANK ACCOUNT IS APPENDED, never edited — the row is part of
        // what an administrator approved. Sent only when a new IBAN was
        // actually typed, and only WITH its holder: the server refuses
        // an empty name, and a request that cannot succeed must not
        // leave here. `blockers` says so before the button is pressed;
        // this is the same rule again at the point of sending, because
        // a disabled button is an affordance and Enter still submits.
        if (read.state === "valid" && form.accountHolderName.trim() !== "") {
          await apiClient.post("/companies/me/bank-account", {
            accountHolderName: form.accountHolderName.trim(),
            iban: normalizeSaudiIban(form.iban),
          });
        }
      }

      for (const [index, row] of branchRows.entries()) {
        if (isBlank(row)) continue;

        /**
         * THE FIRST ROW IS «الفرع الرئيسي», AND IT IS WRITTEN FOR THEM.
         *
         * The address, the region, the city and the pin on the grid
         * above ARE this branch — nobody is asked to name it or to
         * give it a second telephone, because the company already gave
         * both at registration. Its name is fixed and its contact is
         * the company's own first contact, so there is nothing to fill
         * in twice and nothing invisible holding the save back.
         *
         * IT IS UPDATED, NEVER DUPLICATED. A row that already has an
         * id is PATCHed; only a company that has no branch at all gets
         * a POST, and that POST creates exactly one.
         */
        // WRITTEN ONLY WHEN IT IS BEING CREATED. A main branch that
        // already exists keeps the name and the contact it was saved
        // with: this card does not ask for either, so it must not
        // quietly rewrite them — renaming a company's own branch
        // behind their back is worse than a name that does not match
        // a convention introduced afterwards.
        const isNewMain = index === 0 && row.id === null;
        const firstContact = contactRows[0];
        const body: Record<string, unknown> = {
          name: isNewMain ? labels.mainBranch : row.name.trim(),
          regionId: row.regionId,
          // Null CLEARS the city; omitting would leave it alone, and
          // those are different instructions.
          cityId: row.cityId === "" ? null : row.cityId,
          shortAddress: row.shortAddress.trim(),
          contactName: isNewMain
            ? (firstContact?.name.trim() ?? "")
            : row.contactName.trim(),
          contactPhone: isNewMain
            ? (firstContact?.phone.trim() ?? "")
            : row.contactPhone.trim(),
        };
        if (row.moved) {
          body.latitude = row.moved.latitude;
          body.longitude = row.moved.longitude;
        }

        const original = row.id
          ? branches.find((b) => b.id === row.id)
          : undefined;

        if (row.id === null) {
          await apiClient.post("/companies/me/locations", body);
        } else if (
          original &&
          (row.moved !== null ||
            original.name !== body.name ||
            original.regionId !== body.regionId ||
            (original.cityId ?? null) !== body.cityId ||
            original.shortAddress !== body.shortAddress ||
            original.contactName !== body.contactName ||
            original.contactPhone !== body.contactPhone)
        ) {
          await apiClient.patch(`/companies/me/locations/${row.id}`, body);
        }
      }

      for (const row of contactRows) {
        const original = row.id
          ? contacts.find((c) => c.id === row.id)
          : undefined;
        const body = { name: row.name.trim(), phone: row.phone.trim() };
        if (row.id === null) {
          await apiClient.post("/companies/me/contacts", body);
        } else if (
          original &&
          (original.name !== body.name || original.phone !== body.phone)
        ) {
          await apiClient.patch(`/companies/me/contacts/${row.id}`, body);
        }
      }

      // REMOVED ROWS ARE REMOVED, and only rows that were SAVED can be.
      for (const contact of contacts) {
        if (!contactRows.some((row) => row.id === contact.id)) {
          await apiClient.delete(`/companies/me/contacts/${contact.id}`);
        }
      }

      setEditing(false);
      setPickingAt(null);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setSaving(false);
    }
  }

  async function submitForReview() {
    setSubmitting(true);
    setFailure(null);
    try {
      await apiClient.post("/companies/me/verification-request");
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setSubmitting(false);
    }
  }

  const BackChevron = rtl ? ChevronLeft : ChevronRight;
  const citiesIn = (regionId: string) =>
    liveCities.filter((city) => city.regionId === regionId);
  const nameOf = <T extends { id: string; name: string }>(
    list: readonly T[],
    id: string,
  ) => list.find((item) => item.id === id)?.name ?? "—";

  /* =================================================== the one card */
  /**
   * THE CONTACTS, WRITTEN ONCE AND PLACED TWICE.
   *
   * «في المورد فقط» — the supplier draws them as a card beside the
   * branches, because a tenth cell in a grid three across pushes the
   * account holder, the IBAN and the bank name apart and «رجّع صف
   * الحساب البنكي موازي لبعض». The buyer has no bank row and an empty
   * slot beside the city, so there they stay a cell in the table where
   * they were asked for: «انقل جهة اتصال إضافية تحته تكون موازية
   * للمدينة».
   *
   * ONE DEFINITION, so the two placements cannot drift into two
   * different lists of contacts.
   */
  const contactRowsMarkup = (
    <>
          {contactRows.length === 0 ? (
            <p
              className="text-sm text-content-muted"
              data-testid="record-contacts-empty"
            >
              {labels.contactsEmpty}
            </p>
          ) : null}

          <ul className="flex list-none flex-col gap-2">
            {contactRows.map((row, index) => (
              <li
                key={row.id ?? `new-${index}`}
                className="flex flex-wrap items-center gap-2"
                data-testid={`record-contact-${index}`}
              >
                {editing ? (
                  <>
                    <Input
                      className="min-w-0 flex-1"
                      value={row.name}
                      placeholder={labels.contactName}
                      onChange={(e) =>
                        setContactRows((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, name: e.target.value } : r,
                          ),
                        )
                      }
                      data-testid={`record-contact-name-${index}`}
                    />
                    <Input
                      className="min-w-0 flex-1"
                      dir="ltr"
                      value={row.phone}
                      placeholder="05xxxxxxxx"
                      onChange={(e) =>
                        setContactRows((rows) =>
                          rows.map((r, i) =>
                            i === index ? { ...r, phone: e.target.value } : r,
                          ),
                        )
                      }
                      data-testid={`record-contact-phone-${index}`}
                    />
                    {/* THE FIRST CONTACT IS THE NUMBER GIVEN AT
                        REGISTRATION and the company's only reachable
                        one; removing it would leave nobody to call. */}
                    {index > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={labels.removeContact}
                        onClick={() =>
                          setContactRows((rows) =>
                            rows.filter((_, i) => i !== index),
                          )
                        }
                        data-testid={`record-remove-contact-${index}`}
                      >
                        <Trash2 className="size-4 text-danger" aria-hidden />
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                    <span className="truncate text-sm text-content">
                      {row.name}
                    </span>
                    <bdi className="font-mono text-xs text-content-muted">
                      {row.phone}
                    </bdi>
                  </span>
                )}
              </li>
            ))}
          </ul>
    </>
  );

  return (
    <section
      id="company-record"
      data-testid="company-record-card"
      /*
        NO OVERFLOW CLIPPING HERE, and that is the fix rather than a
        style preference. It was added to clip the navy band's corners
        to the card's, and it clipped every absolutely-positioned thing
        INSIDE the card as well — including the region list, which ran
        past the card's edge and simply stopped being drawn. The list
        scrolled internally the whole time; what a reader could SEE
        stopped, which is why it read as "the scrolling stops and I
        cannot reach the last region". The two children that touch the
        card's corners round their own instead.
      */
      className="flex min-w-0 flex-col rounded-card bg-surface shadow-card"
    >
      {/* ------------------------------------------ the identity band */}
      {/* THE TWO HALVES START AT THE SAME LINE. «اسم المنشأة» and «رقم
          السجل التجاري» are the labels of one row, so they have to sit
          level with each other — which they only do if both columns
          are top-aligned. Centring them made the left column's three
          lines push its label above the right column's two. */}
      {/* ONE LINE, NOT THREE. «شريط بيانات المنشأة ارتفاعه مبالغ فيه»
          — and the height was three stacked things that are one fact
          between them: the label, the name, and a chip about the name
          sitting under it. The chip goes BESIDE the name, the number
          loses the box it never needed, and the band comes down to the
          height of what it actually says.

          THE TWO HALVES ARE PARTED BY A RULE rather than by air, which
          is what the approved image draws and what lets them sit close
          without reading as one run-on line. */}
      {/* WHO THIS RECORD BELONGS TO — in the tab's strip, or on a band
          of its own where there is no strip.

          «بيانات المنشأة في بطاقة داكنة — ألغِ البطاقة الداكنة وانقل
          اللي فيها للشريط». The name, the state it is in and the
          registration number are read at a glance and never edited
          here; a navy band across the top of the card spent a row of
          the page on them, directly beneath a strip that had room for
          all three.

          THE STRIP'S HEIGHT IS NOT TOUCHED — «بدون ما تزود في ارتفاع
          الشريط أو نزوله للأسفل». One line, nothing wraps, and the
          label sits BEFORE its value rather than above it, which is
          the whole of what made the band two rows tall. */}
      {identityInStrip ? (
        strip ? createPortal(<IdentityRow {...identity} tone="strip" />, strip) : null
      ) : (
        <IdentityRow {...identity} tone="band" />
      )}

      {/* ------------------------------------------- the field grid
          IN THE ORDER THE OWNER SET, right to left in Arabic:

            البريد الإلكتروني · العنوان الوطني المختصر · الرقم الضريبي
            الموقع + «إضافة الموقع» · المنطقة · المدينة
            اسم صاحب الحساب · الآيبان · اسم البنك

          TWO FIELDS ARE GONE FROM THIS GRID, and neither is gone from
          the record:

            · THE LEGAL NAME, because the navy band above already shows
              it. One value printed twice on one card is a card that
              can appear to disagree with itself.
            · THE BILLING NAME, because it IS the legal name — the name
              on the commercial registration is the name a document is
              addressed to. It is filled in on save rather than asked
              for, so nothing about it can hold a save back and nothing
              about it is hidden: see `save()`.

          Existing invoices are untouched. This changes what is ASKED
          for, not what was already written.

          THE ADDRESS AND THE PLACE BELONG TO THE MAIN BRANCH. This
          platform has no company-level address column, because a
          company's address IS its first branch's.

          THE REGION IS REQUIRED AND THE CITY IS NOT. A branch on a
          region alone is a complete branch; the city never blocks a
          save or the completion count. */}
      {/* THE HAIRLINES ARE THE GAP. «حطّينا البيانات اللي في البطاقة
          على شكل صفوف، العناوين بصف غامق والبيانات بصف فاتح» —
          a one-pixel gap over a line-coloured ground rules every seam,
          horizontal and vertical, at whatever column count the width
          happens to give. Drawing them as borders instead means naming
          which cell starts a row, and that answer changes at every
          breakpoint.

          AND THE PADDING MOVED INTO THE CELLS, so the bands reach the
          card's edges and read as one table rather than a grid floating
          inside a box. */}
      <div
        className={
          "grid gap-px rounded-t-card bg-line sm:grid-cols-2 lg:grid-cols-3 " +
          // THE FIRST ROW IS THE TABLE'S HEAD, WHICHEVER CELLS LAND IN
          // IT — «الجدول غير متناسق: العنوان الوطني اجعله بنفس تصميم
          // الجدول، العنوان داكن».
          //
          // It used to be three NAMED fields, chosen when a supplier's
          // record was the only one drawn. A buyer has no VAT number,
          // so a different field rose into the third column and came
          // out light beside two dark ones.
          //
          // WHICH CELLS THOSE ARE IS A BREAKPOINT'S ANSWER, not a
          // component's: one column at base, two from `sm`, three from
          // `lg`. So it is asked in CSS, where the breakpoint is, and
          // each larger width only ever ADDS to the row.
          "[&>*:nth-child(-n+1)>span:first-of-type]:bg-primary [&>*:nth-child(-n+1)>span:first-of-type]:text-primary-foreground " +
          "sm:[&>*:nth-child(-n+2)>span:first-of-type]:bg-primary sm:[&>*:nth-child(-n+2)>span:first-of-type]:text-primary-foreground " +
          "lg:[&>*:nth-child(-n+3)>span:first-of-type]:bg-primary lg:[&>*:nth-child(-n+3)>span:first-of-type]:text-primary-foreground " +
          // AND THE CARD'S TOP CORNERS BELONG TO WHOEVER IS STANDING IN
          // THEM. The grid's own line-coloured ground used to show as a
          // wedge outside the dark cell's rounded corner — «حواف
          // الجدولين من الأعلى فيه تشوّه». The container is rounded now
          // and so are the two cells that reach those corners.
          "[&>*:first-child]:rounded-ss-card [&>*:first-child>span:first-of-type]:rounded-ss-card " +
          "max-sm:[&>*:nth-child(1)]:rounded-se-card max-sm:[&>*:nth-child(1)>span:first-of-type]:rounded-se-card " +
          "sm:max-lg:[&>*:nth-child(2)]:rounded-se-card sm:max-lg:[&>*:nth-child(2)>span:first-of-type]:rounded-se-card " +
          "lg:[&>*:nth-child(3)]:rounded-se-card lg:[&>*:nth-child(3)>span:first-of-type]:rounded-se-card"
        }
      >
        {/* ---------------------------- row one ---------------------- */}


        {/* THE ONE ADDRESS THE PLATFORM CAN REACH THIS COMPANY ON, and
            now editable. It used to be shown and nothing else, so an
            account registered with a typo had no way to correct it
            short of an administrator. Changing it makes it UNVERIFIED
            again — proving control of one mailbox says nothing about
            another — and the card says so beside the field. */}
        <Cell
          icon={IconEmail}
          label={labels.email}
          required
          requiredLabel={labels.required}
          editing={editing}
          error={editing && emailBad ? labels.emailInvalid : undefined}
        >
          {editing ? (
            <>
              <Input
                type="email"
                dir="ltr"
                autoComplete="email"
                spellCheck={false}
                value={form.email}
                onChange={(e) =>
                  setForm((p) => ({ ...p, email: e.target.value }))
                }
                aria-invalid={emailBad || undefined}
                data-testid="record-email"
              />
              {form.email.trim().toLowerCase() !==
              email.trim().toLowerCase() ? (
                <p
                  className="text-xs text-content-muted"
                  data-testid="record-email-reverify"
                >
                  {labels.emailReverify}
                </p>
              ) : null}
            </>
          ) : (
            <ReadOnly value={email} ltr testId="record-email" />
          )}
        </Cell>

        <Cell
          icon={IconAddress}
          label={labels.shortAddress}
          required
          requiredLabel={labels.required}
          editing={editing}
        >
          {editing ? (
            <Input
              value={mainBranch.shortAddress}
              onChange={(e) => setMain({ shortAddress: e.target.value })}
              placeholder="RRRD2929"
              data-testid="record-short-address"
            />
          ) : (
            <ReadOnly
              value={mainBranch.shortAddress}
              empty={labels.notEntered}
              testId="record-short-address"
            />
          )}
        </Cell>

        {/* THE VAT NUMBER IS REQUIRED AND IT IS TYPED. There is no
            «مسجّلة / غير مسجّلة» question: the owner's rule is that a
            supplier on this platform has a registration. The API still
            accepts «not registered», so older records keep reading back
            correctly. */}
        {isSupplier ? (
          <Cell
            icon={IconVat}
            label={labels.vatNumber}
            required
            requiredLabel={labels.required}
          editing={editing}
            reverifies
            reverifiesLabel={labels.reverifies}
            error={editing && vatBad ? labels.vatNumberInvalid : undefined}
          >
            {editing ? (
              <>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={15}
                  value={form.vatNumber}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, vatNumber: e.target.value }))
                  }
                  placeholder="300000000000003"
                  aria-invalid={vatBad || undefined}
                  data-testid="record-vat-number"
                />
                <p className="text-xs text-content-muted">
                  {labels.vatNumberHint}
                </p>
              </>
            ) : (
              <ReadOnly
                value={
                  form.vatNumber !== ""
                    ? form.vatNumber
                    : billing?.isVatRegistered === false
                      ? labels.vatNotRegistered
                      : ""
                }
                empty={labels.notEntered}
                ltr={form.vatNumber !== ""}
                testId="record-vat-number"
              />
            )}
          </Cell>
        ) : null}

        {/* ---------------------------- row two ---------------------- */}

        {/* THE POSITION, ON ITS OWN, with the button that sets it. */}
        <Cell
          icon={IconPlace}
          label={labels.position}
          required
          requiredLabel={labels.required}
          editing={editing}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            {mainPosition ? (
              <bdi
                className="truncate font-mono text-xs text-content"
                data-testid="record-position"
              >
                {mainPosition.latitude.toFixed(6)},{" "}
                {mainPosition.longitude.toFixed(6)}
              </bdi>
            ) : (
              <span
                className="text-sm text-content-muted"
                data-testid="record-position-empty"
              >
                {labels.positionEmpty}
              </span>
            )}

            {editing ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPickingAt(0)}
                data-testid="record-pick-location"
              >
                <MapPin className="size-4" aria-hidden />
                {mainPosition ? labels.changePosition : labels.addPosition}
              </Button>
            ) : null}
          </div>
        </Cell>

        <Cell
          icon={IconRegion}
          label={labels.region}
          required
          requiredLabel={labels.required}
          editing={editing}
          reverifies
          reverifiesLabel={labels.reverifies}
        >
          {editing ? (
            <SearchableSelect
              value={mainBranch.regionId}
              // A city under the OLD region is not a narrowing of the
              // new one, it is a contradiction — so it clears.
              onChange={(value) => setMain({ regionId: value, cityId: "" })}
              options={regions}
              placeholder={labels.regionPlaceholder}
              searchLabel={labels.region}
              emptyLabel={labels.regionNoMatch}
              testId="record-region"
            />
          ) : (
            <ReadOnly
              value={
                mainBranch.regionId ? nameOf(regions, mainBranch.regionId) : ""
              }
              empty={labels.notEntered}
              testId="record-region"
            />
          )}
        </Cell>

        {/* OPTIONAL, AND SAID SO IN THE PLACEHOLDER rather than in
            prose. It never appears among the reasons a save is
            refused, and it is not counted towards completion. */}
        <Cell icon={IconCity} label={labels.city}>
          {editing ? (
            mainBranch.regionId !== "" ? (
              <SearchableSelect
                value={mainBranch.cityId}
                onChange={(value) => setMain({ cityId: value })}
                options={citiesIn(mainBranch.regionId)}
                placeholder={labels.cityOptionalPlaceholder}
                searchLabel={labels.city}
                emptyLabel={labels.cityNoMatch}
                testId="record-city"
              />
            ) : (
              <p
                className="text-sm text-content-muted"
                data-testid="record-city-needs-region"
              >
                {labels.cityNeedsRegion}
              </p>
            )
          ) : (
            <ReadOnly
              value={mainBranch.cityId ? nameOf(cities, mainBranch.cityId) : ""}
              empty={labels.notEntered}
              testId="record-city"
            />
          )}
        </Cell>

        {/* THE BUYER'S CONTACT IS A CELL, beside the city — «انقل جهة
            اتصال إضافية تحته تكون موازية للمدينة». It fills the slot a
            buyer's record leaves empty there; the supplier's does not
            exist, because its bank row needs the whole of the row it
            would take. */}
        {isSupplier ? null : (
          <Cell icon={IconPhone} label={labels.contactsTitle}>
            <div className="flex min-w-0 flex-col gap-2">
              {contactRowsMarkup}
              {editing ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setContactRows((rows) => [...rows, { id: null, name: "", phone: "" }])
                    }
                    data-testid="record-add-contact"
                  >
                    <Plus className="size-4" aria-hidden />
                    {labels.addContact}
                  </Button>
                </div>
              ) : null}
            </div>
          </Cell>
        )}

        {/* --------------------------- row three --------------------- */}
        {isSupplier ? (
          <>
            <Cell
              icon={IconPerson}
              label={labels.accountHolder}
              required={bank === null}
              requiredLabel={labels.required}
          editing={editing}
              reverifies
              reverifiesLabel={labels.reverifies}
            >
              {editing ? (
                <Input
                  value={form.accountHolderName}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      accountHolderName: e.target.value,
                    }))
                  }
                  placeholder={labels.accountHolderPlaceholder}
                  data-testid="record-account-holder"
                />
              ) : (
                <ReadOnly
                  value={bank?.accountHolderName ?? ""}
                  empty={labels.notEntered}
                  testId="record-account-holder"
                />
              )}
            </Cell>

            <Cell
              icon={IconIban}
              label={labels.iban}
              required={bank === null}
              requiredLabel={labels.required}
          editing={editing}
              reverifies
              reverifiesLabel={labels.reverifies}
              error={
                editing && read.state === "invalid"
                  ? labels.ibanInvalid
                  : undefined
              }
            >
              {editing ? (
                <>
                  <Input
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={29}
                    placeholder="SA00 0000 0000 0000 0000 0000"
                    value={form.iban}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, iban: e.target.value }))
                    }
                    aria-invalid={read.state === "invalid" || undefined}
                    data-testid="record-iban"
                  />
                  {bank ? (
                    <p className="text-xs text-content-muted">
                      {labels.ibanOnFile}{" "}
                      <bdi className="font-mono">{bank.ibanLast4}</bdi>
                    </p>
                  ) : null}
                </>
              ) : (
                <ReadOnly
                  value={bank ? `${labels.endingIn} ${bank.ibanLast4}` : ""}
                  empty={labels.notEntered}
                  testId="record-iban"
                />
              )}
            </Cell>

            {/* THE BANK, READ OUT OF THE NUMBER — never chosen. */}
            <Cell icon={IconBank} label={labels.bankName}>
              <div
                className="flex flex-wrap items-center justify-between gap-2"
                data-testid="record-bank"
              >
                {editing ? (
                  derivedBank ? (
                    <>
                      <span className="truncate text-sm text-content">
                        {derivedBank}
                      </span>
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-success)_14%,var(--color-surface))] px-2 py-0.5 text-xs text-success"
                        data-testid="record-bank-auto"
                      >
                        <BadgeCheck className="size-3.5" aria-hidden />
                        {labels.bankAutoDetected}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-content-muted">
                      {read.state === "valid"
                        ? labels.bankNotIdentified
                        : labels.bankPending}
                    </span>
                  )
                ) : (
                  <ReadOnly
                    value={bank?.bankName ?? ""}
                    empty={labels.notEntered}
                    testId="record-bank-name"
                  />
                )}
              </div>
            </Cell>

        {/* THE REGISTRATION NUMBER, IN THE TABLE — «نزّل رقم السجل
            التجاري الجدول في البطاقة اللي تحت عشان يعطي مجال للاسم،
            لأن الاسم يظهر نصفه فقط».

            IT WAS IN THE STRIP, at the far end of a single line that
            also had to hold the company's name: its label, its digits
            and its lock came to about a hundred and seventy pixels of a
            phone's width, and the name — which is what the strip is for
            — was truncated to half of itself.

            IT IS NOT EDITABLE HERE EITHER. The number is verified at
            registration and locked; the field shows it and the lock
            beside it says why there is nothing to press.
*/}
        <Cell icon={IconInvoice} label={labels.crNumber} editing={editing}>
          <span className="flex items-center gap-2">
            <ReadOnly value={company.crNumber} ltr testId="record-cr-number" />
            <Lock className="size-3.5 shrink-0 text-content-muted" aria-hidden />
            <span className="sr-only">{labels.lockedNotice}</span>
          </span>
        </Cell>
          </>
        ) : null}
      </div>


      {/* THE MAP FOR THE MAIN BRANCH, opened from the button above and
          shown across the whole card rather than squeezed into a
          third of a row. */}
      {editing && pickingAt === 0 ? (
        <div className="border-t border-line px-card-x py-card-y">
          <LocationPicker
            initial={mainPosition}
            labels={labels.picker}
            onConfirm={(next) => {
              setMain({ moved: next });
              setPickingAt(null);
            }}
            onCancel={() => setPickingAt(null)}
          />
        </div>
      ) : null}


      {/* ------------------- the contacts and the branches, side by side.
          «جهات الاتصال اجعلها بطاقة موازية لبطاقة الفروع» — and putting
          the contact back here is what puts the BANK ROW back on one
          line: it was a cell in the table for a revision, and a tenth
          cell in a grid three across pushed the account holder, the
          IBAN and the bank name apart. «رجّع صف الحساب البنكي موازي
          لبعض.» */}
      <div
        className={
          "grid gap-6 border-t border-line px-card-x py-card-y " +
          (isSupplier ? "lg:grid-cols-2" : "")
        }
      >
        {/* ---------------------------------------------- contacts */}
        {isSupplier ? (
          <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-content">
              <span aria-hidden>{IconPhone}</span>
              {labels.contactsTitle}
            </h3>
            {editing ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setContactRows((rows) => [
                    ...rows,
                    { id: null, name: "", phone: "" },
                  ])
                }
                data-testid="record-add-contact"
              >
                <Plus className="size-4" aria-hidden />
                {labels.addContact}
              </Button>
            ) : null}
          </div>

              {contactRowsMarkup}
          </div>
        ) : null}

        {/* ---------------------------------------------- branches */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-content">
              <span aria-hidden>{IconBranches}</span>
              {labels.extraBranchesTitle}
            </h3>
            {editing ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setBranchRows((rows) => [...rows, emptyBranch()])}
                data-testid="record-add-branch"
              >
                <Plus className="size-4" aria-hidden />
                {labels.addBranch}
              </Button>
            ) : null}
          </div>

          {/* THE MAIN BRANCH IS NOT IN THIS LIST. It is the
              establishment's own address, which the grid above holds,
              and «إضافة فرع» exists for the OPTIONAL branches after
              it. Listing it twice would offer two places to change one
              address. */}
          {branchRows.length <= 1 ? (
            <p
              className="text-sm text-content-muted"
              data-testid="record-branches-empty"
            >
              {labels.extraBranchesEmpty}
            </p>
          ) : null}

          <ul className="flex list-none flex-col gap-3">
            {branchRows.map((row, index) => index === 0 ? null : (
              <li
                key={row.id ?? `new-${index}`}
                className="flex min-w-0 flex-col gap-2"
                data-testid={`record-branch-${index}`}
              >
                {editing ? (
                  <div className="flex flex-col gap-2 rounded-md border border-line p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="min-w-0 flex-1"
                        value={row.name}
                        placeholder={labels.branchName}
                        onChange={(e) =>
                          setBranchRows((rows) =>
                            rows.map((r, i) =>
                              i === index ? { ...r, name: e.target.value } : r,
                            ),
                          )
                        }
                        data-testid={`record-branch-name-${index}`}
                      />
                      {index > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={labels.removeBranch}
                          onClick={() =>
                            setBranchRows((rows) =>
                              rows.filter((_, i) => i !== index),
                            )
                          }
                          data-testid={`record-remove-branch-${index}`}
                        >
                          <Trash2 className="size-4 text-danger" aria-hidden />
                        </Button>
                      ) : null}
                    </div>

                    {/* THE MAIN BRANCH'S PLACE IS ON THE GRID ABOVE —
                        it IS the establishment's address, and one value
                        with two editable copies is how two of them come
                        to disagree. Additional branches answer here. */}
                    {index > 0 ? (
                    <>
                    <SearchableSelect
                      value={row.regionId}
                      onChange={(value) =>
                        setBranchRows((rows) =>
                          rows.map((r, i) =>
                            // A city under the OLD region is not a
                            // narrowing of the new one, it is a
                            // contradiction — so it is cleared.
                            i === index
                              ? { ...r, regionId: value, cityId: "" }
                              : r,
                          ),
                        )
                      }
                      options={regions}
                      placeholder={labels.regionPlaceholder}
                      searchLabel={labels.region}
                      emptyLabel={labels.regionNoMatch}
                      testId={`record-branch-region-${index}`}
                    />

                    {row.regionId !== "" ? (
                      <SearchableSelect
                        value={row.cityId}
                        onChange={(value) =>
                          setBranchRows((rows) =>
                            rows.map((r, i) =>
                              i === index ? { ...r, cityId: value } : r,
                            ),
                          )
                        }
                        options={citiesIn(row.regionId)}
                        placeholder={labels.cityPlaceholder}
                        searchLabel={labels.city}
                        emptyLabel={labels.cityNoMatch}
                        testId={`record-branch-city-${index}`}
                      />
                    ) : null}
                    </>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {index > 0 ? (
                      <Input
                        className="min-w-0 flex-1"
                        value={row.shortAddress}
                        placeholder={labels.shortAddress}
                        onChange={(e) =>
                          setBranchRows((rows) =>
                            rows.map((r, i) =>
                              i === index
                                ? { ...r, shortAddress: e.target.value }
                                : r,
                            ),
                          )
                        }
                        data-testid={`record-branch-address-${index}`}
                      />
                      ) : null}
                      <Input
                        className="min-w-0 flex-1"
                        value={row.contactName}
                        placeholder={labels.branchContactName}
                        onChange={(e) =>
                          setBranchRows((rows) =>
                            rows.map((r, i) =>
                              i === index
                                ? { ...r, contactName: e.target.value }
                                : r,
                            ),
                          )
                        }
                        data-testid={`record-branch-contact-${index}`}
                      />
                      <Input
                        className="min-w-0 flex-1"
                        dir="ltr"
                        value={row.contactPhone}
                        placeholder="05xxxxxxxx"
                        onChange={(e) =>
                          setBranchRows((rows) =>
                            rows.map((r, i) =>
                              i === index
                                ? { ...r, contactPhone: e.target.value }
                                : r,
                            ),
                          )
                        }
                        data-testid={`record-branch-phone-${index}`}
                      />
                    </div>

                    {pickingAt === index ? (
                      <div className="rounded-md border border-line bg-background p-2">
                        <LocationPicker
                          initial={row.moved ?? row.at}
                          labels={labels.picker}
                          onConfirm={(position) => {
                            setBranchRows((rows) =>
                              rows.map((r, i) =>
                                i === index ? { ...r, moved: position } : r,
                              ),
                            );
                            setPickingAt(null);
                          }}
                          onCancel={() => setPickingAt(null)}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-content-muted">
                          <MapPin className="size-3.5 shrink-0" aria-hidden />
                          {row.moved ?? row.at ? (
                            <bdi
                              className="truncate font-mono"
                              data-testid={`record-branch-position-${index}`}
                            >
                              {(row.moved ?? row.at)!.latitude.toFixed(6)},{" "}
                              {(row.moved ?? row.at)!.longitude.toFixed(6)}
                            </bdi>
                          ) : (
                            <span
                              data-testid={`record-branch-position-empty-${index}`}
                            >
                              {labels.positionEmpty}
                            </span>
                          )}
                        </span>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setPickingAt(index)}
                          data-testid={`record-pick-location-${index}`}
                        >
                          <MapPin className="size-4" aria-hidden />
                          {row.moved ?? row.at
                            ? labels.changePosition
                            : labels.pickPosition}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface px-card-x py-card-y">
                    {/* THE NAME LEADS, AND THE STATE SITS BESIDE IT. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-flex text-secondary"
                      >
                        {IconPlace}
                      </span>
                      <span className="min-w-0 truncate text-base font-semibold text-content">
                        {row.name}
                      </span>
                      {index === 0 ? (
                        <span className="rounded-full bg-[color-mix(in_srgb,var(--color-primary)_10%,var(--color-surface))] px-2 py-0.5 text-xs text-primary">
                          {labels.mainBranch}
                        </span>
                      ) : null}
                    </div>

                    {/* AND EVERYTHING ELSE IS LABELLED, in one band across
                        the card's whole measure — «فيها فراغ كبير».
                        Built as a LIST first so a branch with no city
                        leaves no hole in the grid. */}
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-3 lg:grid-cols-5">
                      {[
                        { label: labels.region, value: nameOf(regions, row.regionId) },
                        ...(row.cityId
                          ? [{ label: labels.city, value: nameOf(cities, row.cityId) }]
                          : []),
                        { label: labels.shortAddress, value: row.shortAddress },
                        { label: labels.branchContactName, value: row.contactName },
                        { label: labels.contactsTitle, value: row.contactPhone },
                      ]
                        .filter((fact) => fact.value)
                        .map((fact) => (
                          <BranchFact key={fact.label} label={fact.label} value={fact.value} />
                        ))}
                    </dl>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* --------------------------------------------------- the foot */}
      {failure ? (
        <div
          role="alert"
          className="border-t border-danger px-card-x py-3"
          data-testid="record-error"
        >
          <p className="text-sm text-content">{root(failure.messageKey)}</p>

          {/*
            WHICH FIELDS THE SERVER REFUSED, by name.

            A refusal used to be a sentence and a reference number, and
            nothing else — the person who typed the form was told
            something was wrong and left to find it among a dozen
            fields. The server DID say which; the portal threw it away.

            NOTHING THE SERVER WROTE IS SHOWN. `invalidFields` carries
            only names that matched a closed list, and what is printed
            is this card's OWN label for each — the same string that
            sits over the field itself.
          */}
          {failure.invalidFields.length > 0 ? (
            <ul
              className="mt-2 flex list-disc flex-col gap-0.5 ps-5 text-sm text-content"
              data-testid="record-error-fields"
            >
              {failure.invalidFields.map((field) => (
                <li key={field}>{labels.fieldNames[field] ?? field}</li>
              ))}
            </ul>
          ) : null}

          {failure.requestId ? (
            <p className="mt-1 text-xs text-content-muted">
              {labels.requestIdLabel}{" "}
              <span className="select-all font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-card border-t border-line bg-background px-card-x py-card-y">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-content hover:underline"
          data-testid="record-back"
        >
          <BackChevron className="size-4" aria-hidden />
          {labels.back}
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          {/* WHY THE SAVE IS REFUSED, in the place somebody looks
              when it is: right beside the button. The button stays
              disabled — what was missing was the reason, not the
              refusal. */}
          {editing && blockers.length > 0 ? (
            <div
              className="flex max-w-md flex-col gap-1 text-xs text-content-muted"
              data-testid="record-blockers"
            >
              <span className="inline-flex items-start gap-1.5">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="font-medium">{labels.blockedTitle}</span>
              </span>
              <ul className="flex list-disc flex-col gap-0.5 ps-6">
                {blockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="inline-flex max-w-md items-start gap-1.5 text-xs text-content-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{editing ? labels.editNote : labels.reviewNote}</span>
            </p>
          )}

          {editing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  reset();
                  setEditing(false);
                }}
                data-testid="record-cancel"
              >
                {labels.cancel}
              </Button>
              <Button
                type="button"
                onClick={save}
                disabled={!savable}
                data-testid="record-save"
              >
                {saving ? labels.working : labels.saveChanges}
              </Button>
            </>
          ) : (
            <>
              {/* ONE EDIT BUTTON for the whole record — the reference
                  draws one, and five was the fault it replaced. It is
                  withheld only while an administrator has the record
                  open, when every path behind it refuses. */}
              {!locked ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={beginEditing}
                  data-testid="record-edit"
                >
                  <Pencil className="size-4" aria-hidden />
                  {labels.edit}
                </Button>
              ) : null}

              {canSubmit ? (
                <Button
                  type="button"
                  onClick={submitForReview}
                  disabled={submitting}
                  data-testid="record-submit"
                >
                  <ShieldCheck className="size-4" aria-hidden />
                  {submitting ? labels.working : labels.submit}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- pieces */

/** One labelled cell of the grid — the same shape read or edited. */
/**
 * One labelled cell of the grid — the same shape read or edited.
 *
 * THE ASTERISK IS A FORM MARK, so it belongs to a form. Reading a
 * finished record back with red stars beside half its values says
 * something is wanted; nothing is. It appears while the card is being
 * filled in or edited and at no other time — and it marks the SAME
 * fields it always did, because nothing about what is required
 * changed.
 *
 * THE LABEL CARRIES THE WEIGHT of «أرقام التواصل» and «فروع إضافية»
 * above it: they are all names of things on one card, and a lighter
 * label read as a caption beside them.
 */
/**
 * ONE FACT OF A BRANCH, ON ITS OWN COLUMN.
 *
 * «رتّب بطاقة الفرع، كذا جايه كأنها ملخبطة وفيها فراغ كبير — بجدول أو
 * أي شيء مناسب.»
 *
 * The branch used to be three lines of running text with the region,
 * the city, the address, a name and a number strung together by middle
 * dots: nothing was labelled, so a reader had to know the ORDER to read
 * it, and the whole thing hugged one side of a card the width of the
 * page. These sit in one band that divides that width evenly — the
 * label small and quiet, the value carrying the weight, and no dead
 * middle at any breakpoint.
 */
function BranchFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] font-medium leading-tight text-content-muted">{label}</dt>
      <dd className="truncate text-sm font-medium text-content">{value}</dd>
    </div>
  );
}

function Cell({
  icon,
  label,
  required,
  requiredLabel,
  editing,
  error,
  reverifies,
  reverifiesLabel,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  required?: boolean;
  requiredLabel?: string;
  /** The asterisk is drawn only while the card is a form. */
  editing?: boolean;
  error?: string;
  /**
   * CHANGING THIS SENDS THE RECORD BACK FOR REVIEW.
   *
   * «أفضّل (ب) لأنه يعطيه يعدّل شغلات ما تحتاج توثيق» — so the rule
   * is not the same for every field, and where a rule is not
   * uniform it has to be VISIBLE at the field it applies to. A
   * paragraph at the top of the card explaining which five fields
   * are special is the standing explanation this platform does not
   * carry; a mark on those five is the same information, read
   * where the decision to type is made.
   *
   * DRAWN ONLY WHILE EDITING, like the required asterisk: it is a
   * warning about an action, and there is no action to warn about
   * while the card is being read.
   */
  reverifies?: boolean;
  reverifiesLabel?: string;
  children: React.ReactNode;
}) {
  return (
    // TWO BANDS, NOT A COLUMN. The label sits on a tinted strip and the
    // answer on the card's own white, so a reader sorts the two by
    // ground rather than by weight — and because every cell in a row
    // starts its strip at the same height, the strips meet and run the
    // width of the card as one band.
    //
    // THE TINT AND NOT THE FULL NAVY. Three solid bands would be the
    // highest-contrast thing in the card, and what a reader came for is
    // the figures, not their names. At seven per cent the label is a
    // boundary rather than a block, and its own text still measures
    // 12.6 to 1 on it.
    // A CELL NO LONGER KNOWS WHERE IT IS. Which cells are the table's
    // HEAD, and which two own the card's top corners, is a question
    // only the breakpoint can answer — a buyer has no VAT number, so a
    // different field rises into the third column and a cell that named
    // itself would be wrong there. The grid decides both in CSS.
    <div className="flex min-w-0 flex-col bg-surface">
      <span className="flex items-center gap-1.5 bg-[color-mix(in_srgb,var(--color-primary)_7%,var(--color-surface))] px-3 py-2 text-sm font-semibold text-content">
        <span aria-hidden>{icon}</span>
        <span className="min-w-0">
          {label}
          {required && editing ? (
            <span className="text-danger ms-1" aria-hidden>
              *
            </span>
          ) : null}
          {required && editing && requiredLabel ? (
            <span className="sr-only">{requiredLabel}</span>
          ) : null}
        </span>

        {/* THE MARK, AND ITS WHOLE SENTENCE IN THE TOOLTIP AND FOR A
            SCREEN READER. A shield rather than a second asterisk:
            the asterisk already means «required», and two marks
            meaning different things in the same strip would teach
            neither. */}
        {reverifies && editing ? (
          <span
            className="ms-auto inline-flex shrink-0 items-center gap-1 text-xs text-accent"
            title={reverifiesLabel}
            data-testid="cell-reverifies"
          >
            <ShieldAlert className="size-3.5" aria-hidden />
            <span className="sr-only">{reverifiesLabel}</span>
          </span>
        ) : null}
      </span>
      {/* THE ANSWER, AND ROOM FOR IT WHETHER IT IS READ OR TYPED. The
          same padding serves a line of text and a field, so the card
          does not resize when it turns into a form. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5">
        {children}
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A value being read back.
 *
 * AN UNANSWERED FIELD SAYS SO. Rendering an empty string leaves a
 * label over nothing, which reads as a broken page rather than as a
 * question nobody has answered yet.
 */
function ReadOnly({
  value,
  empty,
  ltr,
  testId,
}: {
  value: string;
  empty?: string;
  ltr?: boolean;
  testId: string;
}) {
  const shown = value.trim();
  if (shown === "") {
    return (
      <span className="text-sm text-content-muted" data-testid={testId}>
        {empty ?? "—"}
      </span>
    );
  }
  return (
    <span className="truncate text-sm text-content" data-testid={testId}>
      {ltr ? <bdi className="font-mono">{shown}</bdi> : shown}
    </span>
  );
}
