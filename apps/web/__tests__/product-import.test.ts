import { describe, expect, it } from "vitest";
import { parseCsv, parseProductImport, productImportTemplate } from "@/lib/product-import";

const category = "123e4567-e89b-42d3-a456-426614174000";
const row = `${category},اسم,"Name, with comma",قطعة,Piece,1.25,12,8,4,وصف,Description,,,,SKU-1,12345670,main.jpg|side.png`;

describe("bulk product CSV", () => {
  it("reads quotes, escaped quotes and line breaks without splitting a product", () => {
    expect(parseCsv('a,b\n"one, ""quoted""\nline",two\n')).toEqual([
      ["a", "b"], ["one, \"quoted\"\nline", "two"],
    ]);
  });

  it("maps a row to the existing product create contract and image names", () => {
    const rows = parseProductImport(productImportTemplate() + row, new Set([category]));
    expect(rows).toHaveLength(1);
    expect(rows[0].product).toMatchObject({ taxonomyNodeId: category, nameEn: "Name, with comma", weightPerUnit: 1.25, supplierSku: "SKU-1", gtin: "12345670" });
    expect(rows[0].imageNames).toEqual(["main.jpg", "side.png"]);
  });

  it("rejects unknown categories and missing images before creating any rows", () => {
    expect(() => parseProductImport(productImportTemplate() + row, new Set())).toThrow(/category/);
    expect(() => parseProductImport(productImportTemplate() + row.replace("main.jpg|side.png", ""), new Set([category]))).toThrow(/image/);
  });

  it("refuses duplicate columns and malformed package groups", () => {
    expect(() => parseProductImport(productImportTemplate().replace("images", "nameAr") + row, new Set([category]))).toThrow(/columns/);
    expect(() => parseProductImport(productImportTemplate() + row.replace(",,,,SKU-1", ",3,,,SKU-1"), new Set([category]))).toThrow();
  });

  it("rejects a GTIN with an invalid check digit", () => {
    expect(() => parseProductImport(productImportTemplate() + row.replace("12345670", "12345671"), new Set([category]))).toThrow(/GTIN/);
  });
});
