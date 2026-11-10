const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { parsePaging } = require("../utils/pagination");
const { audit } = require("../utils/audit");
const { strongPassword } = require("../utils/password");
const { inTransaction, httpError } = require("../utils/transaction");

async function protectLastAdmin(tx, user, nextRole, nextActive) {
  if (user.role !== "ADMIN" || !user.isActive || (nextRole === "ADMIN" && nextActive)) return;
  if (await tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: user.id } } }) === 0) {
    throw httpError(409, "ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อยหนึ่งคน");
  }
}

const router = express.Router();
router.use(authenticate);

const publicSelect = {
  id: true, email: true, username: true, fullName: true, phone: true, jobTitle: true,
  role: true, isActive: true, department: { select: { id: true, name: true } },
  createdAt: true,
};

// GET /api/users — รายชื่อผู้ใช้ (AGENT เห็นเพื่อ assign, ADMIN จัดการ)
router.get(
  "/",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const { role } = req.query;
    const q = String(req.query.q || "").trim();
    const where = {};
    if (role) where.role = role;
    if (q) where.OR = [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }];

    const wantsPagination = req.query.page != null || req.query.pageSize != null;
    if (!wantsPagination) {
      const users = await prisma.user.findMany({ where, select: publicSelect, orderBy: { fullName: "asc" } });
      return res.json(users);
    }

    const { page, take, skip } = parsePaging(req.query);
    const [items, total] = await Promise.all([
      prisma.user.findMany({ where, select: publicSelect, orderBy: { fullName: "asc" }, take, skip }),
      prisma.user.count({ where }),
    ]);
    res.json({ items, total, page, pageSize: take });
  })
);

const createSchema = z.object({
  email: z.string().email(),
  username: z.string().trim().toLowerCase().regex(/^\S{3,40}$/u).optional(),
  password: strongPassword,
  fullName: z.string().min(1),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  role: z.enum(["ADMIN", "MANAGER", "AGENT", "USER"]).default("USER"),
  departmentId: z.coerce.number().int().nullable().optional(),
  locationId: z.coerce.number().int().nullable().optional(),
  managerId: z.coerce.number().int().nullable().optional(),
});

function generateTemporaryPassword() {
  const token = crypto.randomBytes(6).toString("base64url");
  return `Reset-${token}A1`;
}

// POST /api/users (ADMIN)
router.post(
  "/",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { password, ...rest } = createSchema.parse(req.body);
    const user = await prisma.user.create({
      data: { ...rest, passwordHash: await bcrypt.hash(password, 10) },
      select: publicSelect,
    });
    await audit(req, "CREATE_USER", "User", user.id);
    res.status(201).json(user);
  })
);

// PATCH /api/users/:id (ADMIN)
router.patch(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const schema = createSchema.partial().extend({ isActive: z.boolean().optional() });
    const { password, ...rest } = schema.parse(req.body);
    const data = { ...rest };
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    const user = await inTransaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) throw httpError(404, "ไม่พบผู้ใช้งาน");
      await protectLastAdmin(tx, existing, data.role ?? existing.role, data.isActive ?? existing.isActive);
      if (password && existing.authProvider === "LDAP") throw httpError(400, "บัญชี LDAP ต้องเปลี่ยนรหัสผ่านที่ AD/LDAP");
      const patch = { ...data };
      if (password || (data.role !== undefined && data.role !== existing.role) || (data.isActive !== undefined && data.isActive !== existing.isActive)) {
        patch.sessionVersion = { increment: 1 };
      }
      return tx.user.update({ where: { id }, data: patch, select: publicSelect });
    });
    await audit(req, "UPDATE_USER", "User", id);
    res.json(user);
  })
);

// POST /api/users/:id/reset-password (ADMIN)
router.post(
  "/:id/reset-password",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const schema = z.object({ password: strongPassword.optional() });
    const { password } = schema.parse(req.body || {});
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, authProvider: true } });
    if (!user) return res.status(404).json({ error: "ไม่พบผู้ใช้งาน" });
    if (user.authProvider === "LDAP") return res.status(400).json({ error: "บัญชี LDAP ต้องเปลี่ยนรหัสผ่านที่ระบบ AD/LDAP" });

    const newPassword = password || generateTemporaryPassword();
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        failedLogins: 0,
        lockedUntil: null,
        sessionVersion: { increment: 1 },
      },
    });
    await audit(req, "RESET_USER_PASSWORD", "User", id);
    res.json({ ok: true, password: newPassword });
  })
);

// DELETE /api/users/:id (ADMIN)
router.delete(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (req.user.id === id) return res.status(400).json({ error: "ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้" });

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, fullName: true, email: true, role: true },
    });
    if (!user) return res.status(404).json({ error: "ไม่พบผู้ใช้งาน" });

    if (user.role === "ADMIN") {
      const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", id: { not: id }, isActive: true } });
      if (otherAdmins < 1) return res.status(400).json({ error: "ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้" });
    }

    const blockers = await Promise.all([
      prisma.ticket.count({ where: { requesterId: id } }),
      prisma.ticketComment.count({ where: { authorId: id } }),
      prisma.kbArticle.count({ where: { authorId: id } }),
      prisma.approval.count({ where: { approverId: id } }),
    ]);
    const labels = [
      ["Ticket ที่เป็นผู้แจ้ง", blockers[0]],
      ["ความคิดเห็นใน Ticket", blockers[1]],
      ["บทความ Knowledge Base", blockers[2]],
      ["รายการอนุมัติ", blockers[3]],
    ].filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count} รายการ`);
    if (labels.length) {
      return res.status(409).json({ error: `ยังลบไม่ได้ เพราะมีข้อมูลอ้างอิงอยู่: ${labels.join(", ")}` });
    }

    await prisma.$transaction([
      prisma.ticket.updateMany({ where: { assigneeId: id }, data: { assigneeId: null } }),
      prisma.user.updateMany({ where: { managerId: id }, data: { managerId: null } }),
      prisma.asset.updateMany({ where: { ownerId: id }, data: { ownerId: null } }),
      prisma.assetAssignment.deleteMany({ where: { userId: id } }),
      prisma.licenseAssignment.deleteMany({ where: { userId: id } }),
      prisma.teamMember.deleteMany({ where: { userId: id } }),
      prisma.userNotification.deleteMany({ where: { userId: id } }),
      prisma.auditLog.updateMany({ where: { userId: id }, data: { userId: null } }),
      prisma.user.delete({ where: { id } }),
    ]);
    await audit(req, "DELETE_USER", "User", id, { fullName: user.fullName, email: user.email });
    res.json({ ok: true });
  })
);

module.exports = router;
