// Admin Console: audit log viewer, business hours, locations, departments
const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { parsePaging } = require("../utils/pagination");

const { audit } = require("../utils/audit");
const telegram = require("../services/telegram");

const router = express.Router();
router.use(authenticate);

// ═══════ Telegram bot config (ADMIN) — token ไม่ถูกส่งกลับไปหน้าเว็บ ═══════
router.get(
  "/telegram-config",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(telegram.getStatus());
  })
);

const telegramConfigSchema = z.object({
  enabled: z.boolean().optional(),
  token: z.string().trim().regex(/^\d+:[\w-]{20,}$/, "รูปแบบ Bot Token ไม่ถูกต้อง (ต้องเป็นเลข:ตัวอักษร)").or(z.literal("")).optional(),
});

router.put(
  "/telegram-config",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { enabled, token } = telegramConfigSchema.parse(req.body);
    let botUsername = null;
    try {
      if (token) botUsername = await telegram.verifyToken(token);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    await telegram.saveConfig({ enabled, token });
    await audit(req, "UPDATE_TELEGRAM_CONFIG", "SystemSetting", undefined, { enabled, tokenChanged: token !== undefined });
    res.json({ ...telegram.getStatus(), botUsername });
  })
);

// ═══════ Audit log viewer (ADMIN) ═══════
function auditWhere(query) {
  const { entityType, action, userId, q, dateFrom, dateTo } = query;
  const where = {};
  if (entityType) where.entityType = entityType;
  if (action) where.action = { contains: action, mode: "insensitive" };
  if (userId) where.userId = Number(userId);
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000+07:00`);
    if (dateTo) where.createdAt.lte = new Date(`${dateTo}T23:59:59.999+07:00`);
  }
  if (q) {
    const keyword = String(q).trim();
    where.OR = [
      { action: { contains: keyword, mode: "insensitive" } },
      { entityType: { contains: keyword, mode: "insensitive" } },
      { detail: { contains: keyword, mode: "insensitive" } },
      { ipAddress: { contains: keyword, mode: "insensitive" } },
      { user: { fullName: { contains: keyword, mode: "insensitive" } } },
      { user: { email: { contains: keyword, mode: "insensitive" } } },
      { user: { username: { contains: keyword, mode: "insensitive" } } },
    ];
  }
  return where;
}

function parseDetail(detail) {
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

function thaiDateTime(value) {
  return new Date(value).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// นำหน้าด้วย ' เมื่อค่าขึ้นต้นด้วยอักขระที่ Excel ตีความเป็นสูตร (CSV formula injection)
// ยกเว้นตัวเลขล้วน เพื่อไม่ให้ค่าติดลบกลายเป็นข้อความ
function csvCell(value) {
  let s = String(value ?? "");
  if (!/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function auditSelect() {
  return { user: { select: { id: true, fullName: true, email: true, username: true } } };
}

router.get(
  "/audit",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const where = auditWhere(req.query);
    const { page, take, skip } = parsePaging(req.query);
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, take, skip, orderBy: { createdAt: "desc" }, include: auditSelect() }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ items: items.map((item) => ({ ...item, detailObject: parseDetail(item.detail) })), total, page, pageSize: take });
  })
);

router.get(
  "/audit/export",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const where = auditWhere(req.query);
    const items = await prisma.auditLog.findMany({
      where,
      take: 10000,
      orderBy: { createdAt: "desc" },
      include: auditSelect(),
    });
    const headers = ["เวลา", "ผู้ใช้", "อีเมล/ชื่อผู้ใช้", "การกระทำ", "ประเภท", "รายการ ID", "รายละเอียด", "IP"];
    const rows = items.map((item) => {
      const actor = item.user?.fullName || "ระบบ";
      const login = item.user?.username || item.user?.email || "";
      const detail = parseDetail(item.detail);
      return [
        thaiDateTime(item.createdAt),
        actor,
        login,
        item.action,
        item.entityType,
        item.entityId ?? "",
        typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "",
        item.ipAddress || "",
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send("\uFEFF" + csv);
  })
);

// ═══════ Business Hours (ADMIN) ═══════
const DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

router.get(
  "/business-hours",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.businessHours.findMany({ orderBy: { dayOfWeek: "asc" } });
    res.json(rows.map((r) => ({ ...r, dayName: DAYS[r.dayOfWeek] })));
  })
);

router.put(
  "/business-hours/:day",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const dayOfWeek = Number(req.params.day);
    const data = z.object({ startTime: z.string(), endTime: z.string(), isWorking: z.boolean() }).parse(req.body);
    const row = await prisma.businessHours.upsert({ where: { dayOfWeek }, update: data, create: { dayOfWeek, ...data } });
    res.json(row);
  })
);

// ═══════ SLA Policy — ค่าเริ่มต้นต่อระดับความสำคัญ + กำหนดเฉพาะหมวดหมู่ ═══════
const PRIORITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const slaRowSchema = z.object({
  categoryId: z.coerce.number().int().positive().nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  responseMinutes: z.coerce.number().int().min(1).max(60 * 24 * 60),
  resolveMinutes: z.coerce.number().int().min(1).max(60 * 24 * 60),
}).refine((r) => r.resolveMinutes >= r.responseMinutes, { message: "เวลาแก้ไขต้องไม่น้อยกว่าเวลาตอบรับ", path: ["resolveMinutes"] });

router.get(
  "/sla-policies",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const { DEFAULT_SLA } = require("../services/sla");
    const rows = await prisma.slaPolicy.findMany({ include: { category: { select: { id: true, name: true, icon: true } } } });
    // ค่าเริ่มต้นที่ยังไม่มีแถวใน DB → แสดงค่าที่ระบบใช้จริง (DEFAULT_SLA)
    const defaults = PRIORITY_ORDER.map((priority) => {
      const row = rows.find((r) => r.categoryId == null && r.priority === priority);
      return row || { id: null, categoryId: null, priority, responseMinutes: DEFAULT_SLA[priority].response, resolveMinutes: DEFAULT_SLA[priority].resolve };
    });
    const overrides = rows
      .filter((r) => r.categoryId != null)
      .sort((a, b) => a.category.name.localeCompare(b.category.name, "th") || PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
    res.json({ defaults, overrides });
  })
);

// บันทึก (สร้างหรือแก้) นโยบายหนึ่งแถว — มีผลกับ ticket ที่สร้าง/เปลี่ยนความสำคัญหลังจากนี้
router.put(
  "/sla-policies",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const data = slaRowSchema.parse(req.body);
    if (data.categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: data.categoryId }, select: { id: true } });
      if (!cat) return res.status(400).json({ error: "ไม่พบหมวดหมู่" });
    }
    // categoryId = null ใช้ unique ของ DB ไม่ได้ (NULL ไม่ชนกัน) จึงหาแถวเดิมเองใน transaction
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.slaPolicy.findFirst({ where: { categoryId: data.categoryId, priority: data.priority }, orderBy: { id: "asc" } });
      const values = { responseMinutes: data.responseMinutes, resolveMinutes: data.resolveMinutes };
      return existing
        ? tx.slaPolicy.update({ where: { id: existing.id }, data: values })
        : tx.slaPolicy.create({ data: { ...data } });
    });
    await audit(req, "UPDATE_SLA_POLICY", "SlaPolicy", row.id, data);
    res.json(row);
  })
);

router.delete(
  "/sla-policies/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = await prisma.slaPolicy.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "ไม่พบนโยบาย" });
    if (row.categoryId == null) return res.status(400).json({ error: "ลบค่าเริ่มต้นไม่ได้ แก้ไขตัวเลขแทน" });
    await prisma.slaPolicy.delete({ where: { id } });
    await audit(req, "DELETE_SLA_POLICY", "SlaPolicy", id, { categoryId: row.categoryId, priority: row.priority });
    res.json({ ok: true });
  })
);

// ═══════ Locations (ADMIN) ═══════
router.get(
  "/locations",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const items = await prisma.location.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { assets: true, users: true } } } });
    res.json(items);
  })
);

router.post(
  "/locations",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const data = z.object({ name: z.string().min(1), code: z.string().optional(), address: z.string().optional(), parentId: z.coerce.number().int().nullable().optional() }).parse(req.body);
    res.status(201).json(await prisma.location.create({ data }));
  })
);

// ═══════ Departments (ADMIN) ═══════
router.get(
  "/departments",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const items = await prisma.department.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { assets: true, users: true } } },
    });
    res.json(items);
  })
);

router.post(
  "/departments",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const data = z.object({ name: z.string().min(1), parentId: z.coerce.number().int().nullable().optional(), managerId: z.coerce.number().int().nullable().optional() }).parse(req.body);
    res.status(201).json(await prisma.department.create({ data }));
  })
);

router.patch(
  "/departments/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = z.object({ name: z.string().min(1), parentId: z.coerce.number().int().nullable().optional(), managerId: z.coerce.number().int().nullable().optional() }).parse(req.body);
    res.json(await prisma.department.update({ where: { id }, data }));
  })
);

router.delete(
  "/departments/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const dept = await prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { assets: true, users: true } } },
    });
    if (!dept) return res.status(404).json({ error: "ไม่พบแผนก" });
    if (dept._count.assets || dept._count.users) {
      return res.status(400).json({ error: "ลบไม่ได้ เพราะแผนกนี้ยังมีผู้ใช้หรือทรัพย์สินผูกอยู่" });
    }
    await prisma.department.delete({ where: { id } });
    res.json({ ok: true });
  })
);

module.exports = router;
