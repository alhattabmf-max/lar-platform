import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const json = (relative: string) =>
  JSON.parse(read(relative).replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;

/**
 * THE BUILD LEAVES SOMETHING BEHIND TO RUN.
 *
 * «مشكلة تشغيل API بعد البناء» — reproduced three times before it was
 * understood, and each time it looked like this:
 *
 *     $ npm run build        # exits 0
 *     $ npm run start:dev
 *     Error: Cannot find module 'apps\api\dist\main'
 *
 * TWO SETTINGS DISAGREEING ABOUT WHO OWNS `dist`. `nest-cli.json` sets
 * `deleteOutDir`, so every build and every start wipes the directory.
 * `incremental` had TypeScript keeping its record of what it had already
 * emitted OUTSIDE that directory, at the package root. So the compiler
 * read a record saying "all of this is emitted", emitted nothing, printed
 * `Found 0 errors`, and left `dist` empty.
 *
 * THE FIX IS WHERE THE RECORD SITS, not a step anybody has to remember:
 * inside `dist`, so deleting the output deletes the claim that the
 * output exists. Reverting just that one line brings the failure
 * straight back — measured: `Cannot find module` once, `dist/main.js`
 * missing, `/health` unreachable.
 */
describe("the build leaves something behind to run", () => {
  const nestCli = json("nest-cli.json");
  const buildConfig = json("tsconfig.build.json");
  const compiler = buildConfig.compilerOptions as Record<string, unknown>;

  it("puts the incremental record inside the directory it describes", () => {
    const info = String(compiler.tsBuildInfoFile ?? "");
    expect(info).toBe("./dist/tsconfig.build.tsbuildinfo");

    // THE INVARIANT, stated rather than assumed: whatever the output
    // directory is, the record must live under it.
    const outDir = String(
      (json("tsconfig.json").compilerOptions as Record<string, unknown>).outDir ?? "",
    ).replace(/^\.\//, "");
    expect(info.replace(/^\.\//, "").startsWith(outDir + "/")).toBe(true);
  });

  it("still deletes the output directory, which is why the record must be in it", () => {
    // Removing `deleteOutDir` would ALSO fix the crash — by leaving
    // stale JavaScript behind for a renamed or deleted source file,
    // which is a worse problem and a quieter one.
    const options = nestCli.compilerOptions as Record<string, unknown>;
    expect(options.deleteOutDir).toBe(true);
    expect(options.tsConfigPath).toBe("tsconfig.build.json");
  });

  it("keeps incremental compilation on", () => {
    // The owner's condition: «لا تعطّل البناء التزايدي للمشروع كاملًا
    // دون مبرر». A watch session keeps its state in the running
    // process, so nothing it relies on is lost — what is lost is a
    // first compile that trusts a record of files somebody deleted,
    // which was never a saving.
    const base = json("tsconfig.json").compilerOptions as Record<string, unknown>;
    expect(base.incremental).toBe(true);
  });

  it("verifies the output after every build, not by eye", () => {
    // `nest build` exits 0 with an empty `dist`, so the exit code is
    // not evidence. This guard is what turned the failure from a
    // mystery at start-up into a failure at build time — but it only
    // runs through `npm run build`, never through `start:dev`.
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.postbuild).toContain("verify-build-output.mjs dist/main.js");
  });

  it("does not paper over it with a manual delete", () => {
    // «وليس بحذف يدوي يعتمد عليه المطور كل مرة» — nothing in the
    // scripts removes a build record before compiling.
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    for (const [name, script] of Object.entries(pkg.scripts)) {
      expect([name, script.includes("tsbuildinfo")]).toEqual([name, false]);
    }
  });
});
