import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { ListOpportunitiesQueryDto } from "./dto/list-opportunities-query.dto";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * THE ONE SEARCH FIELD, AS THE SERVER ANSWERS IT.
 *
 * «حقل بحث بجانب أيقونة الإشعارات» — and the owner's two decisions
 * about what it does: «كلٌّ يبحث في عالمه» and «الاسم والوصف معًا».
 *
 * BEFORE THIS THE LISTING TOOK NO TEXT AT ALL. Its query accepted a
 * region, a city, a taxonomy node, a product id, a sort and a page —
 * which is why the chrome carried a comment saying a search field could
 * not be built yet rather than a search field.
 */
describe("the listing accepts a search term", () => {
  const service = read("src/opportunities/opportunity-discovery.service.ts");

  const parse = (query: Record<string, unknown>) =>
    plainToInstance(ListOpportunitiesQueryDto, query);

  it("trims it, and an empty box is not a filter", async () => {
    // A form submitted with nothing in it asks for the unfiltered list,
    // not for the offers whose name contains nothing.
    expect(parse({ q: "  أسمنت  " }).q).toBe("أسمنت");
    expect(parse({ q: "   " }).q).toBe("");
    expect(service).toContain("if (query.q) {");
  });

  it("refuses a term longer than the field can send", async () => {
    // The field stops at a hundred characters, so a request past that
    // came from something other than the field.
    expect(await validate(parse({ q: "a".repeat(100) }))).toHaveLength(0);
    expect(await validate(parse({ q: "a".repeat(101) }))).toHaveLength(1);
  });

  it("matches the name AND the description, both locales, both sources", () => {
    // «الاسم والوصف معًا» — the product's name and description as
    // FROZEN at approval, and the offer's own note. Never the live
    // product row: the page displays the snapshot, so searching
    // anything else could match a name nobody can see.
    for (const field of [
      "s.snapshot->>'nameAr'",
      "s.snapshot->>'nameEn'",
      "s.snapshot->>'descriptionAr'",
      "s.snapshot->>'descriptionEn'",
      "o.description_ar",
      "o.description_en",
    ]) {
      expect([field, service.includes(field)]).toEqual([field, true]);
    }
    expect(service).not.toContain("p.name_ar");
  });

  it("matches case-insensitively, which is why Postgres does it", () => {
    // Prisma's JSON `string_contains` is case-SENSITIVE and rejects
    // `mode: "insensitive"` on a JSON path outright — confirmed against
    // this database, not assumed. A search for "cement" that misses
    // "Cement" is not a search.
    expect(service).toContain("ILIKE");
    // THE CODE FORM, not the word: the comment above the query names
    // the rejected filter to say WHY Postgres does the matching, and a
    // guard on the bare word would forbid its own explanation.
    expect(service).not.toContain("string_contains:");
  });

  it("never lets a term reach the SQL as SQL", () => {
    // It is bound as a parameter, and its LIKE metacharacters are
    // escaped first — a reader typing `%` would otherwise match every
    // offer on the platform.
    const escape = service.slice(
      service.indexOf("const pattern ="),
      service.indexOf("$queryRaw"),
    );
    expect(escape).toContain('.replace(/%/g, "\\\\%")');
    expect(escape).toContain('.replace(/_/g, "\\\\_")');
    // THE BACKSLASH FIRST, or it doubles the escapes it just added.
    expect(escape.indexOf('/\\\\/g')).toBeLessThan(escape.indexOf('/%/g'));
  });

  it("searches only what the reader could already see", () => {
    // The prefilter carries the visibility statuses, so it can never
    // surface a draft, a cancelled offer or another company's work —
    // and the set it returns is bounded by the live listings rather
    // than by the whole table.
    const matcher = service.slice(service.indexOf("private async idsMatching"));
    expect(matcher).toContain('o.status = ANY(');
    expect(matcher).toContain('statuses');
  });

  it("answers an unmatched term with nothing, not with everything", () => {
    // `in: []` matches no rows. Falling back to the unfiltered list
    // would tell a reader their word matched every offer on the
    // platform.
    expect(service).toContain("where.id = { in: await this.idsMatching(");
  });
});
