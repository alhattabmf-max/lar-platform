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

`MediaPolicyService` holds `maxImagesPerProduct`, `maxSizeBytes`,
`allowedTypes` and `maxPixels`, all admin-configurable. No endpoint
exposes them.

The supplier UI therefore states **no numeric limit** and relies on the
server's refusal to say what went wrong. That is correct today — an
invented number is worse than none — but a read endpoint would let the
form warn before a large upload is sent.

---

## G-E. Opportunity duration and quantity bounds are not readable either

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
