import { PoliciesService } from "./policies.service";

function fakePrisma(mandatoryVersions: unknown[]) {
  return {
    policyVersion: {
      findMany: jest.fn().mockResolvedValue(mandatoryVersions),
    },
  } as never;
}

describe("PoliciesService.assertMandatoryPoliciesAccepted — fail-closed", () => {
  it("throws (registration unavailable) when zero mandatory published policies exist", async () => {
    const service = new PoliciesService(fakePrisma([]), {} as never);
    await expect(service.assertMandatoryPoliciesAccepted([])).rejects.toMatchObject({
      response: expect.objectContaining({ code: "REGISTRATION_UNAVAILABLE" }),
    });
  });

  it("throws (validation failed) when a mandatory published policy is missing from acceptance", async () => {
    const service = new PoliciesService(fakePrisma([{ id: "policy-1" }]), {} as never);
    await expect(service.assertMandatoryPoliciesAccepted([])).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
  });

  it("succeeds when every mandatory published policy is accepted", async () => {
    const service = new PoliciesService(fakePrisma([{ id: "policy-1" }]), {} as never);
    await expect(
      service.assertMandatoryPoliciesAccepted(["policy-1"])
    ).resolves.toEqual([{ id: "policy-1" }]);
  });
});

/**
 * WHICH VERSION IS IN FORCE, once publishing became possible.
 *
 * A published version is immutable and permanent: `policy_versions` has
 * a trigger that raises on any update to a published row and on any
 * delete of one. So an earlier version cannot be withdrawn — it stays
 * published forever — and "in force" cannot be a flag. It is whichever
 * published version of a document is NEWEST, decided on every read.
 *
 * The failure this prevents is concrete: the moment real terms replace
 * the placeholder, every registering company would otherwise have to
 * tick TWO boxes for one document and consent to text no longer in use.
 */
function versionRow(over: Record<string, unknown>) {
  return {
    id: "v",
    policyDocumentId: "doc-terms",
    versionLabel: "v1",
    textAr: "نصّ",
    textEn: "text",
    isMandatory: true,
    isPublished: true,
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    policyDocument: { code: "terms_of_service" },
    ...over,
  };
}

describe("the version in force is the newest published one", () => {
  const build = (rows: unknown[]) =>
    new PoliciesService(
      {
        policyVersion: { findMany: jest.fn().mockResolvedValue(rows) },
      } as never,
      {} as never,
    );

  it("returns ONE row per document to the public viewer", async () => {
    const service = build([
      versionRow({ id: "old", publishedAt: new Date("2026-01-01") }),
      versionRow({ id: "new", publishedAt: new Date("2026-06-01") }),
    ]);

    const active = await service.getActivePolicyVersions();

    // Two published rows, one document, one section on the page.
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("new");
  });

  it("keeps every distinct document", async () => {
    const service = build([
      versionRow({ id: "terms", policyDocumentId: "doc-terms" }),
      versionRow({
        id: "privacy",
        policyDocumentId: "doc-privacy",
        policyDocument: { code: "privacy_policy" },
      }),
    ]);

    const active = await service.getActivePolicyVersions();

    expect(active.map((row) => row.id).sort()).toEqual(["privacy", "terms"]);
  });

  it("asks a registrant to accept the newest mandatory version only", async () => {
    const service = build([
      versionRow({ id: "old", publishedAt: new Date("2026-01-01") }),
      versionRow({ id: "new", publishedAt: new Date("2026-06-01") }),
    ]);

    // Accepting only the version actually shown must be enough.
    await expect(
      service.assertMandatoryPoliciesAccepted(["new"]),
    ).resolves.toHaveLength(1);
  });

  it("still refuses when the accepted version is the withdrawn-in-practice one", async () => {
    const service = build([
      versionRow({ id: "old", publishedAt: new Date("2026-01-01") }),
      versionRow({ id: "new", publishedAt: new Date("2026-06-01") }),
    ]);

    await expect(
      service.assertMandatoryPoliciesAccepted(["old"]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
  });

  it("breaks a tie on creation, then on id, so two reads never disagree", async () => {
    const sameMoment = new Date("2026-06-01T00:00:00.000Z");
    const service = build([
      versionRow({ id: "aaa", publishedAt: sameMoment, createdAt: sameMoment }),
      versionRow({ id: "zzz", publishedAt: sameMoment, createdAt: sameMoment }),
    ]);

    // A registrant shown one version and checked against the other
    // cannot complete registration at all.
    const first = await service.getActivePolicyVersions();
    const second = await service.getActivePolicyVersions();
    expect(first[0].id).toBe("zzz");
    expect(second[0].id).toBe(first[0].id);
  });
});
