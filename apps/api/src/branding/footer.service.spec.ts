import { DEFAULT_FOOTER_CONFIG, type FooterConfig } from "@platform/types";
import { FooterService, FOOTER_DRAFT_KEY } from "./footer.service";
import { BusinessException } from "../common/errors/business-exception";

/**
 * The footer service.
 *
 * TWO PROPERTIES CARRY THE WEIGHT HERE, and most of this file is about
 * them:
 *
 *   · IT NEVER THROWS ON READ. This renders on every public page
 *     including the front door and the sign-in screen. A missing row, a
 *     corrupted value, a database outage and a policies outage all have
 *     to degrade to the footer the platform shipped with — never to an
 *     empty bar and never to an error page.
 *
 *   · A LINK TO AN UNPUBLISHED POLICY IS NOT RENDERED. Enabling the
 *     Terms link records that an operator wants it; whether a published
 *     Terms document exists is a fact about the database. A visitor
 *     must never be shown a legal link that leads to nothing.
 */

const CTX = {
  actorId: "admin-1",
  requestId: "req-1",
  ipAddress: "127.0.0.1",
  userAgent: "jest",
};

const published = (config: unknown) => ({ footer: config });

describe("FooterService", () => {
  let prisma: {
    brandingSettings: { findUnique: jest.Mock; upsert: jest.Mock };
    systemSetting: { findUnique: jest.Mock; upsert: jest.Mock; delete: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: { log: jest.Mock };
  let policies: { getActivePolicyVersions: jest.Mock };
  let service: FooterService;

  beforeEach(() => {
    prisma = {
      brandingSettings: {
        findUnique: jest.fn().mockResolvedValue({ headerFooterConfig: null }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    policies = {
      getActivePolicyVersions: jest.fn().mockResolvedValue([
        { documentCode: "terms_of_service" },
        { documentCode: "privacy_policy" },
      ]),
    };
    service = new FooterService(
      prisma as never,
      audit as never,
      policies as never,
    );
    jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);
  });

  describe("reading the published footer never fails", () => {
    it("serves the shipped default when no branding row exists", async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue(null);

      await expect(service.getPublished()).resolves.toEqual(
        DEFAULT_FOOTER_CONFIG,
      );
    });

    it("serves the shipped default when the column is empty", async () => {
      await expect(service.getPublished()).resolves.toEqual(
        DEFAULT_FOOTER_CONFIG,
      );
    });

    it("serves the shipped default when the stored value is malformed", async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue({
        headerFooterConfig: published({ links: "not an array" }),
      });

      await expect(service.getPublished()).resolves.toEqual(
        DEFAULT_FOOTER_CONFIG,
      );
    });

    it("serves the shipped default when the database is down", async () => {
      prisma.brandingSettings.findUnique.mockRejectedValue(
        new Error("connection refused"),
      );

      await expect(service.getPublished()).resolves.toEqual(
        DEFAULT_FOOTER_CONFIG,
      );
    });

    it("serves what was actually published when it is well formed", async () => {
      const stored: FooterConfig = {
        ...DEFAULT_FOOTER_CONFIG,
        copyrightAr: "جميع الحقوق محفوظة",
      };
      prisma.brandingSettings.findUnique.mockResolvedValue({
        headerFooterConfig: published(stored),
      });

      await expect(service.getPublished()).resolves.toEqual(stored);
    });
  });

  describe("what a visitor is served", () => {
    it("drops a disabled link rather than hiding it", async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue({
        headerFooterConfig: published({
          ...DEFAULT_FOOTER_CONFIG,
          links: [
            { page: "about", labelAr: null, labelEn: null, enabled: true },
            { page: "faq", labelAr: null, labelEn: null, enabled: false },
          ],
        }),
      });

      const view = await service.getPublic("ar-SA");
      expect(view.links.map((l) => l.key)).toEqual(["about"]);
    });

    it("keeps the operator's order", async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue({
        headerFooterConfig: published({
          ...DEFAULT_FOOTER_CONFIG,
          links: [
            { page: "contact", labelAr: null, labelEn: null, enabled: true },
            { page: "about", labelAr: null, labelEn: null, enabled: true },
            { page: "faq", labelAr: null, labelEn: null, enabled: true },
          ],
        }),
      });

      const view = await service.getPublic("ar-SA");
      expect(view.links.map((l) => l.key)).toEqual(["contact", "about", "faq"]);
    });

    it("drops the Terms link when no Terms document is published", async () => {
      policies.getActivePolicyVersions.mockResolvedValue([
        { documentCode: "privacy_policy" },
      ]);

      const view = await service.getPublic("ar-SA");
      expect(view.links.map((l) => l.key)).not.toContain("terms");
      expect(view.links.map((l) => l.key)).toContain("privacy");
    });

    it("drops BOTH policy links when nothing is published", async () => {
      policies.getActivePolicyVersions.mockResolvedValue([]);

      const view = await service.getPublic("ar-SA");
      expect(view.links.map((l) => l.key)).toEqual(["about", "faq", "contact"]);
    });

    it("keeps the rest of the footer when policies cannot be read at all", async () => {
      policies.getActivePolicyVersions.mockRejectedValue(new Error("down"));

      const view = await service.getPublic("ar-SA");
      expect(view.links.map((l) => l.key)).toEqual(["about", "faq", "contact"]);
    });

    it("addresses a policy by its code, never by a version id", async () => {
      const view = await service.getPublic("ar-SA");
      const terms = view.links.find((l) => l.key === "terms");
      expect(terms?.href).toBe("/policies#policy-terms-of-service");
    });

    it("returns Arabic text to an Arabic reader and English to an English one", async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue({
        headerFooterConfig: published({
          ...DEFAULT_FOOTER_CONFIG,
          links: [
            { page: "about", labelAr: "من نحن", labelEn: "About", enabled: true },
          ],
          contact: {
            email: null,
            phone: null,
            addressAr: "الرياض",
            addressEn: "Riyadh",
          },
          copyrightAr: "حقوق محفوظة",
          copyrightEn: "All rights reserved",
        }),
      });

      const ar = await service.getPublic("ar-SA");
      expect(ar.links[0].label).toBe("من نحن");
      expect(ar.address).toBe("الرياض");
      expect(ar.copyright).toBe("حقوق محفوظة");

      const en = await service.getPublic("en-SA");
      expect(en.links[0].label).toBe("About");
      expect(en.address).toBe("Riyadh");
      expect(en.copyright).toBe("All rights reserved");
    });

    /**
     * NO FALLBACK BETWEEN LANGUAGES. An override written for one
     * audience must not appear to the other — the app's own translated
     * name is the right answer there, and `null` is how the renderer is
     * told to use it.
     */
    it("does not fall back to the other language's label", async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue({
        headerFooterConfig: published({
          ...DEFAULT_FOOTER_CONFIG,
          links: [
            { page: "about", labelAr: "من نحن", labelEn: null, enabled: true },
          ],
        }),
      });

      const en = await service.getPublic("en-SA");
      expect(en.links[0].label).toBeNull();
    });

    it("drops a disabled social account", async () => {
      prisma.brandingSettings.findUnique.mockResolvedValue({
        headerFooterConfig: published({
          ...DEFAULT_FOOTER_CONFIG,
          social: [
            { network: "x", url: "https://x.com/forsa", enabled: true },
            {
              network: "linkedin",
              url: "https://linkedin.com/company/forsa",
              enabled: false,
            },
          ],
        }),
      });

      const view = await service.getPublic("ar-SA");
      expect(view.social).toEqual([
        { network: "x", url: "https://x.com/forsa" },
      ]);
    });

    it("serves the shipped five links on a platform nobody has configured", async () => {
      const view = await service.getPublic("ar-SA");
      expect(view.links.map((l) => l.key)).toEqual([
        "about",
        "faq",
        "contact",
        "terms",
        "privacy",
      ]);
      expect(view.links.every((l) => l.label === null)).toBe(true);
    });
  });

  describe("saving a draft", () => {
    it("refuses a configuration the contract will not store", async () => {
      await expect(
        service.saveDraft({ links: "not an array" }, CTX),
      ).rejects.toBeInstanceOf(BusinessException);
      expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it("refuses a social link that is not on that network", async () => {
      await expect(
        service.saveDraft(
          {
            ...DEFAULT_FOOTER_CONFIG,
            social: [
              { network: "x", url: "https://evil.example/f", enabled: true },
            ],
          },
          CTX,
        ),
      ).rejects.toBeInstanceOf(BusinessException);
    });

    it("writes NOTHING public — the draft is a settings row", async () => {
      await service.saveDraft(DEFAULT_FOOTER_CONFIG, CTX);

      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: FOOTER_DRAFT_KEY } }),
      );
      expect(prisma.brandingSettings.upsert).not.toHaveBeenCalled();
    });

    it("records the change with its before and after", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: { links: [] },
        updatedAt: new Date(),
      });

      await service.saveDraft(DEFAULT_FOOTER_CONFIG, CTX);

      const [entry] = audit.log.mock.calls[0];
      expect(entry.action).toBe("FOOTER_DRAFT_SAVED");
      expect(entry.actorId).toBe("admin-1");
      expect(entry.before).toBeDefined();
      expect(entry.after).toBeDefined();
    });
  });

  describe("publishing", () => {
    it("refuses when there is no draft", async () => {
      await expect(service.publish(CTX)).rejects.toBeInstanceOf(
        BusinessException,
      );
      expect(prisma.brandingSettings.upsert).not.toHaveBeenCalled();
    });

    /**
     * The value being validated on publish came out of the DATABASE,
     * not off the wire — so it is checked again rather than trusted
     * because it was checked when it was saved.
     */
    it("refuses a draft that has become malformed since it was saved", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: { links: "not an array" },
        updatedAt: new Date(),
      });

      await expect(service.publish(CTX)).rejects.toBeInstanceOf(
        BusinessException,
      );
      expect(prisma.brandingSettings.upsert).not.toHaveBeenCalled();
    });

    it("validates and writes inside ONE transaction", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: DEFAULT_FOOTER_CONFIG,
        updatedAt: new Date(),
      });

      await service.publish(CTX);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    /**
     * The column is named for the header AND the footer. Writing the
     * footer over the whole value would leave no room for the header
     * without a migration later.
     */
    it("preserves anything else stored beside the footer in that column", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: DEFAULT_FOOTER_CONFIG,
        updatedAt: new Date(),
      });
      prisma.brandingSettings.findUnique.mockResolvedValue({
        headerFooterConfig: { header: { kept: true }, footer: { old: true } },
      });

      await service.publish(CTX);

      const written =
        prisma.brandingSettings.upsert.mock.calls[0][0].update
          .headerFooterConfig;
      expect(written.header).toEqual({ kept: true });
      expect(written.footer).toEqual(DEFAULT_FOOTER_CONFIG);
    });

    it("keeps the draft, so the screen still has something to edit", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: DEFAULT_FOOTER_CONFIG,
        updatedAt: new Date(),
      });

      await service.publish(CTX);
      expect(prisma.systemSetting.delete).not.toHaveBeenCalled();
    });

    it("records the publish", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: DEFAULT_FOOTER_CONFIG,
        updatedAt: new Date(),
      });

      await service.publish(CTX);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "FOOTER_PUBLISHED" }),
      );
    });
  });

  describe("discarding a draft", () => {
    it("refuses when there is none", async () => {
      await expect(service.discardDraft(CTX)).rejects.toBeInstanceOf(
        BusinessException,
      );
    });

    it("changes nothing public", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: DEFAULT_FOOTER_CONFIG,
        updatedAt: new Date(),
      });

      await service.discardDraft(CTX);
      expect(prisma.systemSetting.delete).toHaveBeenCalled();
      expect(prisma.brandingSettings.upsert).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "FOOTER_DRAFT_DISCARDED" }),
      );
    });
  });

  describe("the console's view", () => {
    it("reports no draft when the stored draft is malformed", async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: { links: "not an array" },
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const view = await service.getAdminView();
      expect(view.draft).toBeNull();
    });

    it("names which policies are published, so the screen can warn", async () => {
      policies.getActivePolicyVersions.mockResolvedValue([
        { documentCode: "privacy_policy" },
      ]);

      const view = await service.getAdminView();
      expect(view.publishedPolicyCodes).toEqual(["privacy_policy"]);
    });
  });
});
