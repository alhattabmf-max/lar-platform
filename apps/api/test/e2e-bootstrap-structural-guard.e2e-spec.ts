import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const TEST_DIR = __dirname;
const HELPER_FILE = "support/create-e2e-application.ts";

describe("Structural guard: E2E bootstrap must go through createE2eApplication", () => {
  it("no *.e2e-spec.ts file calls createNestApplication() directly", () => {
    const specFiles = readdirSync(TEST_DIR).filter((f) => f.endsWith(".e2e-spec.ts") && f !== "e2e-bootstrap-structural-guard.e2e-spec.ts");
    expect(specFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of specFiles) {
      const content = readFileSync(join(TEST_DIR, file), "utf8");
      if (/\.createNestApplication\s*\(/.test(content)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the helper file itself is the only place createNestApplication is called, and always with { rawBody: true }", () => {
    const helperContent = readFileSync(join(TEST_DIR, HELPER_FILE), "utf8");
    expect(helperContent).toContain("createNestApplication({ rawBody: true })");
  });
});
