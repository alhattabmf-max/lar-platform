import { isValidGtin, type CreateProductRequest } from "@platform/types";

export const PRODUCT_IMPORT_COLUMNS = [
  "taxonomyNodeId", "nameAr", "nameEn", "salesUnitNameAr", "salesUnitNameEn",
  "weightPerUnit", "lengthCm", "widthCm", "heightCm", "descriptionAr",
  "descriptionEn", "packageContentQuantity", "packageContentUnitNameAr",
  "packageContentUnitNameEn", "supplierSku", "gtin", "images",
  "directStock", "directUnitPrice", "directLocationId", "directPreparationDays",
] as const;

export interface DirectImportListing {
  saleMode: "DIRECT";
  targetQuantity: number;
  unitPriceAmount: number;
  fulfillmentLocationId: string;
  expectedPreparationDays: number;
}

export interface ProductImportRow {
  line: number;
  product: CreateProductRequest;
  imageNames: string[];
  direct?: DirectImportListing;
}

/** RFC-style quoted CSV cells, including commas, escaped quotes and line breaks. */
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = source.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Unclosed quoted cell");
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requiredText = ["nameAr", "nameEn", "salesUnitNameAr", "salesUnitNameEn"] as const;
const decimalFields = ["weightPerUnit", "lengthCm", "widthCm", "heightCm"] as const;

export function parseProductImport(source: string, validTaxonomyIds: ReadonlySet<string>, validLocationIds?: ReadonlySet<string>): ProductImportRow[] {
  const [header, ...rows] = parseCsv(source);
  if (!header) throw new Error("Missing header");
  const columns = header.map((cell) => cell.trim());
  if (new Set(columns).size !== columns.length || PRODUCT_IMPORT_COLUMNS.some((key) => !columns.includes(key))) {
    throw new Error("Missing or duplicate template columns");
  }
  if (rows.length === 0 || rows.length > 100) throw new Error("Choose 1 to 100 products per file");

  return rows.map((cells, index) => {
    const line = index + 2;
    const value = (key: typeof PRODUCT_IMPORT_COLUMNS[number]) => (cells[columns.indexOf(key)] ?? "").trim();
    if (cells.length !== columns.length) throw new Error(`Row ${line}: wrong number of columns`);
    const taxonomyNodeId = value("taxonomyNodeId");
    if (!uuid.test(taxonomyNodeId) || !validTaxonomyIds.has(taxonomyNodeId)) {
      throw new Error(`Row ${line}: select an active category ID`);
    }
    for (const key of requiredText) if (!value(key)) throw new Error(`Row ${line}: ${key} is required`);
    const number = (key: typeof decimalFields[number] | "packageContentQuantity") => {
      const raw = value(key);
      if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) || Number(raw) <= 0 || !Number.isFinite(Number(raw))) {
        throw new Error(`Row ${line}: ${key} must be a positive decimal`);
      }
      return Number(raw);
    };
    const product: CreateProductRequest = {
      taxonomyNodeId, nameAr: value("nameAr"), nameEn: value("nameEn"),
      salesUnitNameAr: value("salesUnitNameAr"), salesUnitNameEn: value("salesUnitNameEn"),
      weightPerUnit: number("weightPerUnit"), lengthCm: number("lengthCm"),
      widthCm: number("widthCm"), heightCm: number("heightCm"),
    };
    if (value("descriptionAr")) product.descriptionAr = value("descriptionAr");
    if (value("descriptionEn")) product.descriptionEn = value("descriptionEn");
    if (value("supplierSku")) product.supplierSku = value("supplierSku");
    if (value("gtin")) {
      if (!isValidGtin(value("gtin"))) throw new Error(`Row ${line}: invalid GTIN check digit`);
      product.gtin = value("gtin");
    }
    const packageFields = [value("packageContentQuantity"), value("packageContentUnitNameAr"), value("packageContentUnitNameEn")];
    if (packageFields.some(Boolean)) {
      if (packageFields.some((part) => !part)) throw new Error(`Row ${line}: package content needs quantity and both unit names`);
      product.packageContentQuantity = number("packageContentQuantity");
      product.packageContentUnitNameAr = packageFields[1];
      product.packageContentUnitNameEn = packageFields[2];
    }
    const imageNames = value("images").split("|").map((name) => name.trim()).filter(Boolean);
    if (imageNames.length === 0) throw new Error(`Row ${line}: at least one product image is required`);
    if (imageNames.some((name) => name.includes("/") || name.includes("\\")) || new Set(imageNames).size !== imageNames.length) {
      throw new Error(`Row ${line}: image names must be unique filenames`);
    }
    const directValues = [value("directStock"), value("directUnitPrice"), value("directLocationId"), value("directPreparationDays")];
    let direct: DirectImportListing | undefined;
    if (directValues.some(Boolean)) {
      if (directValues.some((part) => !part)) throw new Error(`Row ${line}: direct sale needs stock, unit price, location and preparation days`);
      const positiveInteger = (raw: string, key: string) => {
        if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`Row ${line}: ${key} must be a positive integer`);
        return Number(raw);
      };
      const price = directValues[1];
      if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(price) || Number(price) <= 0 || Number(price) > 9999999999.99) {
        throw new Error(`Row ${line}: directUnitPrice must be a positive price with at most two decimals`);
      }
      if (!uuid.test(directValues[2]) || !validLocationIds?.has(directValues[2])) throw new Error(`Row ${line}: select one of your fulfillment location IDs`);
      direct = {
        saleMode: "DIRECT", targetQuantity: positiveInteger(directValues[0], "directStock"),
        unitPriceAmount: Number(price), fulfillmentLocationId: directValues[2],
        expectedPreparationDays: positiveInteger(directValues[3], "directPreparationDays"),
      };
    }
    return { line, product, imageNames, ...(direct ? { direct } : {}) };
  });
}

export function productImportTemplate(): string {
  return PRODUCT_IMPORT_COLUMNS.join(",") + "\n";
}
