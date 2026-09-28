import { getTranslations } from "next-intl/server";
import type { AccountType, CompanyRequirement } from "@platform/types";
import { requirementsFor, SUPPLIER_VERIFICATION_STATES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { getSession } from "@/lib/session";
import { formatDate } from "@/lib/localized";
import { loadCities, loadRegions } from "@/lib/marketplace-data";
import {
  loadSupplierInvoicingProfile,
  loadSupplierTaxProfile,
} from "@/lib/supplier-data";
import {
  loadCompanyBankAccounts,
  loadCompanyBranches,
  loadCompanyContacts,
  loadVerificationView,
} from "@/lib/company-profile-data";
import { ErrorState } from "@/components/ui/states";
import { Building2 } from "lucide-react";
import { VerificationRequestCard } from "./verification-request-card";
import { CompanyRecordCard } from "./company-record-card";

/**
 * «استكمال بيانات المنشأة» — ONE PAGE, ONE CARD.
 *
 * WHAT THIS REPLACED. The record used to be a stack of five cards —
 * details, branches, contacts, bank, billing — each with its own
 * «تعديل» and its own save. It ran to three screens, and recording one
 * set of facts about one company meant finding and pressing five
 * different buttons. The approved reference draws a single card with a
 * single edit control, and it is right.
 *
 * ONE SECTION FOR BOTH PORTALS. A buyer and a supplier keep the same
 * record at the same endpoints; a supplier is additionally asked for
 * the account it will be paid into and who its documents name, and
 * that difference comes from `requirementsFor` rather than from a
 * branch in this file.
 *
 * A SERVER COMPONENT that reads and hands DATA down. Nothing but
 * strings, arrays and plain objects crosses into the card — no
 * translator function, no formatter.
 *
 * NOTHING HERE IS GATED. An unapproved supplier reaches this section,
 * fills it in and edits it; that is the whole point of it existing
 * before approval rather than after.
 */
export async function CompanyProfileSection({
  locale,
  accountType,
}: {
  locale: AppLocale;
  accountType: AccountType;
}) {
  const session = await getSession();
  if (!session) return null;

  const t = await getTranslations({ locale, namespace: "company" });
  const states = await getTranslations({ locale, namespace: "states" });
  const common = await getTranslations({ locale, namespace: "common" });

  const isSupplier = accountType === "SUPPLIER";

  /**
   * WHETHER THIS PAGE PRINTS ITS OWN NAME.
   *
   * NEITHER PORTAL DOES ANY MORE. Both name the page in the tab above
   * it — «نكتفي باسم القسم في اللسان كعنوان للصفحة», and then «وفي
   * صفحات المشتري ألغِ التسمية المكررة مثل ما سوّينا في صفحة المورد» —
   * so «بيانات المنشأة» printed here would be the same words twice.
   *
   * ONLY ONCE THE RECORD IS VERIFIED, because before that the heading
   * is not the page's name at all: it asks the supplier to finish, and
   * that sentence appears nowhere else.
   */
  const named = false;

  const [
    branches,
    contacts,
    invoicing,
    tax,
    regions,
    cities,
    bankAccounts,
    verification,
  ] = await Promise.all([
    loadCompanyBranches(),
    loadCompanyContacts(),
    // WHO THE DOCUMENTS ARE ADDRESSED TO, and the VAT answer. Both are
    // asked for before approval, so both are read here rather than on
    // a page a supplier reaches only afterwards.
    isSupplier
      ? loadSupplierInvoicingProfile()
      : Promise.resolve({ ok: true as const, data: null }),
    isSupplier
      ? loadSupplierTaxProfile()
      : Promise.resolve({ ok: true as const, data: null }),
    // BOTH LISTS. The region is what a branch is recorded against and
    // the form requires one; the cities are the optional refinement
    // beneath whichever region is chosen.
    loadRegions(),
    loadCities(),
    // ASKED FOR ONLY WHERE IT APPLIES. A buyer has no payout account
    // and the endpoint refuses one, so calling it would be a
    // guaranteed 403 on every load of a buyer's own page.
    isSupplier
      ? loadCompanyBankAccounts()
      : Promise.resolve({ ok: true as const, data: [] }),
    // A buyer is never verified as a supplier. Asking would produce a
    // 403 on every load of a buyer's own page.
    isSupplier
      ? loadVerificationView()
      : Promise.resolve({ ok: true as const, data: null }),
  ]);

  if (
    !branches.ok ||
    !contacts.ok ||
    !regions.ok ||
    !cities.ok ||
    !bankAccounts.ok
  ) {
    const failure = [branches, contacts, regions, cities, bankAccounts].find(
      (r) => !r.ok,
    );
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={failure && !failure.ok ? failure.error.requestId : undefined}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const missing = new Set<CompanyRequirement>(session.profile.missing);
  const required = requirementsFor(accountType);
  const met = required.length - missing.size;
  const percent =
    required.length === 0 ? 0 : Math.round((met / required.length) * 100);

  /**
   * THE ACCOUNT IN FORCE — the newest row, whatever its state.
   *
   * The list is history and never hidden; what the card shows is where
   * the company stands NOW, and the API returns the rows newest first.
   */
  const bank = bankAccounts.data[0] ?? null;

  /**
   * WHETHER THIS COMPANY IS APPROVED — from the SERVER, not from a
   * count reaching 100%.
   *
   * THE FAULT THIS FIXES. An approved company was still shown
   * «استكمال بيانات المنشأة», the instructions for sending it to be
   * verified, a progress bar, and the whole verification card — all of
   * it addressed to somebody who had finished weeks ago. Completion
   * and APPROVAL are different facts: a record can be complete and
   * unsent, sent and refused, or approved and later edited. Only
   * `company.verificationStatus` says which.
   *
   * IT IS THE SAME FIELD FOR BOTH ACCOUNT TYPES. A buyer is approved
   * on the same column a supplier is, so one read answers for both.
   */
  const verified = session.company.verificationStatus === "VERIFIED";

  /**
   * «جاري التوثيق» IS ONLY EVER A REQUEST UNDER REVIEW.
   *
   * Never for a record nobody has sent, and never for one that came
   * back refused — both of those are things the company must act on,
   * and a badge saying "in progress" over either would be a lie that
   * stops them acting.
   */
  const underReview =
    verification.ok && verification.data?.state === "UNDER_REVIEW";

  const localised = <T extends { nameAr: string; nameEn: string }>(item: T) =>
    locale.startsWith("ar") ? item.nameAr : item.nameEn;
  const alternate = <T extends { nameAr: string; nameEn: string }>(item: T) =>
    locale.startsWith("ar") ? item.nameEn : item.nameAr;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ------------------------------------------------ the page head
          AFTER APPROVAL THIS IS A RECORD, NOT A TASK. The completion
          heading, the sentence about sending it for verification and
          the progress bar all address somebody who has not finished —
          so an approved company sees «بيانات المنشأة» and the card,
          and none of the three. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {named || !verified ? (
            <span
              className="grid size-11 shrink-0 place-items-center rounded-card bg-[color-mix(in_srgb,var(--color-primary)_10%,var(--color-surface))]"
              aria-hidden
            >
              <Building2 className="size-6 text-primary" />
            </span>
          ) : null}
          <span className="flex min-w-0 flex-col">
            <h1
              className={
                named || !verified
                  ? "truncate text-2xl font-semibold text-content"
                  : "sr-only"
              }
              data-testid="record-page-title"
            >
              {verified ? t("title") : t("completionTitle")}
            </h1>
            {!verified ? (
              <span
                className="truncate text-sm text-content-muted"
                data-testid="record-page-subtitle"
              >
                {t("completionSubtitle")}
              </span>
            ) : null}
          </span>
        </div>

        {/* The bar is a PICTURE of the number beside it, so it carries
            the same value rather than a second one — and it is a
            picture of PROGRESS, so an approved company is not shown
            one. */}
        {!verified ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
          <span className="text-sm text-content-muted">
            {t("completionLabel")}{" "}
            <bdi className="font-semibold">{percent}%</bdi>
          </span>
          <span
            className="block h-2 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,var(--color-surface))]"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("completionLabel")}
          >
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </span>
        </div>
        ) : null}
      </div>

      {/* WHERE THE RECORD STANDS — shown ABOVE the card only when there
          is something to say beyond "keep filling it in": an
          administrator's reason, or a request already under review.
          Somebody returning after a rejection has to read that before
          anything else. */}
      {!verified &&
      verification.ok &&
      verification.data &&
      verification.data.state !== "INCOMPLETE" &&
      verification.data.state !== "READY_TO_SUBMIT" ? (
        <VerificationRequestCard
          view={verification.data}
          missing={session.profile.missing}
          // FORMATTED HERE. A date formatter is a function, and React
          // refuses to serialise one into a Client Component.
          submittedAtLabel={
            verification.data.latestRequest
              ? (formatDate(verification.data.latestRequest.submittedAt, locale) ??
                null)
              : null
          }
          labels={{
            title: t("verification.title"),
            states: Object.fromEntries(
              SUPPLIER_VERIFICATION_STATES.map((state) => [
                state,
                t(`verification.state.${state}`),
              ]),
            ) as Record<(typeof SUPPLIER_VERIFICATION_STATES)[number], string>,
            descriptions: Object.fromEntries(
              SUPPLIER_VERIFICATION_STATES.map((state) => [
                state,
                t(`verification.description.${state}`),
              ]),
            ) as Record<(typeof SUPPLIER_VERIFICATION_STATES)[number], string>,
            submit: t("verification.submit"),
            working: common("loading"),
            missingTitle: t("verification.missingTitle"),
            requirements: Object.fromEntries(
              required.map((requirement) => [
                requirement,
                t(`completeness.requirement.${requirement}`),
              ]),
            ) as Record<CompanyRequirement, string>,
            reasonTitle: t("verification.reasonTitle"),
            submittedAt: t("verification.submittedAt"),
            lockedNotice: t("verification.locked"),
            requestIdLabel: states("requestIdLabel"),
          }}
        />
      ) : null}

      {/* --------------------------------------------------- the record */}
      <CompanyRecordCard
        company={{
          legalName: session.company.legalName,
          crNumber: session.company.crNumber,
        }}
        email={session.email}
        billing={
          isSupplier
            ? {
                invoicingLegalName: invoicing.ok
                  ? (invoicing.data?.invoicingLegalName ?? null)
                  : null,
                isVatRegistered: tax.ok
                  ? (tax.data?.isVatRegistered ?? null)
                  : null,
                vatNumber: tax.ok ? (tax.data?.vatNumber ?? null) : null,
              }
            : null
        }
        bank={
          bank
            ? {
                accountHolderName: bank.accountHolderName,
                bankName: bank.bankName,
                ibanLast4: bank.ibanLast4,
              }
            : null
        }
        branches={branches.data}
        contacts={contacts.data}
        regions={regions.data.map((region) => ({
          id: region.id,
          name: localised(region),
          alternateName: alternate(region),
        }))}
        // THE CITIES CARRY THEIR REGION'S ID, so a row can offer only
        // those beneath whichever region is chosen. The region's name
        // and the other language's name travel with them, because the
        // picker searches all three.
        cities={cities.data.map((city) => ({
          id: city.id,
          regionId: city.region.id,
          name: localised(city),
          alternateName: alternate(city),
          group: localised(city.region),
        }))}
        isSupplier={isSupplier}
        // THE SUPPLIER'S CHROME DRAWS A STRIP and the identity belongs
        // in it; the buyer's does not, and there the card keeps its own
        // band. Passed rather than sniffed, so nothing flashes.
        // THE IDENTITY GOES UP INTO THE TAB'S STRIP IN BOTH PORTALS —
        // «ألغِ الشريط الداكن اللي في اسم المنشأة ورقم السجل وحطها في
        // شريط اللسان». A dark band inside the page, four pixels under
        // an orange strip that is already the width of the sheet, was
        // two bars doing one job.
        identityInStrip
        verified={verified}
        underReview={underReview}
        met={met}
        total={required.length}
        canSubmit={
          verification.ok ? (verification.data?.canSubmit ?? false) : false
        }
        locked={
          verification.ok ? (verification.data?.dataLocked ?? false) : false
        }
        backHref={`/${locale}/${isSupplier ? "supplier" : "trader"}`}
        labels={{
          crNumber: t("details.crNumber"),
          statusInProgress: t("completionInProgress"),
          statusVerified: t("statusVerified"),
          statusUnderReview: t("statusUnderReview"),
          lockedNotice: t("details.managedByAdmin"),

          legalName: t("establishmentName"),
          email: t("details.email"),
          emailInvalid: t("emailInvalid"),
          emailReverify: t("emailReverify"),
          vatNumber: t("billing.vatNumber"),
          vatNumberHint: t("billing.vatNumberHint"),
          vatNotRegistered: t("billing.notRegistered"),
          vatNumberInvalid: t("billing.vatNumberInvalid"),
          iban: t("bank.iban"),
          ibanInvalid: t("bank.ibanInvalid"),
          ibanOnFile: t("bank.ibanOnFile"),
          endingIn: t("bank.endingIn"),
          bankName: t("bank.bankName"),
          bankAutoDetected: t("bank.bankAutoDetected"),
          bankPending: t("bank.bankPending"),
          bankNotIdentified: t("bank.bankNotIdentified"),
          accountHolder: t("bank.accountHolder"),
          accountHolderPlaceholder: t("bank.accountHolder"),
          notEntered: t("notEntered"),
          required: common("required"),
          reverifies: t("reverifies"),

          contactsTitle: t("contacts.title"),
          contactsEmpty: t("contacts.none"),
          addContact: t("contacts.add"),
          removeContact: t("contacts.remove"),
          contactName: t("contacts.name"),

          extraBranchesTitle: t("branches.extraTitle"),
          extraBranchesEmpty: t("branches.extraEmpty"),
          branchesTitle: t("branches.title"),
          branchesEmpty: t("branches.empty"),
          addBranch: t("branches.add"),
          removeBranch: t("branches.remove"),
          branchName: t("branches.name"),
          branchContactName: t("branches.contactName"),
          mainBranch: t("branches.mainBadge"),
          region: t("branches.region"),
          regionPlaceholder: t("branches.regionPlaceholder"),
          regionNoMatch: t("branches.regionNoMatch"),
          city: t("branches.city"),
          cityPlaceholder: t("branches.cityPlaceholder"),
          cityNoMatch: t("branches.cityNoMatch"),
          cityNeedsRegion: t("branches.cityNeedsRegion"),
          shortAddress: t("branches.shortAddress"),
          position: t("branches.position"),
          positionEmpty: t("branches.positionEmpty"),
          addPosition: t("branches.addPosition"),
          pickPosition: t("branches.pickPosition"),
          changePosition: t("branches.changePosition"),
          regionAndCity: t("branches.regionAndCity"),
          cityOptionalPlaceholder: t("branches.cityOptionalPlaceholder"),
          picker: {
            title: t("branches.picker.title"),
            hint: t("branches.picker.hint"),
            confirm: t("branches.picker.confirm"),
            cancel: t("branches.picker.cancel"),
            useMyLocation: t("branches.picker.useMyLocation"),
            locating: t("branches.picker.locating"),
            locateFailed: t("branches.picker.locateFailed"),
            coordinates: t("branches.picker.coordinates"),
            searchPlaceholder: t("branches.picker.searchPlaceholder"),
            search: t("branches.picker.search"),
            searchFailed: t("branches.picker.searchFailed"),
            mapUnavailable: t("branches.picker.mapUnavailable"),
            usingOpenStreetMap: t("branches.picker.usingOpenStreetMap"),
          },

          back: t("footer.back"),
          edit: t("editRecord"),
          saveChanges: t("billing.saveChanges"),
          cancel: t("cancel"),
          submit: t("verification.submit"),
          working: common("loading"),
          reviewNote: t("footer.note"),
          editNote: t("footer.editNote"),
          requestIdLabel: states("requestIdLabel"),
          /**
           * ONE NAME PER FIELD the server may refuse — the SAME strings
           * that sit over the fields themselves, so a refusal points at
           * something the reader can see rather than at a property name.
           */
          fieldNames: {
            email: t("details.email"),
            accountHolderName: t("bank.accountHolder"),
            iban: t("bank.iban"),
            bankName: t("bank.bankName"),
            invoicingLegalName: t("billing.invoicingName"),
            vatNumber: t("billing.vatNumber"),
            isVatRegistered: t("billing.vatNumber"),
            name: t("branches.name"),
            regionId: t("branches.region"),
            cityId: t("branches.city"),
            shortAddress: t("branches.shortAddress"),
            contactName: t("contacts.name"),
            contactPhone: t("contacts.phone"),
            latitude: t("branches.position"),
            longitude: t("branches.position"),
            crNumber: t("details.crNumber"),
            legalName: t("details.legalName"),
          },

          blockedTitle: t("blocked.title"),
          blockEmailMissing: t("blocked.emailMissing"),
          blockEmailInvalid: t("blocked.emailInvalid"),
          blockVatMissing: t("blocked.vatMissing"),
          blockVatInvalid: t("blocked.vatInvalid"),
          blockIbanInvalid: t("blocked.ibanInvalid"),
          blockAccountHolder: t("blocked.accountHolder"),
          blockIbanMissing: t("blocked.ibanMissing"),
          blockAddress: t("blocked.address"),
          blockRegion: t("blocked.region"),
          blockPosition: t("blocked.position"),
          blockExtraBranch: t("blocked.extraBranch"),
          blockContact: t("blocked.contact"),
        }}
      />
    </div>
  );
}
