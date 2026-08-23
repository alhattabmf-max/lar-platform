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

describe("the API is exactly the size 8E leaves it", () => {
  it("has 215 endpoints", () => {
    // 203 after 8D, +12 in 8E: one product image, three supplier order reads,
    // two settlements, four notifications, two replacement reads, one dispute
    // list, one product detail — minus the two legacy raw-row supplier order
    // routes this batch deleted. 12 net additions, 14 gross.
    const total = CONTROLLERS.reduce((sum, c) => sum + c.methods.length, 0);
    expect(total).toBe(215);
  });

  it("added no schema change — the migration count is unchanged", () => {
    const migrations = readdirSync(join(SRC, "..", "prisma", "migrations")).filter(
      (entry) =>
        /^\d/.test(entry) && statSync(join(SRC, "..", "prisma", "migrations", entry)).isDirectory()
    );
    expect(migrations).toHaveLength(90);
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
      for (const controller of SUPPLIER.filter((c) => c.basePath === basePath)) {
        expect([controller.file, controller.guards]).toEqual([
          controller.file,
          expect.stringContaining("SessionAuthGuard"),
        ]);
        expect([controller.file, controller.guards]).toEqual([
          controller.file,
          expect.stringContaining("RequireSupplierGuard"),
        ]);
      }
    }
  );

  it("guards every supplier controller without exception", () => {
    for (const controller of SUPPLIER) {
      expect([controller.basePath, controller.guards.includes("SessionAuthGuard")]).toEqual([
        controller.basePath,
        true,
      ]);
      expect([controller.basePath, controller.guards.includes("RequireSupplierGuard")]).toEqual([
        controller.basePath,
        true,
      ]);
    }
  });

  it("carries CsrfGuard exactly where a write exists, and nowhere else", () => {
    // The provider exempts safe methods, so a read-only controller does not
    // need it — and adding it anyway would suggest a write that is not there.
    for (const controller of SUPPLIER) {
      const writes = controller.methods.filter((m) => !m.startsWith("@Get"));
      expect([controller.basePath, controller.guards.includes("CsrfGuard")]).toEqual([
        controller.basePath,
        writes.length > 0,
      ]);
    }
  });

  it("keeps the product image route behind the same two guards", () => {
    // It is not under `supplier/`, but it serves a supplier's private media —
    // a product may be a DRAFT that was never published.
    const image = CONTROLLERS.find((c) =>
      c.basePath === "companies/me/products/:productId/media"
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

      expect([file, source.includes("session.companyId")]).toEqual([file, true]);
      expect([file, /@Param\(\s*"companyId"/.test(source)]).toEqual([file, false]);
      expect([file, /@Query\(\s*"companyId"/.test(source)]).toEqual([file, false]);
      expect([file, /@Body\(\s*"companyId"/.test(source)]).toEqual([file, false]);
    }
  });
});

describe("the legacy raw-row supplier order reads are gone", () => {
  it("removed the controller entirely", () => {
    // Leaving it registered would have meant two handlers on the same paths,
    // one of them returning traderCompanyId and a Decimal totalAmount.
    expect(FILES.some((f) => f.endsWith(join("orders", "orders.controller.ts")))).toBe(false);
  });

  it("removed the service methods that fed it", () => {
    const service = strip(readFileSync(join(SRC, "orders", "orders.service.ts"), "utf8"));

    expect(service).not.toContain("listForSupplier");
    expect(service).not.toContain("getForSupplier");
    // The admin reads stay — they are a different audience with a different
    // boundary.
    expect(service).toContain("listForAdmin");
  });

  it("serves supplier orders only from the projected controller", () => {
    const orderControllers = CONTROLLERS.filter((c) => c.basePath === "supplier/orders");

    expect(orderControllers).toHaveLength(1);
    expect(orderControllers[0].file).toContain("supplier-reads.controller.ts");
    expect(orderControllers[0].methods).toHaveLength(3);
  });
});
