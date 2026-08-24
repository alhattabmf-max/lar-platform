# Post-Phase-8 review — recorded gaps

Findings that are **out of Phase 8's scope** but must not be discovered
again from scratch. Nothing here is implemented, and nothing here has a
placeholder in the code or the UI: a field that does not exist is absent,
not stubbed.

---

## G-A. Product SKU does not exist

**Status: absent from the entire system.**

Established during the 8E.5 pre-implementation review:

- no `sku` column on `Product` in `prisma/schema.prisma`
- no `sku` in `CreateProductDto` or `UpdateProductDto`
- no unique constraint, partial index or application-level uniqueness check
- no reference anywhere under `apps/api/src`

There is therefore **no duplicate-SKU error to design for**, and the
supplier product forms built in 8E.5b will not have a SKU field. A form
input with nowhere to store its value is worse than a missing feature: it
looks like data the platform keeps.

If SKU is required, it is a schema change (column + uniqueness scope
decision — per company? per platform? case-sensitivity? trimming?) plus
DTO, contract, projection and form work. It cannot be added inside a
frontend batch.

**Blueprint note:** the Blueprint anticipates a SKU. The implemented
schema does not carry one. This entry exists so that discrepancy is a
recorded decision to revisit rather than a silent omission.

---

## G-B. Per-category product attributes do not exist

**Status: absent from the entire system.**

- no attribute definition table, no attribute value table
- no attribute types (`text` / `number` / `select` / `multi-select` /
  `boolean` or otherwise), no option lists
- no link between `TaxonomyNode` and any attribute concept
- neither product DTO accepts anything of the kind

A `Product` is a fixed set of roughly fourteen columns. "Required
attributes per category", "attribute types and their values" and
"attribute option sources" have no backing whatsoever.

Building this means: two or three new tables, an admin surface to define
attributes per taxonomy node, validation that varies by the selected
node, a read endpoint for the definitions, storage for the values, and
inclusion in the frozen `ProductApprovalSnapshot` — because an
opportunity is built on that snapshot and its attributes would have to
freeze with it.

**Blueprint note:** the Blueprint anticipates category attributes. The
implemented schema does not carry them. Recorded here for the same reason
as G-A.

---

## G-C. Taxonomy has no leaf-only rule

**Status: intentional, but worth re-confirming.**

`ProductsService.requireActiveTaxonomyNode` checks only that the node
exists and is active. Any node may hold products directly, including an
intermediate one with children.

`apps/web/lib/taxonomy-tree.ts` already documents and depends on this:
every node is selectable, because making parents unselectable would
orphan products already filed under them.

Not a defect. Listed so a later "categories should be leaf-only" request
is understood as a **data migration** (re-filing existing products) and
not a validation tweak.

---

## G-D. Media policy limits are not readable by any client

**Status: CLOSED in Phase 8F.** `GET /companies/me/policy-limits`
(`apps/api/src/companies/policy-limits.controller.ts`) now returns
`maxImagesPerProduct`, `maxSizeBytes` and `allowedTypes`, and
`components/supplier/product-media-manager.tsx` consumes them to check a
file before it is uploaded. `maxPixels` is deliberately not exposed — it
is not checkable in the browser before an upload. The original entry
follows, unaltered, for the reasoning it records.

`MediaPolicyService` holds `maxImagesPerProduct`, `maxSizeBytes`,
`allowedTypes` and `maxPixels`, all admin-configurable. No endpoint
exposes them.

The supplier UI therefore states **no numeric limit** and relies on the
server's refusal to say what went wrong. That is correct today — an
invented number is worse than none — but a read endpoint would let the
form warn before a large upload is sent.

---

## G-E. Opportunity duration and quantity bounds are not readable either

**Status: CLOSED in Phase 8F.** The same
`GET /companies/me/policy-limits` returns `minDurationHours`,
`maxDurationDays`, `minTargetQuantity` and `maxTargetQuantity`, and
`components/supplier/opportunity-form.tsx` warns against them without
ever disabling submit — the server stays the authority. The original
entry follows, unaltered.

Same shape as G-D, found while building the opportunity form.

`OpportunitySettingsService` holds `minDurationHours`, `maxDurationDays`,
`minTargetQuantity` and `maxTargetQuantity`, all admin-configurable. No
endpoint exposes them.

The listing form therefore states **no duration or quantity limit** and
relies on the server naming the bound it refused on. Correct today, but a
supplier only discovers a limit by hitting it. One read endpoint covering
both this and the media policy would let both forms warn before a submit.

---

## G-F. Tax snapshot inputs are floats inside the domain computation

Closed for the SERIALIZER in the Financial Precision Delta:
`computeTaxSnapshot` is now Decimal end-to-end and its two float inputs
are gone.

One conversion remains in `opportunities.service.ts` —
`totalValueDecimal.toNumber()` — feeding `selectTier`, which compares the
total against the share-tier policy's round upper bounds and returns an
INDEX. Proven flip-free across 140,000 (quantity × price) pairs and at
every tier boundary, and pinned as an exact single site by
`supplier-opportunity.precision.spec.ts`.

It is safe by MAGNITUDE, not by construction: a `Decimal(14,2)` total tops
out near 1e12 and a double holds every 2-decimal value exactly to ~9.0e13.
If that column ever widens, this stops being safe. Recorded so the
assumption is written down rather than remembered.

---

## G-G. Historical tax snapshots have not been audited

`docs/audits/tax-snapshot-precision-audit.sql` — four read-only queries,
no `UPDATE`, no migration.

Any opportunity published while a tie-producing tax rate was configured
has `unit_price_excl_tax_amount` one cent low and `unit_tax_amount` one
cent high. At 15% there are no tie cases. Whether any row is affected is a
fact about stored data and cannot be answered from the code.

Query 0 in that file answers it in one cheap read. If Query 2 returns
anything, correcting frozen snapshot columns that orders were placed
against is a finance decision, not a data cleanup.

---

# Found during the Phase 8F founder walkthrough

The entries below came out of running the whole platform locally and
driving a real purchase end to end — supplier registration through to a
created order. Everything above this line was found by reading the code;
everything below it was found by using the product.

---

## G-H. A raw INSERT omitted `updated_at`, and no purchase could complete

**Status: fixed in the working tree, pending review. Not yet committed.**

`NotificationWriterService.insertEmailIntents` wrote:

```sql
INSERT INTO outbox_events (event_type, payload, idempotency_key)
```

`outbox_events.updated_at` is `NOT NULL` with **no database default**.
Prisma satisfies it from `@updatedAt` in the *client*, so
`tx.outboxEvent.create()` works and a hand-written INSERT does not — the
row is rejected with Postgres `23502`.

That INSERT runs inside the payment webhook's transaction. The throw
rolled back the captured payment **and the order that had just been
created**, so the observable behaviour was `500 Internal Server Error` on
every successful payment. No trader could ever complete a purchase.

Two things kept it hidden:

- **Unit tests stub the transaction client** and never reach Postgres, so
  all 2061 of them passed.
- **The integration suite already covered it** —
  `test/notifications.integration-spec.ts` asserts
  `emailIntentsCreated === 2` against a real database and fails without
  the fix. It needs a live Postgres and Redis and runs under a separate
  config, so a routine `pnpm test` never executes it.

The defect was unreachable before Phase 8F's DI fixes (see G-I): until
those landed the API could not boot at all, so nothing had ever run this
code path against a real database.

**Guards added:** `src/common/database/raw-insert-updated-at.spec.ts`
derives the set of tables whose `updated_at` has no default *from
`schema.prisma`*, scans every raw `INSERT INTO` in `src`, and asserts the
column is named. It covers the whole class rather than this one call
site, needs no infrastructure, and was verified to fail when the fix is
reverted.

**Still open:** the integration suite is not part of any routine
verification step. Behavioural coverage that never runs is not coverage.

---

## G-I. Eight modules injected providers they never imported

**Status: fixed in the working tree, pending review. Not yet committed.**

Six modules injected `NotificationEventsService` and two injected
`StorageService` without importing the module that exports them. Nest
cannot construct such a provider, so `NestFactory.create(AppModule)`
threw and **the API could not start at all**.

Pre-existing since 8D introduced the notification producers. Every unit
test constructs its service directly with a stub, and nothing in the unit
suite ever built the application graph, so the whole suite stayed green
against an application that could not boot.

Nest reports only the *first* missing import per boot, so fixing these
serially costs one rebuild and restart per defect and never reveals how
many remain.

**Guard added:** `src/app.module.di.spec.ts` compiles the real
`AppModule`. `.compile()` builds the graph and instantiates providers but
does **not** run lifecycle hooks, and every outbound connection in this
application is opened in `onModuleInit` — `PrismaService.$connect`,
`RedisService`'s lazy Redis client, `StorageService`'s HeadBucket probe.
So the guard touches no network, needs no container, and belongs in the
unit suite. Verified to fail, with Nest's own diagnostic, when any one of
the eight imports is reverted.

---

## G-J. Money and tax policies cannot be configured through the product

**Status: open. Blocks a production launch.**

Four values gate the purchase path. None can be set by any administrator
using the shipped product:

| Value | Setter exists | Reachable by an admin |
|---|---|---|
| Shipping tariff (3 tiers) | `ShippingTariffPolicyService.setPolicy` | **no** — no controller, no CLI |
| Platform commission | `CommissionPolicyService.setPolicy` | **no** — no controller, no CLI |
| Commission VAT | `CommissionTaxPolicyService.setPolicy` | **no** — no controller, no CLI |
| Default product VAT | `PUT /admin/settings/tax` | endpoint only — **no UI** |

Only the read side is wired. `ShippingTariffPolicyService.getCurrentPolicy`
fails closed with:

> Shipping tariff has not been configured yet — an administrator must set
> it before checkout is possible

which is the correct behaviour and an accurate message, except that no
administrator can act on it.

`apps/web/app/[locale]/admin/settings/page.tsx` states that tax,
commission and shipping tariffs are *deliberately* excluded from the
settings screen. So this may be intended deferral rather than an
oversight — but either way, **a fresh production install cannot take a
single order**, and there is no supported path to change that.

Consequence for the walkthrough: these rows had to be written directly to
the local development database. That is not a supported operation and
must not be how production is configured.

**Note on scope:** these are append-only tables with triggers blocking
`UPDATE` and `DELETE`. Whatever surface is built must therefore create a
new version, never edit one — and every published opportunity holds a
foreign key to the commission version it froze.

---

## G-K. Policy versions cannot be published through the product

**Status: open. Blocks a production launch.**

`PolicyVersion.isPublished` is only ever **read**. No endpoint anywhere
in `apps/api/src` writes it, and no admin screen offers the action.

Registration is fail-closed by design: with no published mandatory
policy, `POST /auth/register/{role}` returns `503
REGISTRATION_UNAVAILABLE`. Checkout is gated the same way through
`POLICY_REACCEPTANCE_REQUIRED`.

So on a fresh production database **nobody can register and nobody can
buy** until a policy version is published, and there is no supported way
to publish one.

Consequence for the walkthrough: two placeholder policy versions were
published directly in the local development database, with the founder's
explicit approval, scoped to that database only. That is **not** legal
approval of the placeholder text and must not be repeated in production.

---

## G-L. `Cross-Origin-Resource-Policy` blocks every image the API serves

**Status: open. A minimal fix is drafted but deliberately not applied.**

`apps/api/src/bootstrap/configure-app.ts` calls `app.use(helmet())`.
Helmet's default sets:

```http
Cross-Origin-Resource-Policy: same-origin
```

CORS governs whether a script may *read* a response. CORP governs whether
another origin may *embed* it. With `same-origin`, a browser refuses to
render any API-served image inside a page on a different origin:

```text
GET /api/v1/opportunities/:id/image
  → net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
```

Observed in the browser during the walkthrough: the opportunity detail
page rendered correctly in both locales, with a broken image.

This contradicts the platform's own design. `apps/web/lib/media-url.ts`
exists specifically because *"the web app is served from a different
origin"* and builds absolute URLs onto the API origin for exactly this
reason.

Four routes are affected — every image the product displays:

- `GET /api/v1/opportunities/:id/image`
- `GET /api/v1/banners/:id/image`
- `GET /api/v1/admin/banners/:id/image`
- `GET /api/v1/companies/me/products/:productId/media/:mediaId/image`

**Why relaxing CORP on these routes does not weaken authentication.**
CORP is not an access control. Both session cookies are `sameSite: "lax"`
(`common/security/session-cookie.util.ts`,
`admin/admin-auth/admin-session-cookie.util.ts`), and a cross-site `<img>`
is a subresource request, so it carries no cookie and the private routes
answer `401`. The legitimate case still works because SameSite is
evaluated per *site*, not per origin: `localhost:3001` → `localhost:3000`,
and `app.forsa.sa` → `api.forsa.sa`, are same-site and do send the cookie.

Left unapplied pending review, because widening a security header is a
decision to take deliberately rather than during a demo.

---

## G-M. A broken assertion in `notifications.integration-spec.ts`

**Status: open. Pre-existing — NOT introduced by the Phase 8F work, and
deliberately left untouched.**

`test/notifications.integration-spec.ts:104`, in *"a rollback leaves none
of the three"*:

```ts
await prisma.outboxEvent.count({
  where: { eventType: EMAIL_EVENT, payload: { path: ["notificationId"], not: undefined } },
})
```

Two independent problems:

1. **It throws.** `not: undefined` is not a valid Prisma JSON-path
   filter, so the call fails with
   `Invalid prisma.outboxEvent.count() invocation` before it reaches
   the database. The test fails on this line every time it runs.
2. **It asserts nothing.** The expectation is
   `toBeGreaterThanOrEqual(0)`, which any count satisfies. Even if the
   query were valid, the assertion could never fail.

The other two assertions in that test are sound: the transaction is
expected to reject, and `notification.findUnique` is expected to return
null. Only the third is broken.

**Proven pre-existing.** With every Phase 8F change stashed
(`git stash push --include-untracked apps/api/src`), the same test fails
with the identical error. It is not a consequence of the DI imports, the
`updated_at` fix, or the CORP change.

**Not fixed here, on purpose.** The intent is clearly *"no email intent
survives the rollback"*, but writing the assertion that expresses it is a
decision about what the test should guarantee — scoped to this
notification's id, presumably — and quietly rewriting someone else's test
inside an unrelated change is how intent gets lost. Recorded for a
deliberate fix.

**Wider point, shared with G-H:** this file is the one place that covers
the `outbox_events.updated_at` behaviour against a real database, and it
was failing. Nothing in a routine verification runs the integration
suite, so neither the broken assertion nor the defect it sat next to was
visible.
