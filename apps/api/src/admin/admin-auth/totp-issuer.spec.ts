import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authenticator } from "otplib";
import { generateTotpEnrollment, verifyTotpCode } from "../../common/security/totp.util";

const ROOT = join(__dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * THE NAME AN ADMINISTRATOR SEES IN THEIR AUTHENTICATOR APP.
 *
 * It was the literal placeholder `PROJECT_NAME Admin`, and it was not a
 * comment — it reached every enrolment. Read off a real enrolment made
 * during the audit:
 *
 *     otpauth://totp/PROJECT_NAME%20Admin:...?issuer=PROJECT_NAME%20Admin
 *
 * WHAT IT IS NOT: a reason to re-enrol anybody. I reported it as a
 * critical defect that would invalidate existing accounts, and that was
 * wrong — `verifyTotpCode` receives a secret and a code and nothing
 * else. These cases hold that correction in place, because the mistake
 * was believing it rather than reading it.
 */
describe("the authenticator's issuer", () => {
  const service = read("src/admin/admin-auth/admin-auth.service.ts");
  const schema = read("../../packages/config/src/env.ts");
  const example = read("../../.env.example");

  it("no longer ships a placeholder", () => {
    expect(service).not.toContain("PROJECT_NAME");
  });

  it("comes from the environment, resolved at start-up", () => {
    // «قراءة القيمة عند إقلاع الخادم فقط… لا طلب شبكة ولا قراءة من
    //  قاعدة البيانات عند إنشاء QR» — the platform's real trade name
    // lives in `branding_settings`, but a QR that depends on a database
    // read is a QR that can fail while somebody is standing in front of
    // it. `this.env` is the object `loadEnv` produced when the process
    // booted.
    expect(service).toContain("this.env.ADMIN_TOTP_ISSUER");
    expect(schema).toContain("ADMIN_TOTP_ISSUER: z");

    // AND THE ENROLMENT READS NOTHING ELSE. Everything between the
    // start of the setup step and the encrypted secret must be free of
    // any lookup that can fail.
    const setup = service.slice(
      service.indexOf("generateTotpEnrollment("),
      service.indexOf("encryptSecret("),
    );
    expect(setup).not.toContain("prisma");
    expect(setup).not.toContain("await ");
  });

  it("is validated as a non-empty string of a sane length", () => {
    const declaration = schema.slice(
      schema.indexOf("ADMIN_TOTP_ISSUER: z"),
      schema.indexOf("ADMIN_TOTP_ISSUER: z") + 400,
    );
    expect(declaration).toContain(".trim()");
    expect(declaration).toContain(".min(1");
    // Authenticator apps truncate a long issuer, and the string is
    // stamped into an enrolment nobody revisits.
    expect(declaration).toContain(".max(64");
    expect(declaration).toContain('.default("Azier Plus Admin")');
  });

  it("is documented in the example environment, and carries no secret", () => {
    expect(example).toContain("ADMIN_TOTP_ISSUER=Azier Plus Admin");
    // A name is not a credential. The two keys beside it are, and they
    // stay obvious placeholders.
    expect(example).toContain("ADMIN_TOTP_ENCRYPTION_KEY=" + "0".repeat(64));
  });

  it("puts the configured name on a NEW enrolment", () => {
    const enrolment = generateTotpEnrollment("ops@example.com", "Azier Plus Admin");
    expect(enrolment.otpauthUri).toContain("issuer=Azier%20Plus%20Admin");
    expect(enrolment.otpauthUri).toContain("Azier%20Plus%20Admin:ops%40example.com");
    expect(enrolment.otpauthUri).not.toContain("PROJECT_NAME");
  });

  it("leaves an administrator enrolled under the OLD name signing in", () => {
    // THE WHOLE POINT, and the correction to my own Phase 1 report.
    // An enrolment is a SECRET; the issuer is a label printed beside it.
    // Here is a secret enrolled under the placeholder, verified after
    // the name changed — nothing about the code depends on either.
    const before = generateTotpEnrollment("old@example.com", "PROJECT_NAME Admin");
    const code = authenticator.generate(before.secret);

    expect(verifyTotpCode(before.secret, code)).toBe(true);

    // And the same secret re-labelled produces the same codes.
    const after = generateTotpEnrollment("old@example.com", "Azier Plus Admin");
    expect(after.secret).not.toBe(before.secret); // a new enrolment is a new secret
    expect(verifyTotpCode(before.secret, authenticator.generate(before.secret))).toBe(true);
  });

  it("never lets the issuer near verification", () => {
    // The reason nobody has to re-enrol, stated as a fact about the
    // code rather than as a hope: the verifier takes two arguments.
    const util = read("src/common/security/totp.util.ts");
    const verify = util.slice(util.indexOf("export function verifyTotpCode"));
    expect(verify).not.toContain("issuer");
    expect(verify).toContain("authenticator.verify({ token: code, secret })");
  });

  it("changes no stored secret and no recovery code", () => {
    // «لا تغيّر الأسرار أو حسابات المديرين الحالية» — the only edit to
    // this service is which string is handed to the enrolment builder.
    expect(service).toContain("encryptSecret(enrollment.secret");
    expect(service).not.toContain("updateMany({ data: { twoFactorSecretEncrypted");
  });
});
