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

const STATUSES = ["OPEN", "INVESTIGATING", "KNOWN_ERROR", "RESOLVED", "CLOSED"];
const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const listInclude = {
  owner: { select: { id: true, fullName: true } },
  _count: { select: { tickets: true } },
};

// GET /api/problems — root cause/workaround เป็นข้อมูลภายใน
router.get(
  "/",
  staff,
  asyncHandler(async (req, res) => {
    const { status, q } = req.query;
    const where = {};
    if (status) where.status = status;
    if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { problemNo: { contains: q, mode: "insensitive" } }];
    const items = await prisma.problem.findMany({ where, include: listInclude, orderBy: { createdAt: "desc" } });
    res.json(items);
  })
);

// GET /api/problems/:id
router.get(
  "/:id",
  staff,
  asyncHandler(async (req, res) => {
    const problem = await prisma.problem.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        owner: { select: { id: true, fullName: true } },
        tickets: { select: { id: true, ticketNo: true, subject: true, status: true, priority: true } },
        changes: { select: { id: true, changeNo: true, title: true, status: true } },
      },
    });
    if (!problem) return res.status(404).json({ error: "ไม่พบ Problem" });
    res.json(problem);
  })
);

const createSchema = z.object({
  title: z.string().min(3, "กรุณากรอกหัวข้อ"),
  description: z.string().min(3, "กรุณากรอกรายละเอียด"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  rootCause: z.string().optional(),
  workaround: z.string().optional(),
  ownerId: z.coerce.number().int().nullable().optional(),
});

// POST /api/problems
router.post(
  "/",
  staff,
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const problem = await prisma.$transaction(async (tx) => {
      const problemNo = await nextNo("problem", "PRB", tx);
      return tx.problem.create({ data: { ...data, problemNo, ownerId: data.ownerId ?? req.user.id } });
    });
    await audit(req, "CREATE_PROBLEM", "Problem", problem.id, { problemNo: problem.problemNo });
    res.status(201).json(problem);
  })
);

// PATCH /api/problems/:id
router.patch(
  "/:id",
  staff,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const schema = createSchema.partial().extend({ status: z.enum(STATUSES).optional() });
    const data = schema.parse(req.body);
    if (data.status === "RESOLVED" || data.status === "CLOSED") data.resolvedAt = data.resolvedAt || new Date();
    const problem = await prisma.problem.update({ where: { id }, data });
    await audit(req, "UPDATE_PROBLEM", "Problem", id, { changes: data });
    res.json(problem);
  })
);

// POST /api/problems/:id/link-ticket  { ticketId }
router.post(
  "/:id/link-ticket",
  staff,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { ticketId } = z.object({ ticketId: z.coerce.number().int() }).parse(req.body);
    await prisma.ticket.update({ where: { id: ticketId }, data: { problemId: id } });
    await audit(req, "LINK_TICKET_PROBLEM", "Problem", id, { ticketId });
    res.json({ ok: true });
  })
);

// DELETE /api/problems/:id/link-ticket/:ticketId
router.delete(
  "/:id/link-ticket/:ticketId",
  staff,
  asyncHandler(async (req, res) => {
    await prisma.ticket.update({ where: { id: Number(req.params.ticketId) }, data: { problemId: null } });
    res.json({ ok: true });
  })
);

module.exports = router;
