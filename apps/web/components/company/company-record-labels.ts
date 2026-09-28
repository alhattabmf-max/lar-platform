import type { NameableInvalidField } from "@platform/types";
import type { LocationPickerLabels } from "./location-picker";

/**
 * Every string the one company card renders, RESOLVED on the server.
 *
 * A DICTIONARY, NOT A TRANSLATOR. The card is a Client Component and
 * its props cross the server boundary, where React serialises them —
 * and refuses a function. Passing `t` is the fault that took three
 * admin screens down; passing finished strings costs nothing and
 * cannot.
 */
export interface CompanyRecordLabels {
  /* ---------------------------------------------- the identity band */
  crNumber: string;
  statusInProgress: string;
  /** The company is approved — the server's word, never a count. */
  statusVerified: string;
  /** A request is open. Never shown for one unsent or refused. */
  statusUnderReview: string;
  /** Announced for the lock, which is otherwise only a picture. */
  lockedNotice: string;

  /* ------------------------------------------------- the field grid */
  /**
   * «اسم المنشأة» — over the name in the band, mirroring the label over
   * the registration number opposite it. Its OWN string rather than
   * «الاسم النظامي للمنشأة»: the two sit side by side on one row, and a
   * long label beside a short one reads as two different kinds of
   * thing.
   */
  legalName: string;
  email: string;
  /** The shape is refused beside the field before a round trip. */
  emailInvalid: string;
  /** A changed address is unverified again, and this says so. */
  emailReverify: string;
  vatNumber: string;
  vatNumberHint: string;
  /** How an older record that answered «not registered» reads back. */
  vatNotRegistered: string;
  vatNumberInvalid: string;
  iban: string;
  ibanInvalid: string;
  /** «الحساب المسجّل ينتهي بـ …» beside the field, while editing. */
  ibanOnFile: string;
  endingIn: string;
  bankName: string;
  bankAutoDetected: string;
  bankPending: string;
  bankNotIdentified: string;
  accountHolder: string;
  accountHolderPlaceholder: string;
  /** Stands in for a field nobody has answered yet. */
  notEntered: string;
  required: string;
  /**
   * The sentence behind the mark on the five fields the approval
   * rests on — «تعديله يتطلّب إعادة توثيق».
   *
   * It is a TOOLTIP and a screen-reader label, never a line of prose
   * on the card: the rule belongs at the field it governs, and a
   * paragraph naming five fields at the top is the standing
   * explanation this platform does not carry.
   */
  reverifies: string;

  /* --------------------------------------------- contacts, branches */
  contactsTitle: string;
  contactsEmpty: string;
  addContact: string;
  removeContact: string;
  contactName: string;

  /** «الفروع الإضافية» — the main branch is the grid above. */
  extraBranchesTitle: string;
  extraBranchesEmpty: string;
  branchesTitle: string;
  branchesEmpty: string;
  addBranch: string;
  removeBranch: string;
  branchName: string;
  branchContactName: string;
  mainBranch: string;
  region: string;
  regionPlaceholder: string;
  regionNoMatch: string;
  city: string;
  cityPlaceholder: string;
  cityNoMatch: string;
  /** The city list cannot be offered before a region narrows it. */
  cityNeedsRegion: string;
  shortAddress: string;
  /** «موقع المنشأة» — its own cell now, with the button beside it. */
  position: string;
  positionEmpty: string;
  /** «إضافة الموقع» — before there is one. */
  addPosition: string;
  pickPosition: string;
  changePosition: string;
  /** The one label over the region-and-city pair. */
  regionAndCity: string;
  /** Says the city is optional, in the placeholder rather than in prose. */
  cityOptionalPlaceholder: string;
  picker: LocationPickerLabels;

  /* -------------------------------------------------------- the foot */
  back: string;
  edit: string;
  saveChanges: string;
  cancel: string;
  submit: string;
  working: string;
  /** The caution shown while READING: review before sending. */
  reviewNote: string;
  /** The caution shown while EDITING: one press saves everything. */
  editNote: string;
  requestIdLabel: string;
  /**
   * A NAME PER FIELD the server may refuse, so a refusal can say WHICH
   * rather than only THAT. Keyed by the closed vocabulary in
   * `@platform/types`; nothing the server wrote is ever rendered.
   */
  fieldNames: Partial<Record<NameableInvalidField, string>>;

  /* ---------------------------------------------------------------
     WHY A SAVE IS REFUSED — one line each, listed under the button.
     A disabled control that says nothing is the fault these fix.
     --------------------------------------------------------------- */
  blockEmailMissing: string;
  blockEmailInvalid: string;
  blockVatMissing: string;
  blockVatInvalid: string;
  blockIbanInvalid: string;
  /** The IBAN and its holder are a pair — half an account is refused. */
  blockAccountHolder: string;
  blockIbanMissing: string;
  blockAddress: string;
  blockRegion: string;
  blockPosition: string;
  blockExtraBranch: string;
  blockContact: string;
  /** The heading over that list. */
  blockedTitle: string;
}
