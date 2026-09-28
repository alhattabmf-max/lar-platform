/**
 * PUBLISHES THE OFFERS THE SHARE POLICY SENT BACK.
 *
 * Five of thirty-six were refused at publish: «The target quantity
 * cannot be evenly split into whole shares under the current policy.
 * Try: 360 (lower) or 380 (higher).» The refusal NAMES the nearest
 * valid quantities, so this reads the number out of the platform's own
 * sentence and asks again rather than guessing at the arithmetic.
 *
 * WHY NOT COMPUTE IT HERE: the share tier is resolved from a pinned
 * policy version against the offer's total value including tax — a
 * second implementation of that in a seeding script is a copy that goes
 * stale the first time a tier changes. The service already knows; it
 * just needs to be asked with a number it accepts.
 *
 *   pnpm --filter @platform/api exec ts-node src/cli/publish-remaining-offers.ts
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { OpportunitiesService } from "../opportunities/opportunities.service";

const COMPANY_ID = "77a156f8-d8e4-4cc4-bbbd-ff004f5639ec";
const USER_ID = "bea69ccc-03d8-483d-8148-0a4495d5c8d3";

/** The lower of the two quantities the refusal offers, when it offers any. */
function suggestedQuantity(message: string): number | null {
  const match = /Try:\s*(\d+)\s*\(lower\)/.exec(message);
  return match ? Number(match[1]) : null;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const prisma = app.get(PrismaService);
  const offers = app.get(OpportunitiesService);
  const ctx = {
    userId: USER_ID,
    companyId: COMPANY_ID,
    requestId: `seed-retry-${Date.now()}`,
  };

  const drafts = await prisma.opportunity.findMany({
    where: { companyId: COMPANY_ID, status: "DRAFT" },
    select: {
      id: true,
      targetQuantity: true,
      product: { select: { nameAr: true } },
    },
  });

  let published = 0;
  const failures: { name: string; message: string }[] = [];

  for (const draft of drafts) {
    const name = draft.product.nameAr;
    try {
      await offers.publish(draft.id, ctx);
      published += 1;
      console.log(`published: ${name}`);
      continue;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const quantity = suggestedQuantity(message);
      if (quantity === null) {
        failures.push({ name, message });
        console.log(`FAIL ${name}: ${message}`);
        continue;
      }
      // ONE RETRY, WITH THE PLATFORM'S OWN NUMBER.
      try {
        await offers.update(draft.id, { targetQuantity: quantity }, ctx);
        await offers.publish(draft.id, ctx);
        published += 1;
        console.log(`published: ${name} (quantity ${draft.targetQuantity} → ${quantity})`);
      } catch (retryErr) {
        const retryMessage =
          retryErr instanceof Error ? retryErr.message : String(retryErr);
        failures.push({ name, message: retryMessage });
        console.log(`FAIL ${name}: ${retryMessage}`);
      }
    }
  }

  console.log(JSON.stringify({ drafts: drafts.length, published, failures }, null, 2));
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
