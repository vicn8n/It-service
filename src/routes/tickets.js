const express = require("express");
const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { parsePaging } = require("../utils/pagination");
const { audit } = require("../utils/audit");
const { upload, verifyUpload, UPLOAD_DIR } = require("../middleware/upload");
const { nextTicketNo } = require("../utils/ticketNo");
const { computeSlaDeadlines, firstResponsePatch, RESPONDED_STATUSES } = require("../services/sla");
const { notifyTicketStatus } = require("../services/email");
const { notify, notifyMany } = require("../services/notify");
const { autoAssign } = require("../services/assign");

const router = express.Router();
router.use(authenticate);

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const TYPES = ["INCIDENT", "SERVICE_REQUEST"];
const STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "AWAITING_APPROVAL", "RESOLVED", "CLOSED", "CANCELLED"];

const ticketInclude = {
  category: true,
  catalogItem: { select: { id: true, name: true } },
  asset: { select: { id: true, assetTag: true, brand: true, model: true } },
  requester: { select: { id: true, fullName: true, email: true, managerId: true, department: { select: { name: true } } } },
  assignee: { select: { id: true, fullName: true, email: true } },
  team: { select: { id: true, name: true } },
};

function canAccessTicket(user, ticket) {
  if (!ticket) return false;
  if (user.role !== "USER") return ["ADMIN", "AGENT", "MANAGER"].includes(user.role);
  if (ticket.requesterId === user.id) return true;
  // ผู้อนุมัติมาจาก managerId ซึ่งอาจมี role USER — ต้องเปิด ticket ที่ตัวเองต้องอนุมัติได้
  return (ticket.approvals || []).some((a) => a.approverId === user.id);
}

function removeUploadedFile(file) {
  if (!file) return;
  fs.promises.unlink(path.join(UPLOAD_DIR, file.filename)).catch(() => {});
}

function normalizeFilterYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900) return null;
  return year > 2400 ? year - 543 : year;
}

function createdAtRange(monthValue, yearValue) {
  const month = Number(monthValue);
  const year = normalizeFilterYear(yearValue);
  if (!year && !month) return null;

  const effectiveYear = year || new Date().getFullYear();
  if (month) {
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    const nextYear = month === 12 ? effectiveYear + 1 : effectiveYear;
    const nextMonth = month === 12 ? 1 : month + 1;
    return {
      gte: new Date(`${effectiveYear}-${String(month).padStart(2, "0")}-01T00:00:00.000+07:00`),
      lt: new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00.000+07:00`),
    };
  }

  return {
    gte: new Date(`${effectiveYear}-01-01T00:00:00.000+07:00`),
    lt: new Date(`${effectiveYear + 1}-01-01T00:00:00.000+07:00`),
  };
}

async function staffNotificationRecipients(ticket, assigneeId) {
  const ids = new Set();
  const staff = await prisma.user.findMany({
    where: { isActive: true, role: { in: ["ADMIN", "MANAGER", "AGENT"] } },
    select: { id: true },
  });
  staff.forEach((u) => ids.add(u.id));
  if (assigneeId) ids.delete(assigneeId); // ผู้รับมอบหมายได้แจ้งเตือน "คุณได้รับมอบหมาย" แยกอยู่แล้ว (กันซ้ำ)
  return [...ids];
}

// ─────────── GET /api/tickets — list + filter ───────────
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, priority, type, categoryId, assigneeId, q, month, year, sla } = req.query;

    const where = {};
    // USER เห็นเฉพาะ ticket ของตัวเอง
    if (req.user.role === "USER") where.requesterId = req.user.id;

    // status รับได้หลายค่าคั่นด้วย , (ใช้กับการ์ด Dashboard เช่น รอดำเนินการ = NEW,ASSIGNED,IN_PROGRESS,PENDING)
    if (status) {
      const list = String(status).split(",").filter((s) => STATUSES.includes(s));
      if (list.length) where.status = list.length === 1 ? list[0] : { in: list };
    }
    if (sla === "breached") where.slaBreached = true;
    if (sla === "response_breached") where.responseBreached = true;
    if (priority) where.priority = priority;
    if (type) where.type = type;
    if (categoryId) where.categoryId = Number(categoryId);
    if (assigneeId) where.assigneeId = Number(assigneeId);
    const range = createdAtRange(month, year);
    if (range) where.createdAt = range;
    if (q) {
      where.OR = [
        { subject: { contains: q, mode: "insensitive" } },
        { ticketNo: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    const { page, take, skip } = parsePaging(req.query);

    const [items, total] = await Promise.all([
      prisma.ticket.findMany({ where, include: ticketInclude, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.ticket.count({ where }),
    ]);

    res.json({ items, total, page, pageSize: take });
  })
);

// จำนวนเคสแจ้งซ่อมใหม่ที่ยังไม่มีผู้รับผิดชอบ (สำหรับ badge — ADMIN/MANAGER/AGENT เห็นภาพรวม)
router.get(
  "/new-count",
  asyncHandler(async (req, res) => {
    if (req.user.role === "USER") return res.json({ count: 0 });
    const count = await prisma.ticket.count({ where: { status: "NEW" } });
    res.json({ count });
  })
);

// ─────────── GET /api/tickets/:id ───────────
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const commentsWhere = req.user.role === "USER" ? { isInternal: false } : undefined;
    const ticket = await prisma.ticket.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        ...ticketInclude,
        comments: {
          where: commentsWhere,
          include: { author: { select: { id: true, fullName: true, role: true } } },
          orderBy: { createdAt: "asc" },
        },
        attachments: true,
        approvals: { include: { approver: { select: { fullName: true } } }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!ticket) return res.status(404).json({ error: "ไม่พบ ticket" });
    if (!canAccessTicket(req.user, ticket)) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึง ticket นี้" });
    }
    res.json(ticket);
  })
);

// ─────────── POST /api/tickets — สร้างใหม่ ───────────
const createSchema = z.object({
  type: z.enum(TYPES).default("INCIDENT"),
  subject: z.string().min(3, "กรุณากรอกหัวข้อ"),
  description: z.string().min(5, "กรุณากรอกรายละเอียด"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  categoryId: z.coerce.number().int().optional(),
  catalogId: z.coerce.number().int().optional(),
  assetId: z.coerce.number().int().optional(),
  location: z.string().optional(),
  deskPhone: z.string().optional(),
  mobilePhone: z.string().optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const { responseDueAt, resolveDueAt } = await computeSlaDeadlines(data.priority, data.categoryId);

    // ตรวจว่าต้องขออนุมัติไหม (service request จาก catalog ที่ requiresApproval)
    let needsApproval = false;
    if (data.type === "SERVICE_REQUEST" && data.catalogId) {
      const item = await prisma.serviceCatalogItem.findUnique({ where: { id: data.catalogId } });
      needsApproval = !!item?.requiresApproval;
    }
    // หาผู้อนุมัติ: หัวหน้าของผู้ขอ → ถ้าไม่มี ใช้ MANAGER คนแรก
    let approverId = null;
    if (needsApproval) {
      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { managerId: true } });
      approverId = me?.managerId || (await prisma.user.findFirst({ where: { role: "MANAGER", isActive: true } }))?.id || null;
      if (!approverId) needsApproval = false; // ไม่มีผู้อนุมัติ → ข้าม
    }

    // Auto-assign: ถ้าไม่ต้องอนุมัติ → มอบหมายตามทีมของหมวด (หรือ AGENT ที่งานน้อยสุด)
    let autoAssigneeId = null;
    let autoTeamId = null;
    if (!needsApproval) {
      const r = await autoAssign(data.categoryId);
      autoAssigneeId = r.assigneeId;
      autoTeamId = r.teamId;
    }

    const ticket = await prisma.$transaction(async (tx) => {
      const ticketNo = await nextTicketNo(tx);
      const t = await tx.ticket.create({
        data: {
          ...data,
          ticketNo,
          status: needsApproval ? "AWAITING_APPROVAL" : autoAssigneeId ? "ASSIGNED" : "NEW",
          assigneeId: needsApproval ? null : autoAssigneeId,
          teamId: needsApproval ? null : autoTeamId,
          requesterId: req.user.id,
          responseDueAt,
          resolveDueAt,
        },
        include: ticketInclude,
      });
      if (needsApproval) {
        await tx.approval.create({ data: { ticketId: t.id, approverId } });
      }
      return t;
    });

    await audit(req, "CREATE_TICKET", "Ticket", ticket.id, { ticketNo: ticket.ticketNo, type: ticket.type });
    if (needsApproval && approverId) {
      await notify(approverId, `มีคำขอรออนุมัติ: ${ticket.ticketNo}`, ticket.subject, `ticket-detail:${ticket.id}`);
    } else {
      const staffIds = await staffNotificationRecipients(ticket, autoAssigneeId);
      await notifyMany(staffIds, `มี Ticket ใหม่: ${ticket.ticketNo}`, `${ticket.subject} (${ticket.requester?.fullName || "ผู้แจ้ง"})`, `ticket-detail:${ticket.id}`);
      if (autoAssigneeId) {
        await notify(autoAssigneeId, `คุณได้รับมอบหมาย ${ticket.ticketNo}`, ticket.subject, `ticket-detail:${ticket.id}`);
      }
    }
    res.status(201).json(ticket);
  })
);

// ─────────── PATCH /api/tickets/:id — แก้ไข (AGENT/ADMIN) ───────────
const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.coerce.number().int().nullable().optional(),
  categoryId: z.coerce.number().int().nullable().optional(),
  subject: z.string().min(3).optional(),
  description: z.string().min(5).optional(),
  location: z.string().optional(),
  deskPhone: z.string().optional(),
  mobilePhone: z.string().optional(),
});

router.patch(
  "/:id",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const existing = await prisma.ticket.findUnique({ where: { id }, include: { requester: true } });
    if (!existing) return res.status(404).json({ error: "ไม่พบ ticket" });

    // จัดการ timestamp ตาม transition ของสถานะ
    const patch = { ...data };
    const now = new Date();
    const DONE = ["RESOLVED", "CLOSED"];
    if (data.assigneeId && existing.status === "NEW") patch.status = patch.status || "ASSIGNED";
    // SLA ตอบรับ: นับเมื่อเจ้าหน้าที่ขยับงานเข้าสถานะที่ผู้แจ้งได้รับการดูแลแล้ว
    if (data.status && RESPONDED_STATUSES.includes(data.status)) Object.assign(patch, firstResponsePatch(existing, now));
    if (data.status === "RESOLVED" && !existing.resolvedAt) patch.resolvedAt = now;
    if (data.status === "CLOSED") {
      if (!existing.resolvedAt) patch.resolvedAt = now;
      if (!existing.closedAt) patch.closedAt = now;
    }
    // เปิดงานที่ปิดแล้วกลับมาทำต่อ — ล้างเวลาจบรอบเดิม ไม่งั้นหน้าจอจะโชว์เวลาซ่อมของรอบก่อน
    if (data.status && !DONE.includes(data.status) && DONE.includes(existing.status)) {
      patch.resolvedAt = null;
      patch.closedAt = null;
    }
    // ถ้าเปลี่ยนความเร่งด่วน ต้องคำนวณกำหนด SLA ใหม่ ไม่งั้นยังยึดกำหนดของ priority เดิม
    if (data.priority && data.priority !== existing.priority && !DONE.includes(patch.status ?? existing.status)) {
      const due = await computeSlaDeadlines(data.priority, data.categoryId ?? existing.categoryId, existing.createdAt);
      patch.responseDueAt = due.responseDueAt;
      patch.resolveDueAt = due.resolveDueAt;
      // ธงเกิน SLA ที่ job ตั้งไว้ตามกำหนดเดิม ต้องประเมินใหม่ตามกำหนดใหม่
      patch.slaBreached = now > due.resolveDueAt;
      if (!existing.firstRespAt && !patch.firstRespAt) patch.responseBreached = now > due.responseDueAt;
      else if (patch.firstRespAt) patch.responseBreached = patch.firstRespAt > due.responseDueAt;
    }
    // ประเมิน SLA breach ตอนปิดงานเลย — ไม่รอ job รอบ 5 นาที ซึ่งจะข้ามงานที่ปิดไปแล้ว
    const finishedAt = patch.resolvedAt ?? existing.resolvedAt;
    const dueAt = patch.resolveDueAt ?? existing.resolveDueAt;
    if (DONE.includes(patch.status ?? existing.status) && finishedAt && dueAt) {
      patch.slaBreached = new Date(finishedAt) > new Date(dueAt);
    }

    const ticket = await prisma.ticket.update({ where: { id }, data: patch, include: ticketInclude });

    await audit(req, "UPDATE_TICKET", "Ticket", id, { changes: data });

    // แจ้งเตือนผู้แจ้งเมื่อสถานะเปลี่ยน
    if (data.status && data.status !== existing.status) {
      if (existing.requester?.email) await notifyTicketStatus(ticket, existing.requester.email).catch(() => {});
      await notify(existing.requesterId, `${ticket.ticketNo} อัปเดตสถานะ`, ticket.subject, `ticket-detail:${id}`);
    }
    // แจ้งเจ้าหน้าที่เมื่อถูกมอบหมายใหม่
    if (data.assigneeId && data.assigneeId !== existing.assigneeId) {
      await notify(data.assigneeId, `คุณได้รับมอบหมาย ${ticket.ticketNo}`, ticket.subject, `ticket-detail:${id}`);
    }
    res.json(ticket);
  })
);

// ─────────── DELETE /api/tickets/:id — ลบ ticket (ADMIN) ───────────
// comments / attachments / approvals ถูกลบตามด้วย cascade; ไฟล์แนบบนดิสก์และแจ้งเตือนที่ลิงก์มา ลบเอง
router.delete(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { attachments: { select: { filePath: true } } },
    });
    if (!ticket) return res.status(404).json({ error: "ไม่พบ ticket" });

    await prisma.$transaction([
      prisma.userNotification.deleteMany({ where: { link: `ticket-detail:${id}` } }),
      prisma.ticket.delete({ where: { id } }),
    ]);
    ticket.attachments.forEach((a) => fs.promises.unlink(path.join(UPLOAD_DIR, a.filePath)).catch(() => {}));

    await audit(req, "DELETE_TICKET", "Ticket", id, { ticketNo: ticket.ticketNo, subject: ticket.subject, status: ticket.status });
    res.json({ ok: true });
  })
);

// ─────────── POST /api/tickets/:id/comments ───────────
router.post(
  "/:id/comments",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const schema = z.object({
      body: z.string().min(1, "กรุณากรอกข้อความ"),
      isInternal: z.boolean().default(false),
    });
    const { body, isInternal } = schema.parse(req.body);

    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: "ไม่พบ ticket" });
    if (req.user.role === "USER" && ticket.requesterId !== req.user.id) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์" });
    }
    // USER comment ภายในไม่ได้
    const internal = req.user.role === "USER" ? false : isInternal;

    const comment = await prisma.ticketComment.create({
      data: { ticketId: id, authorId: req.user.id, body, isInternal: internal },
      include: { author: { select: { id: true, fullName: true, role: true } } },
    });
    // เจ้าหน้าที่ตอบผู้แจ้งครั้งแรก (ไม่ใช่โน้ตภายใน) = ตอบรับตาม SLA
    if (["ADMIN", "AGENT"].includes(req.user.role) && ticket.requesterId !== req.user.id && !internal) {
      const first = firstResponsePatch(ticket);
      if (first) await prisma.ticket.updateMany({ where: { id, firstRespAt: null }, data: first });
    }
    await audit(req, "ADD_COMMENT", "Ticket", id);
    res.status(201).json(comment);
  })
);

// ─────────── POST /api/tickets/:id/attachments ───────────
router.post(
  "/:id/attachments",
  upload.single("file"),
  verifyUpload,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: "กรุณาแนบไฟล์" });
    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true, requesterId: true } });
    if (!ticket) {
      removeUploadedFile(req.file);
      return res.status(404).json({ error: "ไม่พบ ticket" });
    }
    if (!canAccessTicket(req.user, ticket)) {
      removeUploadedFile(req.file);
      return res.status(403).json({ error: "ไม่มีสิทธิ์" });
    }

    const att = await prisma.ticketAttachment.create({
      data: {
        ticketId: id,
        fileName: req.file.originalname,
        filePath: req.file.filename,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
    res.status(201).json(att);
  })
);

// ─────────── POST /api/tickets/:id/satisfaction — ให้คะแนน (ผู้แจ้ง) ───────────
router.post(
  "/:id/satisfaction",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const schema = z.object({ rating: z.coerce.number().int().min(1).max(5), feedback: z.string().optional() });
    const { rating, feedback } = schema.parse(req.body);

    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ error: "ไม่พบ ticket" });
    if (ticket.requesterId !== req.user.id) return res.status(403).json({ error: "ให้คะแนนได้เฉพาะผู้แจ้ง" });

    const updated = await prisma.ticket.update({
      where: { id },
      data: { satisfaction: rating, feedback },
    });
    res.json(updated);
  })
);

module.exports = router;
