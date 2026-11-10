-- DropIndex
DROP INDEX "sla_policies_category_id_key";

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "response_breached" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "tickets_sla_breached_idx" ON "tickets"("sla_breached");

-- CreateIndex
CREATE INDEX "tickets_resolved_at_idx" ON "tickets"("resolved_at");

-- CreateIndex
CREATE INDEX "tickets_closed_at_idx" ON "tickets"("closed_at");

