-- The regions and governorates of Saudi Arabia.
--
-- REFERENCE DATA, NOT SCHEMA. Not one column is added, altered or
-- dropped here; this migration only inserts rows the platform cannot
-- work without. A branch form that offers one city is not a form.
--
-- NOTHING IS OVERWRITTEN AND NOTHING IS DUPLICATED. Every insert is
-- guarded by NOT EXISTS on the Arabic name, so the rows somebody
-- already added by hand through the console keep their own ids and
-- every company_location already pointing at them stays valid. Run it
-- twice and the second run inserts nothing.
--
-- The list is the 13 regions and their governorates. It is a floor,
-- not a ceiling: the console's reference-data screen adds more.

-- منطقة الرياض
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة الرياض', 'Riyadh Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة الرياض');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الرياض', 'Riyadh', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الرياض');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الدرعية', 'Diriyah', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الدرعية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الخرج', 'Al Kharj', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الخرج');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الدوادمي', 'Ad Dawadimi', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الدوادمي');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'المجمعة', 'Al Majmaah', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'المجمعة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'القويعية', 'Al Quwayiyah', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'القويعية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'وادي الدواسر', 'Wadi ad-Dawasir', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'وادي الدواسر');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الأفلاج', 'Al Aflaj', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الأفلاج');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الزلفي', 'Az Zulfi', true, 8, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الزلفي');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'شقراء', 'Shaqra', true, 9, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'شقراء');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'حوطة بني تميم', 'Hotat Bani Tamim', true, 10, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'حوطة بني تميم');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'عفيف', 'Afif', true, 11, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'عفيف');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'السليل', 'As Sulayyil', true, 12, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'السليل');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'ضرما', 'Dhurma', true, 13, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'ضرما');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'المزاحمية', 'Al Muzahimiyah', true, 14, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'المزاحمية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'رماح', 'Rumah', true, 15, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'رماح');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'ثادق', 'Thadiq', true, 16, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'ثادق');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'حريملاء', 'Huraymila', true, 17, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'حريملاء');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الحريق', 'Al Hariq', true, 18, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الحريق');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الغاط', 'Al Ghat', true, 19, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الغاط');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'مرات', 'Marat', true, 20, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الرياض'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'مرات');

-- منطقة مكة المكرمة
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة مكة المكرمة', 'Makkah Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة مكة المكرمة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'مكة المكرمة', 'Makkah', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'مكة المكرمة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'جدة', 'Jeddah', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'جدة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الطائف', 'Taif', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الطائف');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'القنفذة', 'Al Qunfudhah', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'القنفذة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الليث', 'Al Lith', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الليث');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'رابغ', 'Rabigh', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'رابغ');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الجموم', 'Al Jumum', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الجموم');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'خليص', 'Khulais', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'خليص');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الكامل', 'Al Kamil', true, 8, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الكامل');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الخرمة', 'Al Khurmah', true, 9, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الخرمة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'رنية', 'Ranyah', true, 10, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'رنية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'تربة', 'Turubah', true, 11, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'تربة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'أضم', 'Adham', true, 12, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'أضم');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'المويه', 'Al Muwayh', true, 13, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'المويه');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'ميسان', 'Maysan', true, 14, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'ميسان');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'العرضيات', 'Al Ardiyat', true, 15, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'العرضيات');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بحرة', 'Bahrah', true, 16, now()
FROM "regions" r WHERE r.name_ar = 'منطقة مكة المكرمة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بحرة');

-- المنطقة الشرقية
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'المنطقة الشرقية', 'Eastern Province', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'المنطقة الشرقية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الدمام', 'Dammam', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الدمام');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الخبر', 'Al Khobar', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الخبر');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الظهران', 'Dhahran', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الظهران');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الأحساء', 'Al Ahsa', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الأحساء');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الهفوف', 'Hofuf', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الهفوف');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'المبرز', 'Al Mubarraz', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'المبرز');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'القطيف', 'Qatif', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'القطيف');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'سيهات', 'Saihat', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'سيهات');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'صفوى', 'Safwa', true, 8, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'صفوى');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'تاروت', 'Tarout', true, 9, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'تاروت');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الجبيل', 'Jubail', true, 10, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الجبيل');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'حفر الباطن', 'Hafar Al Batin', true, 11, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'حفر الباطن');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الخفجي', 'Khafji', true, 12, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الخفجي');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'رأس تنورة', 'Ras Tanura', true, 13, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'رأس تنورة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بقيق', 'Abqaiq', true, 14, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بقيق');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'النعيرية', 'An Nuayriyah', true, 15, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'النعيرية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'قرية العليا', 'Qaryat Al Ulya', true, 16, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'قرية العليا');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'العديد', 'Al Udayd', true, 17, now()
FROM "regions" r WHERE r.name_ar = 'المنطقة الشرقية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'العديد');

-- منطقة المدينة المنورة
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة المدينة المنورة', 'Madinah Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة المدينة المنورة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'المدينة المنورة', 'Madinah', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة المدينة المنورة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'المدينة المنورة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'ينبع', 'Yanbu', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة المدينة المنورة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'ينبع');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'العلا', 'AlUla', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة المدينة المنورة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'العلا');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'مهد الذهب', 'Mahd adh Dhahab', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة المدينة المنورة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'مهد الذهب');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الحناكية', 'Al Hanakiyah', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة المدينة المنورة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الحناكية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بدر', 'Badr', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة المدينة المنورة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بدر');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'خيبر', 'Khaybar', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة المدينة المنورة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'خيبر');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'العيص', 'Al Ais', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'منطقة المدينة المنورة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'العيص');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'وادي الفرع', 'Wadi Al Fara', true, 8, now()
FROM "regions" r WHERE r.name_ar = 'منطقة المدينة المنورة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'وادي الفرع');

-- منطقة القصيم
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة القصيم', 'Qassim Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة القصيم');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بريدة', 'Buraydah', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بريدة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'عنيزة', 'Unaizah', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'عنيزة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الرس', 'Ar Rass', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الرس');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'المذنب', 'Al Mithnab', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'المذنب');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'البكيرية', 'Al Bukayriyah', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'البكيرية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'البدائع', 'Al Badai', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'البدائع');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الأسياح', 'Al Asyah', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الأسياح');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'النبهانية', 'An Nabhaniyah', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'النبهانية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'عيون الجواء', 'Uyun Al Jiwa', true, 8, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'عيون الجواء');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الشماسية', 'Ash Shimasiyah', true, 9, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الشماسية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'رياض الخبراء', 'Riyadh Al Khabra', true, 10, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'رياض الخبراء');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'عقلة الصقور', 'Uqlat As Suqur', true, 11, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'عقلة الصقور');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'ضرية', 'Dariyah', true, 12, now()
FROM "regions" r WHERE r.name_ar = 'منطقة القصيم'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'ضرية');

-- منطقة عسير
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة عسير', 'Asir Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة عسير');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'أبها', 'Abha', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'أبها');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'خميس مشيط', 'Khamis Mushait', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'خميس مشيط');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بيشة', 'Bisha', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بيشة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'النماص', 'An Namas', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'النماص');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'محايل عسير', 'Muhayil Asir', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'محايل عسير');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'ظهران الجنوب', 'Dhahran Al Janub', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'ظهران الجنوب');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'تثليث', 'Tathlith', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'تثليث');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'سراة عبيدة', 'Sarat Abidah', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'سراة عبيدة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'رجال ألمع', 'Rijal Almaa', true, 8, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'رجال ألمع');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'أحد رفيدة', 'Ahad Rufaidah', true, 9, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'أحد رفيدة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'المجاردة', 'Al Majaridah', true, 10, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'المجاردة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'البرك', 'Al Birk', true, 11, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'البرك');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بلقرن', 'Balqarn', true, 12, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بلقرن');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'تنومة', 'Tanumah', true, 13, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'تنومة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بارق', 'Bariq', true, 14, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بارق');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'طريب', 'Tarib', true, 15, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'طريب');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'وادي بن هشبل', 'Wadi Bin Hashbal', true, 16, now()
FROM "regions" r WHERE r.name_ar = 'منطقة عسير'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'وادي بن هشبل');

-- منطقة تبوك
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة تبوك', 'Tabuk Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة تبوك');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'تبوك', 'Tabuk', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة تبوك'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'تبوك');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الوجه', 'Al Wajh', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة تبوك'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الوجه');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'ضباء', 'Duba', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة تبوك'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'ضباء');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'تيماء', 'Tayma', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة تبوك'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'تيماء');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'أملج', 'Umluj', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة تبوك'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'أملج');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'حقل', 'Haql', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة تبوك'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'حقل');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'البدع', 'Al Bad', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة تبوك'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'البدع');

-- منطقة حائل
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة حائل', 'Hail Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة حائل');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'حائل', 'Hail', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة حائل'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'حائل');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بقعاء', 'Baqaa', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة حائل'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بقعاء');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الغزالة', 'Al Ghazalah', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة حائل'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الغزالة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الشنان', 'Ash Shinan', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة حائل'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الشنان');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الحائط', 'Al Hait', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة حائل'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الحائط');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'السليمي', 'As Sulaymi', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة حائل'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'السليمي');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الشملي', 'Ash Shamli', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة حائل'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الشملي');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'موقق', 'Mawqaq', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'منطقة حائل'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'موقق');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'سميراء', 'Samira', true, 8, now()
FROM "regions" r WHERE r.name_ar = 'منطقة حائل'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'سميراء');

-- منطقة الحدود الشمالية
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة الحدود الشمالية', 'Northern Borders Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة الحدود الشمالية');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'عرعر', 'Arar', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الحدود الشمالية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'عرعر');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'رفحاء', 'Rafha', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الحدود الشمالية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'رفحاء');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'طريف', 'Turaif', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الحدود الشمالية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'طريف');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'العويقيلة', 'Al Uwayqilah', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الحدود الشمالية'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'العويقيلة');

-- منطقة جازان
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة جازان', 'Jazan Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة جازان');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'جازان', 'Jazan', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'جازان');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'صبيا', 'Sabya', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'صبيا');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'أبو عريش', 'Abu Arish', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'أبو عريش');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'صامطة', 'Samtah', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'صامطة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بيش', 'Baish', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بيش');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الدرب', 'Ad Darb', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الدرب');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الحرث', 'Al Harth', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الحرث');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'ضمد', 'Damad', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'ضمد');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الريث', 'Ar Rayth', true, 8, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الريث');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الدائر', 'Ad Dair', true, 9, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الدائر');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'العارضة', 'Al Aridah', true, 10, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'العارضة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'أحد المسارحة', 'Ahad Al Masarihah', true, 11, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'أحد المسارحة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'فرسان', 'Farasan', true, 12, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'فرسان');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'العيدابي', 'Al Idabi', true, 13, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'العيدابي');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الطوال', 'At Tuwal', true, 14, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الطوال');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'هروب', 'Haroub', true, 15, now()
FROM "regions" r WHERE r.name_ar = 'منطقة جازان'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'هروب');

-- منطقة نجران
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة نجران', 'Najran Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة نجران');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'نجران', 'Najran', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة نجران'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'نجران');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'شرورة', 'Sharurah', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة نجران'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'شرورة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'حبونا', 'Habuna', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة نجران'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'حبونا');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بدر الجنوب', 'Badr Al Janub', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة نجران'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بدر الجنوب');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'يدمة', 'Yadamah', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة نجران'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'يدمة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'ثار', 'Thar', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة نجران'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'ثار');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'خباش', 'Khubash', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة نجران'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'خباش');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الخرخير', 'Al Kharkhir', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'منطقة نجران'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الخرخير');

-- منطقة الباحة
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة الباحة', 'Al Bahah Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة الباحة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'الباحة', 'Al Bahah', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الباحة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'الباحة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بلجرشي', 'Baljurashi', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الباحة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بلجرشي');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'المندق', 'Al Mandaq', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الباحة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'المندق');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'المخواة', 'Al Makhwah', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الباحة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'المخواة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'العقيق', 'Al Aqiq', true, 4, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الباحة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'العقيق');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'قلوة', 'Qilwah', true, 5, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الباحة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'قلوة');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'القرى', 'Al Qura', true, 6, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الباحة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'القرى');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'غامد الزناد', 'Ghamid Az Zinad', true, 7, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الباحة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'غامد الزناد');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'بني حسن', 'Bani Hasan', true, 8, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الباحة'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'بني حسن');

-- منطقة الجوف
INSERT INTO "regions" (name_ar, name_en, is_active, updated_at)
SELECT 'منطقة الجوف', 'Al Jouf Region', true, now()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE name_ar = 'منطقة الجوف');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'سكاكا', 'Sakaka', true, 0, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الجوف'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'سكاكا');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'القريات', 'Qurayyat', true, 1, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الجوف'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'القريات');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'دومة الجندل', 'Dumat Al Jandal', true, 2, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الجوف'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'دومة الجندل');

INSERT INTO "cities" (region_id, name_ar, name_en, is_active, sort_order, updated_at)
SELECT r.id, 'طبرجل', 'Tabarjal', true, 3, now()
FROM "regions" r WHERE r.name_ar = 'منطقة الجوف'
  AND NOT EXISTS (SELECT 1 FROM "cities" WHERE name_ar = 'طبرجل');
