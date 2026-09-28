-- FOUR IDENTITIES, ONE COMPANY EACH.
--
-- The owner's rule: a commercial registration number, an email
-- address, a mobile number and a tax registration number each belong
-- to exactly one company, at registration and at every later edit.
--
-- TWO OF THE FOUR WERE ALREADY ENFORCED — `companies.cr_number` and
-- `users.email` have carried unique indexes since the beginning. These
-- are the other two, and they are what let the application NAME the
-- field that collided instead of guessing: the constraint reports the
-- column it fired on, and that is the only thing the refusal reads.
--
-- WHY A PLAIN UNIQUE INDEX IS ENOUGH:
--
--   · `primary_mobile_1` is NOT NULL and no row holds an empty string,
--     so there is nothing for a partial predicate to exclude.
--   · `vat_number` is nullable, and Postgres treats NULLs as distinct
--     — every company that is not VAT-registered keeps its NULL, and
--     only two companies claiming the SAME number are refused.
--
-- `primary_mobile_2` IS DELIBERATELY NOT HERE. It is a second contact
-- line rather than an identity, and 56 rows leave it as an empty
-- string; a unique index would read those as duplicates of each other.
-- Enforcing it needs a partial index and a decision about what an
-- empty second number means, and neither is settled.
--
-- THE DATA WAS MADE UNIQUE FIRST, in the same session: 48 accounts
-- that were sharing eight mobile numbers were separated, and 19
-- seeded tax profiles that shared one number were given their own.
-- The oldest row in each group kept the value it had.

CREATE UNIQUE INDEX "users_primary_mobile_1_key"
  ON "users" ("primary_mobile_1");

CREATE UNIQUE INDEX "supplier_tax_profiles_vat_number_key"
  ON "supplier_tax_profiles" ("vat_number");

CREATE UNIQUE INDEX "trader_tax_profiles_vat_number_key"
  ON "trader_tax_profiles" ("vat_number");
