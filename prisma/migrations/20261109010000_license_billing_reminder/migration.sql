-- รอบชำระเงินของ Software License + แจ้งเตือนก่อนถึงวันจ่าย
ALTER TABLE "software_licenses" ADD COLUMN "billing_cycle" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "software_licenses" ADD COLUMN "next_billing_date" DATE;
ALTER TABLE "software_licenses" ADD COLUMN "billing_day" INTEGER;
ALTER TABLE "software_licenses" ADD COLUMN "billing_amount" DECIMAL(12,2);
ALTER TABLE "software_licenses" ADD COLUMN "remind_days_before" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "software_licenses" ADD COLUMN "last_billing_reminded_for" DATE;
CREATE INDEX "software_licenses_next_billing_date_idx" ON "software_licenses"("next_billing_date");
