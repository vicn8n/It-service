const express = require("express");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const PRIORITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const { asyncHandler } = require("../middleware/error");

const router = express.Router();
router.use(authenticate);

router.get(
  "/helpdesk",
  asyncHandler(async (req, res) => {
    const scope = req.user.role === "USER" ? { requesterId: req.user.id } : {};
    const now = new Date();
    const current = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Bangkok", year: "numeric", month: "numeric",
    }).formatToParts(now).map((part) => [part.type, part.value]));
    const month = Number(req.query.month ?? current.month);
    let year = Number(req.query.year ?? current.year);
    if (year > 2400) year -= 543;
    if (!Number.isInteger(month) || month < 1 || month > 12 ||
        !Number.isInteger(year) || year < 1900 || year > 2400) {
      return res.status(400).json({ error: "กรุณาเลือกเดือนและปีที่ถูกต้อง" });
    }
    // Bangkok month boundaries, independent of the server's local timezone.
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, -7));
    const endOfMonth = new Date(Date.UTC(year, month, 1, -7));
    const where = { ...scope, createdAt: { gte: startOfMonth, lt: endOfMonth } };

    const [total, open, resolved, breached, byCategory, byStatus, byPriority, trendTickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.count({ where: { ...where, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] } } }),
      prisma.ticket.count({ where: { ...where, status: { in: ["RESOLVED", "CLOSED"] } } }),
      prisma.ticket.count({ where: { ...where, slaBreached: true } }),
      prisma.ticket.groupBy({ by: ["categoryId"], where, _count: true }),
      prisma.ticket.groupBy({ by: ["status"], where, _count: true }),
      prisma.ticket.groupBy({ by: ["priority"], where, _count: true }),
      prisma.ticket.findMany({
        where,
        select: { createdAt: true, status: true, slaBreached: true },
      }),
    ]);

    const cats = await prisma.category.findMany();
    const catMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));
    const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
    const trendMap = new Map();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let i = 0; i < daysInMonth; i += 1) {
      const day = new Date(startOfMonth.getTime() + i * 86_400_000);
      trendMap.set(keyFmt.format(day), { label: String(i + 1), created: 0, resolved: 0, breached: 0 });
    }
    for (const t of trendTickets) {
      const row = trendMap.get(keyFmt.format(t.createdAt));
      if (!row) continue;
      row.created += 1;
      if (["RESOLVED", "CLOSED"].includes(t.status)) row.resolved += 1;
      if (t.slaBreached) row.breached += 1;
    }

    const activeTotal = byStatus.reduce((sum, row) => sum + row._count, 0);
    const slaCompliance = activeTotal ? Math.max(0, Math.round(((activeTotal - breached) / activeTotal) * 100)) : 100;

    res.json({
      period: { month, year },
      kpi: { total, open, resolved, breached, resolutionRate: total ? Math.round((resolved / total) * 100) : 0, slaCompliance },
      byCategory: byCategory.map((r) => ({ category: catMap[r.categoryId] || "อื่น ๆ", count: r._count })),
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count })),
      // เรียงตามความรุนแรง ไม่ใช่ตามที่ groupBy คืนมา
      byPriority: byPriority
        .slice()
        .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority))
        .map((r) => ({ priority: r.priority, count: r._count })),
      trend: Array.from(trendMap.values()),
    });
  })
);

router.get(
  "/assets",
  requireRole("ADMIN", "AGENT"),
  asyncHandler(async (req, res) => {
    const in30 = new Date(Date.now() + 30 * 86_400_000);
    const [total, inUse, repair, warrantyExpiring, byType, byStatus] = await Promise.all([
      prisma.asset.count(),
      prisma.asset.count({ where: { status: "IN_USE" } }),
      prisma.asset.count({ where: { status: "REPAIR" } }),
      prisma.asset.count({ where: { warrantyExpiry: { lte: in30, gte: new Date() } } }),
      prisma.asset.groupBy({ by: ["typeId"], _count: true }),
      prisma.asset.groupBy({ by: ["status"], _count: true }),
    ]);

    const types = await prisma.assetType.findMany();
    const typeMap = Object.fromEntries(types.map((t) => [t.id, t.name]));

    res.json({
      kpi: { total, inUse, repair, warrantyExpiring },
      byType: byType.map((r) => ({ type: typeMap[r.typeId] || "อื่น ๆ", count: r._count })),
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count })),
    });
  })
);

module.exports = router;
