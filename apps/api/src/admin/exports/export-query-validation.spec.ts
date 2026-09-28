import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { CompanyExportQueryDto } from "./dto/company-export-query.dto";
import { ExportLabelsDto } from "./dto/export-labels.dto";
import { AdminCompaniesQueryDto } from "../directory/dto/admin-list-query.dto";

/**
 * The one arrangement that would have made every export return 400.
 *
 * THE BUG THIS PREVENTS: a route declaring `@Query() a: FiltersDto` and
 * `@Query() b: LabelsDto` gets the WHOLE query object handed to each
 * parameter and validated against each class on its own. With
 * `forbidNonWhitelisted: true` — which this application runs — the
 * filter class rejects `c1`, and the label class rejects `accountType`.
 * Neither is a typing error, so `tsc` is silent, and every export fails
 * the first time a real request carries both halves.
 *
 * The three tests below assert that in order: the broken arrangement
 * really is rejected, the merged class really does accept the same
 * request, and no route has quietly gone back to two.
 */

/** The pipe as `configure-app.ts` builds it, not a lenient stand-in. */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

/** A real export request: the tab, a filter, and the reader's headings. */
const QUERY = {
  accountType: "SUPPLIER",
  verificationStatus: "PENDING_VERIFICATION",
  search: "نور",
  c1: "الاسم النظامي",
  c2: "السجل التجاري",
  c3: "حالة التوثيق",
  fileLabel: "الموردون",
  date: "2026-08-25",
  statuses: "VERIFIED:موثّق",
};

async function validate(metatype: new () => object) {
  return pipe.transform(QUERY, { type: "query", metatype });
}

describe("the export query is one class, not two", () => {
  /** The field names the pipe actually named, not its generic message. */
  async function rejectedFields(metatype: new () => object): Promise<string> {
    try {
      await validate(metatype);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return JSON.stringify((error as BadRequestException).getResponse());
    }
    throw new Error("expected the pipe to reject this query");
  }

  it("REJECTS the request when only the filters are declared", async () => {
    // The headings are what it refuses — which is the whole export.
    expect(await rejectedFields(AdminCompaniesQueryDto)).toMatch(
      /c1|fileLabel|statuses/,
    );
  });

  it("REJECTS the request when only the labels are declared", async () => {
    expect(await rejectedFields(ExportLabelsDto)).toMatch(
      /accountType|verificationStatus|search/,
    );
  });

  it("accepts the same request through the merged class", async () => {
    const result = (await validate(
      CompanyExportQueryDto,
    )) as CompanyExportQueryDto;

    expect(result.accountType).toBe("SUPPLIER");
    expect(result.verificationStatus).toBe("PENDING_VERIFICATION");
    expect(result.search).toBe("نور");
    expect(result.c1).toBe("الاسم النظامي");
    expect(result.fileLabel).toBe("الموردون");
  });

  it("keeps the label helpers after transformation", async () => {
    const result = (await validate(
      CompanyExportQueryDto,
    )) as CompanyExportQueryDto;

    // `transform: true` builds a real instance, so the methods that
    // decode the pairs survive the pipe.
    expect(result.statusLabel("VERIFIED")).toBe("موثّق");
    expect(result.safeDate()).toBe("2026-08-25");
  });

  it("still refuses a filter value outside the shared vocabulary", async () => {
    await expect(
      pipe.transform(
        { ...QUERY, accountType: "ADMIN" },
        { type: "query", metatype: CompanyExportQueryDto },
      ),
    ).rejects.toThrow();
  });

  it("does not accept paging controls an export has no use for", async () => {
    await expect(
      pipe.transform(
        { ...QUERY, page: "2", pageSize: "50" },
        { type: "query", metatype: CompanyExportQueryDto },
      ),
    ).rejects.toThrow();
  });
});
