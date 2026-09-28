import type { PrismaClient } from "@prisma/client";

/** A region and, under it, a city — the two ids a branch is created with. */
export interface TestPlace {
  regionId: string;
  cityId: string;
}

/**
 * A fresh region + city pair per call (unique names, so parallel test
 * files never collide).
 *
 * THE REGION IS NOW THE PART THAT MATTERS. A branch is required to sit
 * in a region and may name a city under it; registration itself no
 * longer carries either, because it no longer creates a branch at all.
 * Callers that build a branch need both ids, which is why this exists
 * beside `ensureTestCity`.
 */
export async function ensureTestPlace(prisma: PrismaClient): Promise<TestPlace> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const region = await prisma.region.create({
    data: { nameAr: `منطقة اختبار ${suffix}`, nameEn: `Test Region ${suffix}` },
  });

  const city = await prisma.city.create({
    data: { regionId: region.id, nameAr: `مدينة اختبار ${suffix}`, nameEn: `Test City ${suffix}` },
  });

  return { regionId: region.id, cityId: city.id };
}

/** The city alone, for callers that only need somewhere to point at. */
export async function ensureTestCity(prisma: PrismaClient): Promise<string> {
  const { cityId } = await ensureTestPlace(prisma);
  return cityId;
}
