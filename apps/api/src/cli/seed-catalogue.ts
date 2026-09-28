/**
 * ONE PRODUCT AND ONE PUBLISHED OFFER PER CATEGORY BRANCH.
 *
 * «تضيف لي لكل فرع من التصنيفات منتجًا بصورة للمنتج وتسوي نشر عرض لها
 *  كلها، وبعدها أنا أشيّك المنصة.»
 *
 * IT GOES THROUGH THE PLATFORM'S OWN SERVICES, never through Prisma.
 * A published offer freezes a share tier, a commission rate and a tax
 * calculation onto itself, and those are computed by the code that owns
 * them — writing the rows by hand would mean re-deriving money in a
 * seeding script, which is the one place a copy must never drift.
 *
 * AND IT NEEDS NO PASSWORD. The services take an actor context — a user
 * id and a company id — because authentication is the HTTP layer's job,
 * not theirs. This runs on the machine that owns the database.
 *
 * IT IS IDEMPOTENT BY NAME: a branch that already has a product from
 * this script is skipped, so it can be re-run after a failure without
 * doubling anything.
 *
 *   pnpm --filter @platform/api exec ts-node src/cli/seed-catalogue.ts
 */
import { NestFactory } from "@nestjs/core";
import sharp from "sharp";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { ProductsService } from "../products/products.service";
import { ProductMediaService } from "../products/product-media.service";
import { OpportunitiesService } from "../opportunities/opportunities.service";
import { CompaniesService } from "../companies/companies.service";

/** «محمد فهد» — CR 11223344, a verified supplier. */
const COMPANY_ID = "77a156f8-d8e4-4cc4-bbbd-ff004f5639ec";
const USER_ID = "bea69ccc-03d8-483d-8148-0a4495d5c8d3";

/**
 * WHICH CITY EACH BRANCH TAKES.
 *
 * A BRANCH WITHOUT ONE CANNOT CARRY A PUBLISHED OFFER. The eligibility
 * rule allows it — «a branch with no city passes» — but the database
 * refuses any opportunity outside DRAFT/CANCELLED whose
 * `fulfillment_city_id` is null. Both of this company's branches had
 * none, so nothing could ever have been published from them.
 *
 * AND THE CITY HAS TO BE ONE THAT IS SWITCHED ON: 9 of 153 are, which
 * is the operator's own decision from the console.
 */
const BRANCH_CITIES: { locationId: string; cityId: string; label: string }[] = [
  {
    locationId: "e691bdbc-018f-4b80-a446-36e26ebda125",
    cityId: "1e268d3c-95bd-4e16-9776-b48a0afb1fe4",
    label: "الياس → الدمام",
  },
  {
    locationId: "65bf29c9-1336-4887-a422-f6bbfc5f5d0a",
    cityId: "968e1dd4-018a-42e4-b0f3-df4573882cef",
    label: "الفرع الرئيسي → نجران",
  },
];

/** A card the size of a product photo, in the platform's own colours. */
async function drawImage(nameAr: string, index: number): Promise<Buffer> {
  // THE HUE WALKS so thirty-six cards are not one card thirty-six
  // times — a listing where every picture is identical tells a reader
  // nothing about whether the page is working.
  const hue = Math.round((index * 360) / 36);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="hsl(${hue} 42% 88%)"/>
          <stop offset="100%" stop-color="hsl(${hue} 38% 72%)"/>
        </linearGradient>
      </defs>
      <rect width="900" height="900" fill="url(#g)"/>
      <rect x="250" y="300" width="400" height="300" rx="14"
            fill="#ffffff" stroke="#b45309" stroke-width="6"/>
      <path d="M250 380 H650" stroke="#b45309" stroke-width="6"/>
      <path d="M420 300 V380" stroke="#b45309" stroke-width="6"/>
      <path d="M480 300 V380" stroke="#b45309" stroke-width="6"/>
      <text x="450" y="700" text-anchor="middle"
            font-family="Segoe UI, Tahoma, sans-serif" font-size="44"
            fill="#0b1f33" direction="rtl">${escapeXml(nameAr)}</text>
    </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  const prisma = app.get(PrismaService);
  const products = app.get(ProductsService);
  const media = app.get(ProductMediaService);
  const offers = app.get(OpportunitiesService);
  const companies = app.get(CompaniesService);

  const ctx = {
    userId: USER_ID,
    companyId: COMPANY_ID,
    requestId: `seed-${Date.now()}`,
  };

  // ------------------------------------------------------------ 1
  // The branches get a city, so an offer can name one.
  for (const b of BRANCH_CITIES) {
    const before = await prisma.companyLocation.findUnique({
      where: { id: b.locationId },
      select: { cityId: true },
    });
    if (before?.cityId) {
      console.log(`branch kept: ${b.label} (already has a city)`);
      continue;
    }
    await companies.updateLocation(b.locationId, { cityId: b.cityId }, ctx);
    console.log(`branch set:  ${b.label}`);
  }

  const location = BRANCH_CITIES[0].locationId;

  // ------------------------------------------------------------ 2
  // Every active branch of the taxonomy, in the operator's own order.
  const nodes = await prisma.taxonomyNode.findMany({
    where: { isActive: true, parentId: { not: null } },
    select: { id: true, nameAr: true, nameEn: true, parentId: true },
    orderBy: { sortOrder: "asc" },
  });

  const unit = await prisma.salesUnit.findFirst({ where: { isActive: true } });
  if (!unit) throw new Error("No active sales unit to sell by");

  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let made = 0;
  let skipped = 0;
  const failures: { name: string; step: string; message: string }[] = [];

  for (const [i, node] of nodes.entries()) {
    // THE BRANCH NAME AND NOTHING APPENDED — «جاي عند أسمائها عبوة
    //  الجملة، احذفها من أسامي المنتجات، وش فايدتها». It said what
    // the whole platform already says: everything here is sold
    // wholesale, by the pallet, in the quantity the offer names.
    const nameAr = node.nameAr;
    const existing = await prisma.product.findFirst({
      where: { companyId: COMPANY_ID, taxonomyNodeId: node.id },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      console.log(`skip ${i + 1}/${nodes.length}: ${node.nameAr}`);
      continue;
    }

    let step = "create";
    try {
      const product = await products.create(
        {
          taxonomyNodeId: node.id,
          salesUnitId: unit.id,
          salesUnitNameAr: unit.nameAr,
          salesUnitNameEn: unit.nameEn,
          packageContentQuantity: 24,
          packageContentUnitNameAr: "حبة",
          packageContentUnitNameEn: "Piece",
          nameAr,
          nameEn: node.nameEn,
          descriptionAr: `${node.nameAr} تُباع بال${unit.nameAr}.`,
          descriptionEn: `${node.nameEn}, sold by the ${unit.nameEn}.`,
          weightPerUnit: 12.5,
          lengthCm: 60,
          widthCm: 40,
          heightCm: 35,
        },
        ctx,
      );

      step = "image";
      await media.upload(product.id, await drawImage(node.nameAr, i), ctx);

      // A PRODUCT WITH NO MAIN IMAGE FAILS THE TECHNICAL CHECK, so the
      // picture goes on BEFORE the submission rather than after it.
      step = "submit";
      await products.submit(product.id, ctx);

      step = "offer";
      const offer = await offers.create(
        {
          productId: product.id,
          fulfillmentLocationId: location,
          targetQuantity: 100 + i * 10,
          unitPriceAmount: Number((45 + i * 3.5).toFixed(2)),
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          expectedPreparationDays: 3,
          descriptionAr: `عرض جملة على ${node.nameAr}.`,
          descriptionEn: `A wholesale offer on ${node.nameEn}.`,
        },
        ctx,
      );

      step = "publish";
      await offers.publish(offer.id, ctx);

      made += 1;
      console.log(`done ${i + 1}/${nodes.length}: ${node.nameAr}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ name: node.nameAr, step, message });
      console.log(`FAIL ${i + 1}/${nodes.length}: ${node.nameAr} [${step}] ${message}`);
    }
  }

  console.log(
    JSON.stringify({ branches: nodes.length, made, skipped, failures }, null, 2),
  );

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
