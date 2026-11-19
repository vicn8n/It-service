-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'ON_REPAIR';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "sla_paused_at" TIMESTAMP(3),
ADD COLUMN     "sla_paused_remaining" INTEGER,
ADD COLUMN     "sla_resp_paused_remaining" INTEGER;
