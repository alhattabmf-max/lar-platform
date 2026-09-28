import { Injectable, Logger } from "@nestjs/common";
import { AuditActorType, type Prisma } from "@prisma/client";
import {
  DEFAULT_FOOTER_CONFIG,
  ERROR_CODES,
  FOOTER_PAGES,
  isFooterConfig,
  type FooterConfig,
  type FooterPublic,
  type FooterSocialPublic,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { PoliciesService } from "../policies/policies.service";

/**
 * The site footer's configuration.
 *
 * THREE STATES, no new table and no migration — the same shape the
 * brand theme uses, deliberately, so an operator who has published a
 * theme already knows how this works:
 *
 *   PUBLISHED  branding_settings.header_footer_config — what visitors see
 *   DRAFT      system_settings["footer_config_draft"] — the working copy
 *   DEFAULT    DEFAULT_FOOTER_CONFIG, a code constant
 *
 * The column is the one the requirement named. It has existed on the
 * singleton branding row since the table was created and has never had
 * a reader: `BrandingPublic` and `AdminBrandingView` both exclude it in
 * writing, because it was a free-form JSON blob and rendering
 * unvalidated JSON into a page is a stored-XSS surface. That objection
 * is answered rather than waived — `isFooterConfig` gives the column a
 * closed shape, and NOTHING here writes a value that has not passed it.
 *
 * IT IS NOT ADDED TO `BrandingPublic`. That contract carries an
 * exact-key test precisely so a field cannot slip into it, and the
 * footer is a different question from the brand's identity. It is
 * served by its own public route.
 *
 * FAIL-SAFE ON EVERY AXIS. A missing row, a malformed value, and a
 * database failure all resolve to the shipped five links. A footer that
 * cannot be read must degrade to the footer the platform had before it
 * was configurable — never to an empty bar, and never to an error page,
 * since this renders on every public page including the front door.
 */

export const FOOTER_DRAFT_KEY = "footer_config_draft";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Draft plus published, as the console screen needs them side by side. */
export interface FooterAdminView {
  published: FooterConfig;
  /** Null when nothing has been drafted since the last publish. */
  draft: FooterConfig | null;
  draftUpdatedAt: string | null;
  /**
   * The policy documents that are actually published right now.
   *
   * The screen needs this to warn that an enabled Terms link will not
   * appear. Codes only — never a version id, never any text.
   */
  publishedPolicyCodes: string[];
}

@Injectable()
export class FooterService {
  private readonly logger = new Logger(FooterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policies: PoliciesService,
  ) {}

  /**
   * The published configuration, or the shipped default.
   *
   * Never throws. See the fail-safe note above.
   */
  async getPublished(): Promise<FooterConfig> {
    try {
      const row = await this.prisma.brandingSettings.findUnique({
        where: { singletonKey: "default" },
        select: { headerFooterConfig: true },
      });
      const stored = (row?.headerFooterConfig as { footer?: unknown } | null)
        ?.footer;
      if (stored === undefined || stored === null) {
        return DEFAULT_FOOTER_CONFIG;
      }
      if (!isFooterConfig(stored)) {
        this.logger.error(
          "[fail-safe] branding_settings.header_footer_config.footer is malformed — serving the default footer",
        );
        return DEFAULT_FOOTER_CONFIG;
      }
      return stored;
    } catch (err) {
      this.logger.error(
        `[fail-safe] Failed to read the footer configuration, serving the default: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
      return DEFAULT_FOOTER_CONFIG;
    }
  }

  /**
   * The footer a visitor gets, with the operator's intentions already
   * resolved against reality.
   *
   * TWO THINGS ARE DECIDED HERE rather than in the browser:
   *
   *   · a disabled entry is gone, not hidden with CSS;
   *   · a link to a policy that is not published is gone. Configuration
   *     records that an operator WANTS the terms in the footer;
   *     whether a published terms document exists is a fact about the
   *     database. Enabling a link cannot conjure a document, and a
   *     visitor must never be shown a legal link that leads to an empty
   *     page.
   *
   * `locale` picks which language's text is returned, with NO FALLBACK
   * to the other: an Arabic reader gets the Arabic override or the
   * app's own Arabic wording, never an English label the operator typed
   * for a different audience.
   */
  async getPublic(locale: "ar-SA" | "en-SA"): Promise<FooterPublic> {
    const config = await this.getPublished();
    const arabic = locale === "ar-SA";

    let publishedCodes = new Set<string>();
    try {
      const versions = await this.policies.getActivePolicyVersions();
      publishedCodes = new Set(versions.map((v) => v.documentCode));
    } catch (err) {
      // A policies outage must not remove the whole footer. The two
      // policy links drop out; everything else still renders.
      this.logger.error(
        `[fail-safe] Failed to read published policies for the footer: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
    }

    const links = config.links
      .filter((link) => link.enabled)
      .filter((link) => {
        const page = FOOTER_PAGES[link.page];
        const code = "policyCode" in page ? page.policyCode : undefined;
        return code === undefined || publishedCodes.has(code);
      })
      .map((link) => {
        const page = FOOTER_PAGES[link.page];
        const code = "policyCode" in page ? page.policyCode : undefined;
        // The fragment is derived from the document code, so the link
        // survives a new version being published under the same code —
        // a version-id link would rot on the first revision.
        const anchor = code ? `#policy-${code.replace(/_/g, "-")}` : "";
        return {
          key: link.page,
          href: `${page.path}${anchor}`,
          label: (arabic ? link.labelAr : link.labelEn) ?? null,
        };
      });

    const social: FooterSocialPublic[] = config.social
      .filter((entry) => entry.enabled)
      .map((entry) => ({ network: entry.network, url: entry.url }));

    return {
      links,
      social,
      email: config.contact.email,
      phone: config.contact.phone,
      address: arabic ? config.contact.addressAr : config.contact.addressEn,
      copyright: arabic ? config.copyrightAr : config.copyrightEn,
      showDescription: config.showDescription,
    };
  }

  /** Published, draft, and which policies actually exist. */
  async getAdminView(): Promise<FooterAdminView> {
    const [published, draftRow, versions] = await Promise.all([
      this.getPublished(),
      this.prisma.systemSetting.findUnique({ where: { key: FOOTER_DRAFT_KEY } }),
      this.policies.getActivePolicyVersions(),
    ]);

    let draft: FooterConfig | null = null;
    if (draftRow && isFooterConfig(draftRow.value)) {
      draft = draftRow.value;
    } else if (draftRow) {
      this.logger.error(
        `[fail-safe] system_settings["${FOOTER_DRAFT_KEY}"] is malformed — reporting no draft`,
      );
    }

    return {
      published,
      draft,
      draftUpdatedAt: draftRow?.updatedAt.toISOString() ?? null,
      publishedPolicyCodes: versions.map((v) => v.documentCode),
    };
  }

  /**
   * Saves a draft.
   *
   * Refused unless it passes the contract in full. Unlike the brand
   * theme — where a low-contrast draft is saved so the operator can see
   * the warning while experimenting — there is no partial failure here
   * worth preserving: every rule this validates is structural, and a
   * stored value that breaks one is a value nothing can render.
   */
  async saveDraft(input: unknown, ctx: ActorContext): Promise<FooterConfig> {
    if (!isFooterConfig(input)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "The footer configuration is not in a shape this platform will store",
      );
    }

    const before = await this.prisma.systemSetting.findUnique({
      where: { key: FOOTER_DRAFT_KEY },
    });

    await this.prisma.systemSetting.upsert({
      where: { key: FOOTER_DRAFT_KEY },
      create: {
        key: FOOTER_DRAFT_KEY,
        value: input as unknown as Prisma.InputJsonValue,
        updatedBy: ctx.actorId,
      },
      update: {
        value: input as unknown as Prisma.InputJsonValue,
        updatedBy: ctx.actorId,
      },
    });

    await this.log("FOOTER_DRAFT_SAVED", FOOTER_DRAFT_KEY, before?.value, input, ctx);
    return input;
  }

  /**
   * Promotes the draft into the branding row, atomically.
   *
   * Read-validate-write happens inside ONE transaction so a concurrent
   * draft save cannot land between the check and the write and publish
   * a value that was never validated.
   *
   * THE DRAFT IS KEPT. Clearing it would mean the screen has nothing to
   * show as "what I am editing" straight after a publish, and the next
   * edit would start from scratch. Draft and published being equal is
   * the normal state after publishing.
   */
  async publish(ctx: ActorContext): Promise<FooterConfig> {
    const published = await this.prisma.$transaction(async (tx) => {
      const draftRow = await tx.systemSetting.findUnique({
        where: { key: FOOTER_DRAFT_KEY },
      });
      if (!draftRow) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "There is no footer draft to publish",
        );
      }
      if (!isFooterConfig(draftRow.value)) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "The footer draft is not in a shape this platform will publish",
        );
      }
      const config = draftRow.value;

      const existing = await tx.brandingSettings.findUnique({
        where: { singletonKey: "default" },
        select: { headerFooterConfig: true },
      });
      // The column is a JSON object with a `footer` member rather than
      // the footer itself. Its name says header AND footer: writing the
      // footer over the whole column would leave no room for the header
      // without a migration later, and merging preserves anything a
      // future surface stores beside it.
      const merged = {
        ...((existing?.headerFooterConfig as Record<string, unknown> | null) ??
          {}),
        footer: config,
      };

      await tx.brandingSettings.upsert({
        where: { singletonKey: "default" },
        create: {
          singletonKey: "default",
          headerFooterConfig: merged as unknown as Prisma.InputJsonValue,
          updatedBy: ctx.actorId,
        },
        update: {
          headerFooterConfig: merged as unknown as Prisma.InputJsonValue,
          updatedBy: ctx.actorId,
        },
      });

      return config;
    });

    await this.log("FOOTER_PUBLISHED", "branding_settings", undefined, published, ctx);
    return published;
  }

  /**
   * Discards the draft, returning the screen to the published footer.
   *
   * Nothing public changes — this is the "I have changed my mind"
   * control, and it is recorded like every other change.
   */
  async discardDraft(ctx: ActorContext): Promise<void> {
    const before = await this.prisma.systemSetting.findUnique({
      where: { key: FOOTER_DRAFT_KEY },
    });
    if (!before) {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        "There is no footer draft to discard",
      );
    }
    await this.prisma.systemSetting.delete({ where: { key: FOOTER_DRAFT_KEY } });
    await this.log(
      "FOOTER_DRAFT_DISCARDED",
      FOOTER_DRAFT_KEY,
      before.value,
      null,
      ctx,
    );
  }

  private async log(
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
    ctx: ActorContext,
  ): Promise<void> {
    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action,
      entityType: "branding_footer",
      entityId,
      before:
        before === undefined
          ? undefined
          : ({ value: before } as Prisma.InputJsonValue),
      after: { value: after } as unknown as Prisma.InputJsonValue,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
