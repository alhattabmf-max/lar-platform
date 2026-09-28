import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Static properties of the admin HTTP surface.
 *
 * Read from the source rather than from a running app: these are
 * statements about what CANNOT exist, and a runtime test only proves
 * things about the routes it happens to call.
 */

const ADMIN_ROOT = join(__dirname, "..", "..", "admin");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (entry.endsWith(".controller.ts")) found.push(full);
  }
  return found;
}

const CONTROLLERS = walk(ADMIN_ROOT).map((path) => ({
  path,
  name: path.slice(path.lastIndexOf("admin")),
  source: readFileSync(path, "utf8"),
}));

describe("every admin controller is behind the admin session guard", () => {
  it("finds the controllers at all", () => {
    // A guard against this whole file passing because the walk found
    // nothing — the failure mode that makes a suite look green.
    expect(CONTROLLERS.length).toBeGreaterThan(15);
  });

  it.each(CONTROLLERS.map((c) => [c.name, c.source] as const))(
    "%s declares AdminSessionAuthGuard",
    (_name, source) => {
      expect(source).toContain("AdminSessionAuthGuard");
    }
  );
});

describe("every state-changing admin route is behind the CSRF guard", () => {
  // The admin session rides in a cookie, so a state-changing route
  // without an Origin check is cross-site-forgeable by any page the
  // operator happens to have open.
  const WRITERS = CONTROLLERS.filter(
    (c) => /@(Post|Put|Patch|Delete)\(/.test(c.source)
  );

  it("finds controllers that write", () => {
    expect(WRITERS.length).toBeGreaterThan(10);
  });

  it.each(WRITERS.map((c) => [c.name, c.source] as const))(
    "%s declares CsrfGuard",
    (_name, source) => {
      expect(source).toContain("CsrfGuard");
    }
  );
});

describe("no admin controller re-declares a raw enum vocabulary", () => {
  // A locally declared status list is how the API and the portal drift
  // on what a valid filter is. Every admin query DTO validates against
  // the shared package instead.
  const QUERY_DTOS = (function collect(): { name: string; source: string }[] {
    const out: { name: string; source: string }[] = [];
    function visit(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) visit(full);
        else if (/query\.dto\.ts$/.test(entry)) {
          out.push({ name: entry, source: readFileSync(full, "utf8") });
        }
      }
    }
    visit(ADMIN_ROOT);
    return out;
  })();

  it("finds the query DTOs", () => {
    expect(QUERY_DTOS.length).toBeGreaterThan(3);
  });

  it.each(QUERY_DTOS.map((d) => [d.name, d.source] as const))(
    "%s imports its vocabulary from a shared package",
    (_name, source) => {
      // Every one of these files filters by at least one vocabulary, so
      // each must reach for a shared constant rather than an inline
      // array of string literals.
      if (!/@IsIn\(/.test(source)) return;
      expect(source).toMatch(/from "@platform\/(types|domain)"/);
      // An inline array inside @IsIn is exactly the local copy this
      // forbids.
      expect(source).not.toMatch(/@IsIn\(\s*\[/);
    }
  );
});

describe("the admin surface has no self-registration", () => {
  it("no controller exposes a route that creates an administrator", () => {
    // Accounts are created by the bootstrap command on the server. An
    // HTTP create would make one compromised session enough to mint a
    // second permanent one.
    const adminUsers = CONTROLLERS.find((c) => c.name.includes("admin-users"));
    expect(adminUsers).toBeDefined();

    const source = adminUsers!.source;
    // A bare `@Post()` on the collection is the create route. The
    // lifecycle routes all carry a path segment.
    expect(source).not.toMatch(/@Post\(\s*\)/);
    expect(source).not.toMatch(/@Put\(\s*\)/);
  });

  it("exposes a delete on promotional banners ONLY, and nowhere else", () => {
    // Nothing in this system is hard-deleted through the console:
    // reference data deactivates, products close, administrators are
    // disabled. Two narrow exceptions, and they are narrow for the same
    // reason — neither is a financial or reference record:
    //
    //   banner-image        a file rather than a record
    //   admin-banner        marketing artwork with nothing pointing at it
    //   admin-brand-asset   the header logo — also artwork, also
    //                       unreferenced
    //
    // A promotional banner is content someone put up and will take
    // down. No order, settlement or other record references it, so a
    // deactivated row is clutter an operator can never clear.
    //
    // THE THIRD ENTRY, argued on its own terms rather than waved
    // through: a header logo is an image an operator uploaded. Nothing
    // in the system points at it — no invoice, no email, no order —
    // and it has no "deactivate" that would mean anything, because a
    // header showing a switched-off logo is just a header with no
    // logo. Removing it IS the operation, so hiding that behind a flag
    // would leave dead bytes nobody can clear. Deleting takes both
    // languages together, because one logo and one blank is not a
    // state anyone chose.
    //
    // THE FOURTH ENTRY, argued on its own terms and narrower than the
    // three above it, because a company is not artwork.
    //
    //   admin-company   a company with NO retained record
    //
    // Every other row in this system is referenced by something, and a
    // company usually is too — by orders, payments, invoices,
    // settlements, refunds, disputes, bank accounts, tax profiles,
    // accepted policies. Where any of those exist the removal is
    // refused, and refused BY THE SERVER: `CompanyDeletionEligibility`
    // counts them inside the same transaction that would do the delete,
    // so a caller who skips the screen and posts straight at the route
    // meets the identical answer. The screen's disabled button is a
    // courtesy on top of the rule, never the rule.
    //
    // What remains once that check passes is a company that registered
    // and never traded: a name, a registration number, contacts, an
    // address and an account nobody claimed. There is no history to
    // preserve, and deactivating it leaves a row an operator can never
    // clear — the same argument as the three above, reached from the
    // opposite direction.
    //
    // It is not a quiet delete. It takes a written reason and the
    // legal name or registration typed out, and it writes who did it,
    // when and why to a table that has no foreign key to companies —
    // so the record outlives the thing it describes.
    //
    // It no longer takes a two-factor code. A code says WHO is at
    // the keyboard, which the admin session already established, and
    // says nothing about WHICH company is on screen — and that is
    // what the typed name is for.
    //
    // THE FIFTH ENTRY, argued on its own terms.
    //
    //   admin-taxonomy   a category nothing is filed under
    //
    // A category is the shape of the catalogue, and a wrong shape is
    // not something deactivation fixes: a mistyped or duplicated
    // category left inactive still sits in the tree an operator has
    // to read, for good, and the reason it was created wrongly is
    // usually that it should not exist at all.
    //
    // It is refused while anything still needs it, BY THE SERVER and
    // for two distinct reasons. A category with sub-categories is
    // refused because `taxonomy_nodes.parent_id` is ON DELETE SET
    // NULL: the database would remove the parent and silently
    // promote every branch under it to a main category, with no way
    // back. A category products are classified under is refused
    // because `products.taxonomy_node_id` is ON DELETE RESTRICT and
    // a product's classification is part of its record. Both counts
    // travel on the row, so the screen shows WHY before anybody
    // presses anything.
    //
    // What remains once those pass is a leaf nothing points at.
    // Deactivating it would leave a row an operator can never clear —
    // the same argument as the four above.
    //
    // THE SIXTH, ADDED WITH THE FOOTER SCREEN: `DELETE
    // /admin/branding/footer/draft`.
    //
    // IT DELETES NOTHING A VISITOR HAS EVER SEEN. A footer draft is an
    // unpublished working copy in `system_settings`; discarding one
    // returns the screen to whatever is published and changes the
    // public site not at all. The published footer lives in a different
    // row and no route here removes it. Deactivating a draft instead
    // would leave the console permanently reporting "there is an
    // unpublished draft" for a draft nobody wants — the same argument
    // as the five above, and the reason the operation has to be a
    // delete.
    //
    // It is recorded like every other change, with its before and
    // after, so a discarded draft is still answerable.
    //
    // THE SEVENTH, argued on its own terms as the note above demands.
    //
    //   admin-products   a product NO BUYER EVER REACHED
    //
    // «طلبت أني أقدر أحذف المنتج نهائيًّا ولا لقيت إلا خيار إغلاق.»
    //
    // A product is not artwork, and unlike an untraded company it is
    // normally referenced — by its offers, its frozen approval
    // snapshots, its media, its reports, and THROUGH its offers by
    // checkout sessions and master orders. That is exactly why the
    // rule is not about status.
    //
    // IT IS REFUSED BY THE SERVER, not by the screen. The service
    // counts the master orders and checkout sessions pointing at this
    // product's opportunities INSIDE the transaction that would do the
    // delete, so a caller who skips the console and sends `DELETE`
    // straight at the route meets the identical answer, naming both
    // counts. An invoice that cannot say what was invoiced is worse
    // than a listing that stays visible, so anything a buyer reached
    // is CLOSED and never deleted. The console draws the button on
    // every row and lets the 409 explain, because hiding it would
    // leave a reader guessing which rule they had broken.
    //
    // WHAT REMAINS ONCE THAT PASSES is a listing nobody ever reached:
    // a draft, a rejected row, a duplicate typed twice. Closing one is
    // not an answer — it leaves a permanent line in the supplier's own
    // list labelled CLOSED, which is a claim about something that was
    // withdrawn from sale, and this was never on sale. The operator
    // can never clear it: the same argument as the six above.
    //
    // AND IT IS NOT A QUIET DELETE. It takes a written reason, and the
    // audit entry is created BEFORE the rows go, carrying the
    // product's name, status and offer count in `beforeData` — after
    // the transaction there is nothing left for an entity id to join
    // to, so the log holds the evidence rather than a pointer to it.
    //
    // THE EIGHTH, and the argument it was asked for.
    //
    // `admin-product-media` removes ONE PICTURE from a product —
    // «حتى الصورة اجعلها قابلة للتعديل، لأني أضغط عليها ولا يعطيني
    // تعديل».
    //
    // IT DELETES NOTHING ANYTHING ELSE STANDS ON. A `product_media`
    // row is marked hard-deletable in the schema itself, and it is the
    // only kind of row on this platform that is: no invoice, no order,
    // no ledger entry and no settlement joins to it. A PUBLISHED offer
    // does not either — it carries its own frozen approval snapshot and
    // renders the picture from inside it — so removing a photograph
    // cannot break a screen a buyer is looking at.
    //
    // THE SUPPLIER ALREADY HAS THIS EXACT ROUTE, and it is the same
    // service: `DELETE /companies/me/products/:productId/media/:id`.
    // The console is not gaining a power the owner of the record lacks;
    // it is gaining the ability to use it on their behalf.
    //
    // WHAT IT REPLACES IS A HEAVIER ANSWER. Until now, a wrong or
    // unlawful photograph on a product a buyer can reach had exactly
    // two remedies in this console — suspend the whole product, or
    // erase it — and both punish the entire record for one file.
    //
    // AND IT IS NOT QUIET: `PRODUCT_MEDIA_REMOVED_BY_ADMIN`, named for
    // the actor, so the register answers «who removed a supplier's
    // photograph» by action alone.
    //
    // THE NINTH, and the argument the note above demands.
    //
    //   admin-opportunities   an offer NO BUYER EVER PAID FOR
    //
    // «حذف وتعديل العرض من صفحة الإدارة… نفّذها الأربعة دام المشتري
    //  ما بعد دفع.»
    //
    // THE CONSOLE COULD STOP AN OFFER FOUR WAYS AND REMOVE IT NONE.
    // Pause, resume, cancel and cancel-and-refund all answer «هذا
    // العرض يجب أن يتوقف»; not one of them answers «هذا العرض ما كان
    // المفروض ينشر أصلًا» — a duplicate, a test row, a price typed
    // with a zero too many. Cancelling one of those leaves a
    // permanent CANCELLED line claiming something was withdrawn from
    // sale, which is a statement about a thing that was never sold.
    //
    // IT IS REFUSED BY THE SERVER, not by the screen, and by the SAME
    // function the supplier's own delete asks: `assertNoBuyerCommitted`
    // counts live baskets, paid baskets, master orders and the offer's
    // own funded quantity INSIDE the transaction that would do the
    // delete. A caller who skips the console meets the identical
    // answer. Anything a buyer PAID for is cancelled-and-refunded and
    // never deleted.
    //
    // AND THE PRODUCT IS NOT TOUCHED. An offer is an event on a
    // product, not the product itself — that distinction is the whole
    // reason this route exists separately from `admin-products`, and
    // conflating the two is precisely the defect that sent the owner
    // looking for it: his supplier-side offer delete used to archive
    // the product underneath.
    //
    // AND IT IS NOT QUIET: `OPPORTUNITY_DELETED`, written BEFORE the
    // rows go and carrying the offer's product and status, because
    // afterwards there is nothing left for an entity id to join to.
    //
    // DO NOT WIDEN THIS. A tenth entry needs the same argument made
    // again, in writing, before this list is touched.
    const ALLOWED_TO_DELETE = [
      "banner-image",
      "admin-banner",
      "admin-brand-asset",
      "admin-company",
      "admin-taxonomy",
      "admin-footer",
      "admin-products",
      "admin-product-media",
      "admin-opportunities",
    ];

    for (const controller of CONTROLLERS) {
      if (ALLOWED_TO_DELETE.some((name) => controller.name.includes(name)))
        continue;
      expect([controller.name, /@Delete\(/.test(controller.source)]).toEqual([
        controller.name,
        false,
      ]);
    }
  });

  it("keeps the banner delete to a single route, not a general capability", () => {
    const banner = CONTROLLERS.find((c) =>
      c.name.includes("admin-banner.controller"),
    );
    expect(banner).toBeDefined();

    // Exactly one @Delete, and it removes one banner by id.
    expect(banner!.source.match(/@Delete\([^)]*\)/g)).toEqual([
      '@Delete(":id")',
    ]);
  });
});
