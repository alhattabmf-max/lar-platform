/**
 * REMOVES WHAT THIS SEEDER MADE, AND NOTHING ELSE.
 *
 * «جاي عند أسمائها عبوة الجملة، احذفها من أسامي المنتجات، وش فايدتها.»
 *
 * A LIVE OFFER LOCKS ITS PRODUCT — the service refuses any edit while
 * an offer is published, which is correct: a buyer looking at an offer
 * must not have the goods renamed under them. So the name cannot be
 * corrected in place; the rows are rebuilt.
 *
 * IT DELETES BY THE SUFFIX IT WROTE. Every product this seeder created
 * ends in «— عبوة الجملة», so nothing the owner made by hand is inside
 * the net, whatever else is in the database.
 *
 * IT REFUSES TO RUN IF ANY OF IT WAS SOLD. Funded quantity, a checkout
 * session or an order against one of these offers means it is no longer
 * seed data, and deleting it would be deleting somebody's purchase.
 *
 *   pnpm --filter @platform/api exec ts-node src/cli/reset-seeded-catalogue.ts
 */
import { PrismaClient } from "@prisma/client";

const COMPANY_ID = "77a156f8-d8e4-4cc4-bbbd-ff004f5639ec";
const SEEDED_SUFFIX = "— عبوة الجملة";

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  const products = await prisma.product.findMany({
    where: { companyId: COMPANY_ID, nameAr: { endsWith: SEEDED_SUFFIX } },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);
  if (productIds.length === 0) {
    console.log("nothing seeded to remove");
    await prisma.$disconnect();
    return;
  }

  const offers = await prisma.opportunity.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, fundedQuantity: true },
  });
  const offerIds = offers.map((o) => o.id);

  // THE GUARD, BEFORE ANYTHING IS TOUCHED.
  const sold = offers.filter((o) => o.fundedQuantity > 0).length;
  const carts = await prisma.checkoutSession.count({
    where: { opportunityId: { in: offerIds } },
  });
  if (sold > 0 || carts > 0) {
    throw new Error(
      `Refusing to delete: ${sold} offer(s) have sold quantity and ${carts} checkout session(s) exist`,
    );
  }

  const removed = await prisma.$transaction(async (tx) => {
    const opportunities = await tx.opportunity.deleteMany({
      where: { id: { in: offerIds } },
    });
    const media = await tx.productMedia.deleteMany({
      where: { productId: { in: productIds } },
    });
    const snapshots = await tx.productApprovalSnapshot.deleteMany({
      where: { productId: { in: productIds } },
    });
    const removedProducts = await tx.product.deleteMany({
      where: { id: { in: productIds } },
    });
    return {
      opportunities: opportunities.count,
      media: media.count,
      snapshots: snapshots.count,
      products: removedProducts.count,
    };
  });

  console.log(JSON.stringify(removed, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
