const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { audit } = require("../utils/audit");
const { nextNo } = require("../utils/docNo");

const router = express.Router();
router.use(authenticate);
const staff = requireRole("ADMIN", "MANAGER", "AGENT");

const TYPES = ["STANDARD", "NORMAL", "EMERGENCY"];
const STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"];
const RISKS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const listInclude = { requester: { select: { id: true, fullName: true } }, problem: { select: { id: true, problemNo: true } } };

// GET /api/changes — แผน implement/rollback เป็นข้อมูลภายใน
router.get(
  "/",
  staff,
  asyncHandler(async (req, res) => {
    const { status, type, q } = req.query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { changeNo: { contains: q, mode: "insensitive" } }];
    const items = await prisma.change.findMany({ where, include: listInclude, orderBy: { createdAt: "desc" } });
    res.json(items);
  })
);

// GET /api/changes/:id
router.get(
  "/:id",
  staff,
  asyncHandler(async (req, res) => {
    const change = await prisma.change.findUnique({
      where: { id: Number(req.params.id) },
      include: { requester: { select: { id: true, fullName: true } }, problem: { select: { id: true, problemNo: true, title: true } } },
    });
    if (!change) return res.status(404).json({ error: "ไม่พบ Change" });
    res.json(change);
  })
);

const createSchema = z.object({
  title: z.string().min(3, "กรุณากรอกหัวข้อ"),
  description: z.string().min(3, "กรุณากรอกรายละเอียด"),
  type: z.enum(TYPES).default("NORMAL"),
  risk: z.enum(RISKS).default("MEDIUM"),
  problemId: z.coerce.number().int().nullable().optional(),
  plannedStart: z.coerce.date().nullable().optional(),
  plannedEnd: z.coerce.date().nullable().optional(),
  implementationPlan: z.string().optional(),
  rollbackPlan: z.string().optional(),
});

// POST /api/changes
router.post(
  "/",
  staff,
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const change = await prisma.$transaction(async (tx) => {
      const changeNo = await nextNo("change", "CHG", tx);
      return tx.change.create({ data: { ...data, changeNo, requesterId: req.user.id } });
    });
    await audit(req, "CREATE_CHANGE", "Change", change.id, { changeNo: change.changeNo });
    res.status(201).json(change);
  })
);

// PATCH /api/changes/:id — แก้ไข / เปลี่ยนสถานะ (workflow)
router.patch(
  "/:id",
  staff,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const schema = createSchema.partial().extend({ status: z.enum(STATUSES).optional() });
    const data = schema.parse(req.body);
    // APPROVED/SCHEDULED ต้องเป็น MANAGER/ADMIN
    if (["APPROVED", "SCHEDULED"].includes(data.status) && !["ADMIN", "MANAGER"].includes(req.user.role)) {
      return res.status(403).json({ error: "เฉพาะหัวหน้า/ผู้ดูแลเท่านั้นที่อนุมัติ Change ได้" });
    }
    const change = await prisma.change.update({ where: { id }, data });
    await audit(req, "UPDATE_CHANGE", "Change", id, { changes: data });
    res.json(change);
  })
);

module.exports = router;
