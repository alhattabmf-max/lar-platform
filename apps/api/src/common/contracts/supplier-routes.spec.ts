import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The supplier surface, as an inventory.
 *
 * Two things this pins that nothing else does: that every supplier route is
 * guarded the same way, and that the whole API is exactly the size it is meant
 * to be. A count is a blunt instrument, but it is the one check that notices an
 * endpoint arriving without anyone deciding to add it.
 */

const SRC = join(__dirname, "..", "..");

function controllerFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith(".controller.ts") ? [full] : [];
  });
}

const FILES = controllerFiles();

const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

interface ControllerInfo {
  file: string;
  basePath: string;
  guards: string;
  methods: string[];
}

function readControllers(): ControllerInfo[] {
  return FILES.flatMap((file) => {
    const source = strip(readFileSync(file, "utf8"));
    const infos: ControllerInfo[] = [];

    // A file may hold more than one controller — `trader-reads.controller.ts`
    // holds two — so each `@Controller` is read with the guards and methods
    // that follow it, up to the next one.
    const blocks = source.split(/(?=@Controller\()/).slice(1);
    for (const block of blocks) {
      const basePath = block.match(/@Controller\("([^"]*)"\)/)?.[1] ?? "";
      const guards = block.match(/@UseGuards\(([^)]*)\)/)?.[1] ?? "";
      const methods = block.match(/@(Get|Post|Put|Patch|Delete)\(/g) ?? [];
      infos.push({ file, basePath, guards, methods });
    }
    return infos;
  });
}

const CONTROLLERS = readControllers();
const SUPPLIER = CONTROLLERS.filter((c) => c.basePath.startsWith("supplier/"));

describe("the API is exactly the size 8F leaves it", () => {
  it("has 274 endpoints", () => {
    // 215 after 8E, +18 in 8F, all additions and no deletions:
    //
    //   Admin identity and lifecycle (7)
    //     GET  admin/auth/me
    //     POST admin/auth/password/change
    //     POST admin/auth/recovery-codes/regenerate
    //     GET  admin/admin-users
    //     POST admin/admin-users/:id/disable
    //     POST admin/admin-users/:id/enable
    //     POST admin/admin-users/:id/reset-2fa
    //
    //   Reads decision E named (7)
    //     GET admin/audit-logs
    //     GET admin/companies
    //     GET admin/products
    //     GET admin/bank-accounts/history
    //     GET admin/refund-obligations
    //     GET admin/settlements
    //     GET admin/outbox/stats
    //
    //   Two vocabularies read from the data rather than hardcoded (2)
    //     GET admin/audit-logs/actions          — the audit filter
    //     GET admin/refund-obligations/providers — the refund providers
    //
    //   Supporting reads for the portal and the supplier forms (2)
    //     GET companies/me/policy-limits
    //     GET public/site-content
    //
    // 215 + 18 = 233 gross, 233 net.
    //
    // +1 since: DELETE admin/banners/:id — removing a promotional
    // banner for good, which had no endpoint at all. Deactivating was
    // the only control, and it leaves the row in place.
    //
    // +6 for the header logo, which replaced two free-text URL columns
    // with bytes this API stores and serves:
    //
    //   GET    branding/logo              the public, published image
    //   GET    admin/branding/logo        the set, with no object keys
    //   GET    admin/branding/logo/image  preview, published or not
    //   POST   admin/branding/logo        upload one language
    //   POST   admin/branding/logo/publish
    //   DELETE admin/branding/logo        the pair, together
    //
    // The LANGUAGE is a query parameter on these, not a route each, so
    // two locales cost nothing extra here.
    //
    // +9 for administrative control over one company — the screen that
    // turned a read-only directory into something an operator can act
    // on:
    //
    //   GET    admin/companies/:id
    //   GET    admin/companies/:id/deletion-eligibility
    //   PATCH  admin/companies/:id
    //   POST   admin/companies/:id/suspend
    //   POST   admin/companies/:id/reactivate
    //   DELETE admin/companies/:id
    //   POST   admin/companies/:id/users/:userId/password-reset
    //   POST   admin/companies/:id/users/:userId/revoke-sessions
    //
    // +4 for moving companies in and out as a spreadsheet:
    //
    //   GET    admin/companies/import-template
    //   GET    admin/companies/export
    //   POST   admin/companies/import          reads, writes nothing
    //   POST   admin/companies/import/:importId/commit
    //
    // The two GETs are declared BEFORE `:id` in the controller, because
    // Nest matches in declaration order and `export` would otherwise be
    // read as a company id.
    //
    // +3 for the companies redesign, all of them READS:
    //
    //   GET admin/companies/tab-counts        the two tab badges
    //   GET admin/companies/:id/users/export
    //   GET admin/companies/:id/audit/export
    //
    // The two exports are the shared base's first callers beyond the
    // register itself; the rest of the console gets them section by
    // section, as each one's columns and permissions are settled.
    //
    // +2 for editing a company's branches from its own page:
    //
    //   POST  admin/companies/:id/branches
    //   PATCH admin/companies/:id/branches/:branchId
    //
    // THERE IS NO DELETE. A branch that has taken deliveries is
    // referenced by orders and allocations, so removing one would
    // orphan them — and the requirement asked for adding and editing.
    //
    // −1: `POST admin/companies/:id/cr-number` is GONE.
    //
    // The registration moved into the ordinary edit, without a second
    // factor, by the console owner's decision. Keeping the old route
    // beside it would have left two ways to write one column under two
    // different rules — and the weaker one is the one anybody wanting
    // to skip the code would use.
    //
    // +7 for the overview decision — three screens, all reads except
    // the two that record who owns a follow-up case:
    //
    //   GET  admin/dashboard/overview            the eight cards, the
    //                                            charts, needs-attention
    //   GET  admin/orders/insights               the four stages
    //   GET  admin/orders/list                   the rows beneath them
    //   GET  admin/follow-up                     the cases and the cards
    //   GET  admin/follow-up/export
    //   POST admin/follow-up/:kind/:ref/assign
    //   POST admin/follow-up/:kind/:ref/in-progress
    //
    // NEITHER WRITE CLOSES A CASE. A case is derived from the record it
    // is about and leaves the list only when that record changes; there
    // is no closed flag on `follow_up_assignments` to set.
    //
    // ONE MORE since: DELETE /admin/taxonomy/:id. Categories moved to
    // a screen of their own, and a category that should not exist is
    // not something deactivation fixes — the argument is written out in
    // admin-routes.spec.ts, beside the list of what may be deleted.
    //
    // THREE MORE since: the unified listing.
    //
    //   POST   companies/me/listings              one form, one button
    //   DELETE companies/me/listings/:id          remove, or archive
    //   POST   companies/me/listings/:id/publish  after a blocker cleared
    //
    // THE DELETE IS NOT ALWAYS A DELETE. A listing nobody bought goes,
    // rows and all; one carrying a checkout, an order or a sold unit is
    // archived instead, because an invoice pointing at nothing is worse
    // than a product a supplier can no longer see.
    //
    // They ADD a seam and remove nothing: the product and opportunity
    // routes underneath are what the admin surface, the existing tests
    // and every current supplier already speak. What the first one
    // replaces is a SEQUENCE — create a product, upload its image,
    // submit it, build an opportunity, publish that — not a set of
    // endpoints.
    //
    // THE FOOTER ADDED FIVE, taking 274 to 279:
    //
    //   GET    /branding/footer                — public, unauthenticated
    //   GET    /admin/branding/footer          — draft + published + which
    //                                            policies actually exist
    //   PUT    /admin/branding/footer/draft
    //   POST   /admin/branding/footer/publish
    //   DELETE /admin/branding/footer/draft
    //
    // The public one is its OWN route rather than a field on
    // `GET /branding`: that response is pinned by an exact-key test so
    // nothing can slip into it, and the footer answers a different
    // question from the brand's identity.
    //
    // «بيانات المنشأة» ADDED ONE, taking 279 to 280:
    //
    //   PUT /me/email                          — the company's own address
    //
    // The field was on that screen already and could only be READ: an
    // account registered with a typo in its address had no way to fix
    // it short of an administrator. The new address is UNVERIFIED
    // whatever the old one was, which is why it is a route of its own
    // rather than a field on an existing profile write.
    //
    // THE SUPPLIER'S HOME ADDED ONE, taking 280 to 281:
    //
    //   GET /supplier/dashboard/overview       — the landing screen
    //
    // The page used to assemble itself from six list endpoints and
    // count the rows that came back, which answers "how many are on
    // the first page" rather than "how many are there". Every figure
    // is now a SUM or a COUNT the database performs, scoped to the one
    // company asking — and it reuses the console's own arithmetic
    // rather than defining "paid orders" a second time.
    //
    // COUNTED, NOT PREDICTED. This number was measured off the source
    // after the routes existed; an expectation written from a plan is
    // a plan asserting itself.
    const total = CONTROLLERS.reduce((sum, c) => sum + c.methods.length, 0);
    // +1: POST /companies/me/opportunities/:id/close-at-reached — the
    //     supplier's answer inside his 24-hour window. «إذا قرر أن تقفل
    //     الصفقة ويعتمدها أوك» — its twin, `extend`, already existed.
    // +1: POST /admin/opportunities/:id/cancel-and-refund — «الإدارة
    //     توقف العرض ويكون عندها زر استرداد الأموال». Separate from
    //     `cancel`, not a flag on it: moving buyers money is a
    //     different act, and it must be impossible to perform by
    //     forgetting to set something. A plain cancel now refuses
    //     outright once anyone has paid, and names this route.
    // +3: the console can now READ and EDIT one product, and see its
    //     pictures — «تعديل بصلاحية كاملة، مسجَّل في التدقيق باسم المشرف
    //     وقيمه قبل وبعد».
    //
    //   GET   /admin/products/:id                        the whole record
    //   PATCH /admin/products/:id                        the same fields
    //                                                    the supplier has
    //   GET   /admin/products/:id/media/:mediaId/image   its images
    //
    // THE IMAGE ROUTE IS NOT A DUPLICATE. The supplier's is
    // `companies/me/products/...`, where «me» is the session's company;
    // an admin session carries none, so that route can never serve one.
    // Both resolve through the same service and the same delivery rules.
    // +4: and the pictures are editable too — «حتى الصورة اجعلها قابلة
    //     للتعديل، لأني أضغط عليها ولا يعطيني تعديل». The supplier's own
    //     four, through the SAME service: only the ownership clause and
    //     the live-offer refusal differ, and both live in that service's
    //     actor descriptor rather than in a second copy of the logic.
    //
    //   POST   /admin/products/:id/media
    //   DELETE /admin/products/:id/media/:mediaId
    //   POST   /admin/products/:id/media/:mediaId/set-main
    //   POST   /admin/products/:id/media/reorder
    // -1: GET /admin/bank-accounts/pending-review, and the module it
    //     was the whole of. «أبغى ألغي صفحة الحسابات البنكية، ما
    //     أحتاجها، لأن كل حساب يخصّ مورّدًا فبالضرورة أدخل للمورّد
    //     وتفاصيله».
    //
    //     It fed one screen and one screen only. The screen went
    //     because the decision behind it went first: an account has
    //     not been approved on its own since the review became one
    //     request over the supplier's whole record — so the queue
    //     was a queue for nothing, and its row on the follow-up
    //     board stood beside the supplier's own row, for the same
    //     company, carrying a HIGHER priority than the request it
    //     was part of.
    //
    //     WHAT IT SHOWED IS NOT LOST. `GET /admin/companies/:id`
    //     now carries the account in force and the one waiting —
    //     holder, bank, last four — on the page where the approve
    //     button is. `GET /admin/bank-accounts/history` stays: it
    //     reads EVERY account a supplier ever submitted, which is
    //     a payout investigation rather than a record.
    // +1: GET /admin/companies/names — the source behind a chooser.
    //     «أضف خيار اختيار اسم المنشأة في بطاقة البحث… وخيار اختيار
    //      اسم المورّد في صفحة المنتجات».
    //
    //     TWO COLUMNS, UNPAGED. The register's own row carries the
    //     registration, the state, four counts and two totals; a
    //     dropdown needs a name and an id, and filling one from the
    //     register would make it the most expensive read on the
    //     console. Unpaged because a chooser that stops at a page
    //     silently cannot find half the platform.
    // +3: THE THREE DOORS THE OWNER'S RULE WAS MISSING — «احذف العرض
    //     أو عدّله دام ما عليه أي عملية، من صفحة المورّد ومن صفحة
    //     الإدارة، والمنتج يُحذف من صفحة المورّد ومن صفحة الإدارة…
    //     نفّذها الأربعة دام المشتري ما بعد دفع».
    //
    //     Four acts were stipulated and one existed. The console
    //     could delete a product and nothing else: it could pause,
    //     resume, cancel and refund an offer — four ways to STOP one
    //     and not one way to CORRECT or REMOVE it — and the supplier
    //     had no product delete at all, only `archive`, which is a
    //     one-way door with no way back.
    //
    //   DELETE /companies/me/products/:id
    //   PATCH  /admin/opportunities/:id
    //   DELETE /admin/opportunities/:id
    //
    //     ALL FOUR ASK ONE FUNCTION, `common/removal.ts`, so a
    //     supplier and an operator can never be told different things
    //     about the same row. The supplier's product delete is also
    //     the way OUT of an archive, and deliberately so: two of his
    //     products were stuck there with no edit, no offer and no
    //     delete, because deleting a draft offer used to archive the
    //     product under it.
    // +2: THE TWO DOORS A DIRECT LISTING NEEDS, and neither has an
    //     equivalent on a group offer.
    //
    //   POST /companies/me/opportunities/:id/stock
    //     «المورد يستطيع تعديل المخزون صعودًا أو هبوطًا». Not `PATCH
    //     :id`, which refuses every edit once a buyer has committed:
    //     restocking happens BECAUSE units were sold, and changes
    //     nothing anyone already agreed to. The floor it may not cross
    //     — sold plus what is held in live baskets — is computed under
    //     the offer row lock, which is the only place it can be true.
    //
    //   POST /companies/me/opportunities/:id/stop
    //     «إذا حصلت مبيعات لا تعدل السعر — يوقف المورد النشرة وينشئ
    //      واحدة جديدة بالسعر الجديد». The price is frozen on a row
    //     every order, invoice and settlement points back at, so a new
    //     price is a new listing. Distinct from the administrator's
    //     `cancel`, which refuses outright when paid orders exist, and
    //     from `cancel-and-refund`, which gives money back: a direct
    //     sale's paid orders went to preparation when they were paid
    //     and are untouched by the shelf closing.
    expect(total).toBe(296);  // +1: DELETE /admin/products/:id
  });

  it("has taken exactly the seven changes since 8F that were approved", () => {
    const migrations = readdirSync(
      join(SRC, "..", "prisma", "migrations"),
    ).filter(
      (entry) =>
        /^\d/.test(entry) &&
        statSync(join(SRC, "..", "prisma", "migrations", entry)).isDirectory(),
    );

    // 8F closed at 90. SIX approved additions since, all named so the
    // count cannot creep up behind an unremarked migration. The
    // additivity check below covers the FIRST: the second deliberately
    // drops columns, and dropped only columns proven empty beforehand.
    //
    // The fifth adds ONE TABLE and one enum, and touches nothing that
    // existed: the follow-up centre needs to record who owns a case and
    // whether they have started, and neither fact can be derived from
    // the record the case is about.
    //
    // The sixth adds one table and one enum for the same reason: a
    // supplier's verification request is a thing somebody sent, on a
    // date, that somebody else decided, with a reason. None of that
    // could be read off the company's own status column, which is why
    // PENDING_VERIFICATION previously meant three different situations
    // at once.
    //
    //
    // The seventh CHANGES NO SCHEMA AT ALL. It inserts the 13 regions
    // of the Kingdom and their governorates, because a branch form
    // offering one city is not a form. Every insert is guarded by NOT
    // EXISTS on the Arabic name, so rows already added by hand keep
    // their ids and every company_location stays pointed where it was.
    //
    // The EIGHTH is the one structural change since: the region
    // becomes the operational unit. `company_locations.region_id`
    // arrives NOT NULL and `city_id` becomes nullable, because a branch
    // could not otherwise be recorded on a region alone — and while
    // `city_id` was NOT NULL, switching cities off switched the
    // platform off with them.
    //
    // IT DELETES NO REFERENCE DATA AND NO SNAPSHOT. Every region and
    // city stays, every branch keeps the city it had, and the frozen
    // names on `checkout_location_allocations` are untouched. The two
    // city-name snapshot columns become nullable — which reads no row
    // and writes none — so a future allocation from a branch with no
    // city has somewhere honest to put that fact.
    //
    // COUNTED, NOT GUESSED — this number is what the directory holds.
    // NINETY-NINE NOW. `20260830000100_identity_uniqueness` adds the
    // two unique indexes the owner asked for — the mobile number and
    // the tax registration number — beside the two the platform has
    // always carried on the CR number and the email address. It adds
    // three indexes and touches no row.
    // THE NINTH AND TENTH, and they are the first to LOOSEN anything.
    //
    // «أنت تحمي منتجًا معتمدًا وليس عليه أي حركة، لذلك هذا عيب» —
    // «الميتة أريد أن أقدر أحذفها».
    //
    // Four immutability triggers refused a delete unconditionally: the
    // approval snapshot, the checkout allocation, the quote snapshot,
    // and the deferred check that allocations sum to their session's
    // lock. Between them they made 29 of 30 products unerasable, and a
    // console delete died with a raw Postgres exception rather than an
    // answer.
    //
    // EACH NOW ASKS WHETHER ANYTHING WAS BUILT ON THE ROW instead of
    // assuming something was. A snapshot no published offer reads, and
    // an allocation and quote no order stands on, may go. Everything an
    // invoice or a ledger entry rests on is refused exactly as before,
    // and UPDATE stays forbidden in all four without condition —
    // deleting an unread row erases nothing, while changing one
    // rewrites what an administrator approved or a buyer reserved.
    //
    // NO TABLE CHANGES SHAPE. Both migrations are
    // `CREATE OR REPLACE FUNCTION` and nothing else: no column added,
    // dropped or altered, and no row read or written.
    // THE ELEVENTH, and the first to change the SHAPE of a financial
    // table rather than a rule about one.
    //
    // «منتج نشرت له عرضًا وانتهى وتم تسليم المشترين بضاعتهم — خلاص، يتم
    //  التحكم فيه مثل التعديل يكون فيه حذف.»
    //
    // A master order carried SEVEN snapshots of the parties and the
    // checkout allocation five of the branch — every one copied so the
    // record would outlive the row it came from. NOTHING copied the
    // goods. The only path from an invoice to what was invoiced ran
    // invoice -> order -> opportunity -> approval snapshot -> product,
    // and the platform kept that path intact by refusing to let a sold
    // product go. Backwards: a correct invoice is self-contained.
    //
    // SIX COLUMNS, BACKFILLED FROM THE FROZEN SNAPSHOT each order was
    // already displaying, then made NOT NULL — the two unit names stay
    // nullable because a listing may name no selling unit, and an empty
    // string would claim it named one.
    //
    // IT DISABLES `trg_prevent_master_order_mutation` FOR ONE
    // STATEMENT, inside one transaction, and says so in the file. The
    // guard permits exactly IN_FULFILLMENT -> FULFILLED and refuses
    // every other UPDATE; this migration is not changing what an order
    // says, it is writing into the row what the row already meant. DDL
    // is transactional in Postgres, so a failure anywhere rolls the
    // disable back with it and the guard can never be left off.
    // THE TWELFTH, and the one that makes this a group buy.
    //
    // «المشترون يشترون حصصهم، إذا اكتمل الهدف يتم إرسال الطلبات للمورد…
    //  ويبدأ التجهيز من بداية إقفال العرض.»
    //
    // The platform's own transition table said `targetQuantity` was a
    // supply CAP and that "every paid order is created and sent for
    // fulfillment immediately, independent of how much of the cap is
    // sold". So a clock started at PAYMENT — reporting a supplier late
    // on three screens for work he was not permitted to begin — the
    // first buyer could be shipped a wholesale price for a volume that
    // never materialised, and a collective refund became impossible the
    // moment anything was delivered.
    //
    // THREE CHANGES, ONE DECISION: the due date becomes nullable and
    // means "not yet permitted"; `AWAITING_FUNDING` names the state the
    // old vocabulary could not say; and the allocation guard learns
    // exactly one transition, which may fill the date only while it is
    // still NULL and only if nothing else on the row moves with it.
    // THE THIRTEENTH, and the other half of the twelfth.
    //
    // «في حالة لم يكتمل الهدف يتم الاسترداد تلقائي… فرصة وصلت ستين
    //  بالمئة، هنا مهلة تعطى للمورد مدة 24 ساعة… إذا لم ينفذ الخيارين
    //  تنتهي الفرصة وتسترد الأموال تلقائي.»
    //
    // Making fulfilment wait for the target left one case WORSE than it
    // found it: an offer that never fills used to ship anyway, and would
    // now strand every buyer's share in AWAITING_FUNDING for good. So
    // the refund path lands with it, not after it.
    //
    // TWO ENUM VALUES AND A DATE. The refund machinery — obligation,
    // double-entry posting, provider attempt, closing webhook — has
    // existed since 7C and could only ever be fired by a payment
    // exception or a dispute decision; nothing could say "this offer did
    // not fill". `OPPORTUNITY_UNFUNDED` and `TARGET_NOT_REACHED` are
    // that sentence.
    //
    // AND THE SUPPLIER'S WINDOW IS A DATE, NOT A STATUS, because
    // `EXPIRED` is terminal in the transition table and an extension has
    // to be able to return the offer to ACTIVE. A column says the same
    // thing without loosening the state machine that keeps every other
    // path honest.
    // THE FOURTEENTH, and it moves one condition in one trigger.
    //
    // «احذف العرض أو عدّله دام ما عليه أي عملية.»
    //
    // `prevent_opportunity_core_field_change` froze every core field
    // — price, quantity, dates, branch, description — from the moment
    // `first_activated_at` was set. The reasoning was that a buyer may
    // be relying on what they were shown, and in the common case there
    // is no buyer at all: the rule was protecting nobody and stopping
    // the only person it belonged to, in the database, below any
    // service that might have wanted to allow it.
    //
    // THE CONDITION BECOMES `funded_quantity > 0`, the row's own
    // witness to a payment — the webhook raises it inside the same
    // transaction that marks the session PAID and writes the master
    // order, so it is never behind them. Below it the offer is the
    // supplier's to correct; from the first riyal every one of those
    // columns is frozen exactly as before.
    //
    // NOTHING ELSE MOVES. The extension path, the immutability of
    // `extended_at` and the frozen column list are reproduced verbatim
    // from the deployed definition, and the first payment is not
    // blocked by its own arrival: on that write OLD.funded_quantity is
    // still 0.
    // THE FIFTEENTH, and it repairs rather than adds.
    //
    // `fulfilment_waits_for_funding` — the twelfth — added
    // `AWAITING_FUNDING` to the enum, taught the mutation trigger the
    // new transition, and made `preparation_due_at` nullable. It did
    // not touch `order_allocations_status_timestamp_consistency`, a
    // CHECK constraint that ENUMERATES the legal statuses one by one.
    // A row matching none of its five branches fails the CHECK, so
    // the first successful payment on ANY group offer was refused
    // inside the webhook's own transaction. The gate that migration
    // delivered had never been able to run.
    //
    // ONE BRANCH, AT THE FRONT. The other five are reproduced
    // verbatim from the migration that wrote them — this adds a case,
    // it does not revise the ones that were already right. The new
    // branch also asserts the due date is empty, which is the meaning
    // the twelfth gave that column: NULL is «not yet permitted».
    //
    // NO ROW CHANGES. The branch only widens what is accepted, so
    // the recreated constraint validates against existing data.
    // THE SIXTEENTH: two sale paths on one record.
    //
    // `sale_mode` with every existing row GROUP; `end_at` nullable
    // because a shelf has no window; a CHECK that keeps a DIRECT row
    // out of FUNDED, EXPIRED and SCHEDULED; the share snapshot made
    // GROUP-only while the sales unit and commission stay required for
    // both; and one exception cut into the freeze trigger so a DIRECT
    // shelf can be restocked — never below what has already sold off
    // it. The price stays frozen for both modes, which is why changing
    // one means publishing a new listing.
    // THE SEVENTEENTH, EIGHTEENTH AND NINETEENTH: three indexes, no
    // columns, no behaviour.
    //
    // A scalability audit measured the platform at 70,000 seeded
    // companies and found the two registers reading whole tables to
    // show twenty rows. The marketplace's DEFAULT sort — NEWEST — was
    // a sequential scan and a sort at 96 ms, while the neighbouring
    // ENDING_SOON answered in 0.33 ms off an index that happened to fit
    // it. The company register was the same story for its ordering, its
    // two filters and its name search.
    //
    // The third corrects the second: its trigram indexes were built
    // over `lower(legal_name)`, which the query never writes, so they
    // could not be used at all.
    //
    // THE TWENTIETH: the same three indexes again, for the PRODUCT
    // register. It was the defect the company migration described, one
    // tab across — a parallel sequential scan and a top-N sort over
    // 126,000 products to show twenty — and it was found while
    // measuring the company fix, not before it.
    //
    // THE TWENTY-FIRST: seventeen foreign keys that had no index on the
    // child side, so every parent delete scanned a whole table. Found
    // by measurement, not by reading — one of them made a delete batch
    // take 46 seconds.
    //
    // THE TWENTY-SECOND CORRECTS THE TWENTY-FIRST, and this is the
    // second time in this sequence that a rule had to be replaced by a
    // decision. Indexing EVERY unindexed foreign key was a rule, and it
    // is wrong the same way `lower(legal_name)` was: plausible,
    // uniform, and never checked against what the code does. Each was
    // then judged on whether the application reads the column and how
    // often the parent is really deleted, and twelve were dropped.
    expect(migrations).toHaveLength(113);
    expect(migrations.at(-1)).toBe(
      "20260915130000_keep_only_the_foreign_key_indexes_that_earn_their_keep"
    );
    expect(migrations.slice(-8)).toEqual([
      "20260914000100_awaiting_funding_passes_the_status_check",
      "20260915000100_two_sale_paths_direct_and_group",
      "20260915100000_index_the_marketplace_default_sort",
      "20260915100100_index_the_company_register",
      "20260915100200_trigram_index_on_the_column_the_query_names",
      "20260915110000_index_the_product_register",
      "20260915120000_index_every_foreign_key",
      "20260915130000_keep_only_the_foreign_key_indexes_that_earn_their_keep",
    ]);

    // Additive means additive: nothing dropped, nothing rewritten,
    // nothing altered in place.
    const sql = readFileSync(
      join(
        SRC,
        "..",
        "prisma",
        "migrations",
        "20260825000200_8g_add_locale_brand_logos",
        "migration.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bALTER COLUMN\b/i);
  });
});

describe("every supplier route is guarded the same way", () => {
  it("finds every supplier controller", () => {
    // `supplier/replacement-obligations` appears twice on purpose: the reads
    // and the three write transitions are separate classes, so the guard set
    // on each says exactly what that class does.
    expect(SUPPLIER.map((c) => c.basePath).sort()).toEqual([
      "supplier/disputes",
      "supplier/notifications",
      "supplier/order-allocations",
      "supplier/orders",
      "supplier/replacement-obligations",
      "supplier/replacement-obligations",
      "supplier/settlements",
    ]);
  });

  it.each(["supplier/orders", "supplier/settlements", "supplier/disputes"])(
    "%s requires a session AND the supplier role",
    (basePath) => {
      for (const controller of SUPPLIER.filter(
        (c) => c.basePath === basePath,
      )) {
        expect([controller.file, controller.guards]).toEqual([
          controller.file,
          expect.stringContaining("SessionAuthGuard"),
        ]);
        expect([controller.file, controller.guards]).toEqual([
          controller.file,
          expect.stringContaining("RequireSupplierGuard"),
        ]);
      }
    },
  );

  it("guards every supplier controller without exception", () => {
    for (const controller of SUPPLIER) {
      expect([
        controller.basePath,
        controller.guards.includes("SessionAuthGuard"),
      ]).toEqual([controller.basePath, true]);
      expect([
        controller.basePath,
        controller.guards.includes("RequireSupplierGuard"),
      ]).toEqual([controller.basePath, true]);
    }
  });

  it("carries CsrfGuard exactly where a write exists, and nowhere else", () => {
    // The provider exempts safe methods, so a read-only controller does not
    // need it — and adding it anyway would suggest a write that is not there.
    for (const controller of SUPPLIER) {
      const writes = controller.methods.filter((m) => !m.startsWith("@Get"));
      expect([
        controller.basePath,
        controller.guards.includes("CsrfGuard"),
      ]).toEqual([controller.basePath, writes.length > 0]);
    }
  });

  it("keeps the product image route behind the same two guards", () => {
    // It is not under `supplier/`, but it serves a supplier's private media —
    // a product may be a DRAFT that was never published.
    const image = CONTROLLERS.find(
      (c) => c.basePath === "companies/me/products/:productId/media",
    );

    expect(image).toBeDefined();
    expect(image!.guards).toContain("SessionAuthGuard");
    expect(image!.guards).toContain("RequireSupplierGuard");
    // Read-only, so no CsrfGuard.
    expect(image!.guards).not.toContain("CsrfGuard");
    expect(image!.methods).toEqual(["@Get("]);
  });
});

describe("no supplier route takes a company from the request", () => {
  it("reads the company from the SESSION every time", () => {
    // A company id in a path, a query or a body would let a caller name whose
    // data they wanted, and the guard would happily let them.
    for (const file of new Set(SUPPLIER.map((c) => c.file))) {
      const source = strip(readFileSync(file, "utf8"));

      expect([file, source.includes("session.companyId")]).toEqual([
        file,
        true,
      ]);
      expect([file, /@Param\(\s*"companyId"/.test(source)]).toEqual([
        file,
        false,
      ]);
      expect([file, /@Query\(\s*"companyId"/.test(source)]).toEqual([
        file,
        false,
      ]);
      expect([file, /@Body\(\s*"companyId"/.test(source)]).toEqual([
        file,
        false,
      ]);
    }
  });
});

describe("the legacy raw-row supplier order reads are gone", () => {
  it("removed the controller entirely", () => {
    // Leaving it registered would have meant two handlers on the same paths,
    // one of them returning traderCompanyId and a Decimal totalAmount.
    expect(
      FILES.some((f) => f.endsWith(join("orders", "orders.controller.ts"))),
    ).toBe(false);
  });

  it("removed the service methods that fed it", () => {
    const service = strip(
      readFileSync(join(SRC, "orders", "orders.service.ts"), "utf8"),
    );

    expect(service).not.toContain("listForSupplier");
    expect(service).not.toContain("getForSupplier");
    // The admin reads stay — they are a different audience with a different
    // boundary.
    expect(service).toContain("listForAdmin");
  });

  it("serves supplier orders only from the projected controller", () => {
    const orderControllers = CONTROLLERS.filter(
      (c) => c.basePath === "supplier/orders",
    );

    expect(orderControllers).toHaveLength(1);
    expect(orderControllers[0].file).toContain("supplier-reads.controller.ts");
    expect(orderControllers[0].methods).toHaveLength(3);
  });
});
