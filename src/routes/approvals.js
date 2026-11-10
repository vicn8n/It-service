const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { audit } = require("../utils/audit");
const { inTransaction, httpError } = require("../utils/transaction");
const { notify } = require("../services/notify");

const router = express.Router();
router.use(authenticate);

// รายการที่ฉันต้องอนุมัติ
router.get(
  "/mine",
  asyncHandler(async (req, res) => {
    // ตรวจ enum ก่อน ไม่งั้นค่าที่ไม่ถูกต้องจะทำให้ Prisma โยน error เป็น 500
    const status = z.enum(["PENDING", "APPROVED", "REJECTED"]).catch("PENDING").parse(req.query.status || "PENDING");
    const items = await prisma.approval.findMany({
      where: { approverId: req.user.id, status },
      orderBy: { createdAt: "desc" },
      include: { ticket: { select: { id: true, ticketNo: true, subject: true, type: true, requester: { select: { fullName: true } } } } },
    });
    res.json(items);
  })
);

// จำนวนที่รออนุมัติ (สำหรับ badge)
router.get(
  "/pending-count",
  asyncHandler(async (req, res) => {
    const count = await prisma.approval.count({ where: { approverId: req.user.id, status: "PENDING" } });
    res.json({ count });
  })
);

// ตัดสินอนุมัติ/ปฏิเสธ
router.post(
  "/:id/decision",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { decision, comment } = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), comment: z.string().optional() }).parse(req.body);

    // ตัดสินอนุมัติกับสถานะ ticket ต้องเปลี่ยนพร้อมกัน และกันการกดอนุมัติซ้ำพร้อมกันสองครั้ง
    const { approval, newStatus } = await inTransaction(async (tx) => {
      const row = await tx.approval.findUnique({ where: { id }, include: { ticket: true } });
      if (!row) throw httpError(404, "ไม่พบรายการอนุมัติ");
      if (row.approverId !== req.user.id && req.user.role !== "ADMIN") throw httpError(403, "ไม่มีสิทธิ์อนุมัติรายการนี้");
      if (row.status !== "PENDING") throw httpError(400, "รายการนี้ถูกตัดสินไปแล้ว");

      await tx.approval.update({ where: { id }, data: { status: decision, comment, decidedAt: new Date() } });
      // อนุมัติแล้วยังไม่มีผู้รับผิดชอบ ให้กลับไปเป็น NEW เพื่อให้เข้าคิวมอบหมายตามปกติ
      const status = decision === "REJECTED" ? "CANCELLED" : row.ticket.assigneeId ? "ASSIGNED" : "NEW";
      await tx.ticket.update({ where: { id: row.ticketId }, data: { status } });
      return { approval: row, newStatus: status };
    });

    await audit(req, "APPROVAL_" + decision, "Ticket", approval.ticketId, { comment });
    await notify(approval.ticket.requesterId, `คำขอ ${approval.ticket.ticketNo} ${decision === "APPROVED" ? "ได้รับการอนุมัติ" : "ถูกปฏิเสธ"}`, comment, `ticket-detail:${approval.ticketId}`);

    res.json({ ok: true, status: newStatus });
  })
);

module.exports = router;
