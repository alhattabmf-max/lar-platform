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
