import {
  Building,
  CreditCard,
  FileText,
  Hash,
  Landmark,
  Mail,
  Mailbox,
  Map,
  MapPin,
  Network,
  Phone,
  User,
} from "lucide-react";

/**
 * THE SMALL MARKS BESIDE EVERY LABEL on «استكمال بيانات المنشأة»,
 * drawn from the approved reference.
 *
 * WHY THEY ARE HERE AND NOT IN EACH CARD. The reference gives one
 * screen, and the fields on it are spread across five components that
 * a company reads as a single form. Picking an icon at each call site
 * is how the same field ends up wearing a different mark on two cards,
 * and how one of them ends up with a colour that is not in the palette.
 *
 * THEY MEAN NOTHING. Each one repeats the label beside it, every use
 * is `aria-hidden`, and no field's meaning, state or validity is
 * carried by one — a mark that only sighted readers can see must never
 * be the only place something is said.
 *
 * THE COLOURS ARE TOKENS, never hex. The reference draws each mark in
 * its own colour; taking those from the identity tokens means a tenant
 * that re-themes the platform gets a form that follows, rather than a
 * page still wearing the first brand's blue.
 *
 * NO OPACITY MODIFIER ANYWHERE HERE. `text-primary/70` on a token that
 * resolves to a plain hex builds nothing and Tailwind drops the whole
 * declaration — the fault that has already cost this repository four
 * invisible elements. Full-strength tokens only.
 */

const SIZE = "size-4 shrink-0";

/** A document the company's name goes on. */
export const IconInvoice = <FileText className={`${SIZE} text-accent`} />;
/**
 * The VAT REGISTRATION NUMBER.
 *
 * NOT A PERCENT SIGN. «عدّل أيقونة الرقم الضريبي، جايه نسبة مئوية» —
 * the field holds a fifteen-digit registration, and a % beside it says
 * "a rate", which is a different fact about tax and one this form
 * never asks for.
 */
export const IconVat = <Hash className={`${SIZE} text-secondary`} />;

/**
 * A POINT ON THE MAP, and nothing else.
 *
 * FOUR FIELDS USED TO WEAR THIS ONE PIN — the short national address,
 * the branch's position, the region and the city: «أيقونات العنوان
 * الوطني المختصر وموقع الخريطة والمنطقة والمدينة متشابهة». A mark
 * repeated four times in one card stops marking anything; it is only
 * worth its space when it says which field this is at a glance.
 */
export const IconPlace = <MapPin className={`${SIZE} text-accent`} />;
/** The short national address — a POSTAL code, not a position. */
export const IconAddress = <Mailbox className={`${SIZE} text-primary`} />;
/** The region: a stretch of the map rather than a point on it. */
export const IconRegion = <Map className={`${SIZE} text-secondary`} />;
/** The city — the place people live in, not the coordinates of one. */
export const IconCity = <Building className={`${SIZE} text-accent`} />;
/** How to reach somebody in writing. */
export const IconEmail = <Mail className={`${SIZE} text-primary`} />;
/** How to reach somebody by voice. */
export const IconPhone = <Phone className={`${SIZE} text-secondary`} />;
/** The account number money is sent to. */
export const IconIban = <CreditCard className={`${SIZE} text-primary`} />;
/** The bank the number names. */
export const IconBank = <Landmark className={`${SIZE} text-secondary`} />;
/** A named person. */
export const IconPerson = <User className={`${SIZE} text-primary`} />;
/** The branches, as a set. */
export const IconBranches = <Network className={`${SIZE} text-secondary`} />;
