import type { PrismaClient } from "@prisma/client";

/**
 * Every registration/location-create call now requires a real,
 * ACTIVE, non-Sentinel cityId. This fixture creates one fresh region
 * + city pair per call (unique names, so parallel/sequential test
 * files never collide), and returns the city id to use directly.
 */
export async function ensureTestCity(prisma: PrismaClient): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const region = await prisma.region.create({
    data: { nameAr: `منطقة اختبار ${suffix}`, nameEn: `Test Region ${suffix}` },
  });

  const city = await prisma.city.create({
    data: { regionId: region.id, nameAr: `مدينة اختبار ${suffix}`, nameEn: `Test City ${suffix}` },
  });

  return city.id;
}
