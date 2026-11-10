const express = require("express");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");

const router = express.Router();
router.use(authenticate, requireRole("ADMIN", "MANAGER", "AGENT"));

const PRIORITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

// นำหน้าด้วย ' เมื่อค่าขึ้นต้นด้วยอักขระที่ Excel ตีความเป็นสูตร (CSV formula injection)
// ยกเว้นตัวเลขล้วน เพื่อไม่ให้ค่าติดลบกลายเป็นข้อความ
function csvSafe(value) {
  const s = String(value ?? "");
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// CSV ต้องเป็นเวลาไทยให้ตรงกับหน้าจอ
// เดิมใช้ toISOString() แล้วตัด timezone ทิ้ง ทำให้ค่าเป็น UTC และต่างจากหน้าจอ 7 ชม.
const TZ = "Asia/Bangkok";

function thaiDateTime(value) {
  if (!value) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(value)).reduce((acc, x) => ({ ...acc, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function thaiDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

// แปลง array ของ object เป็น CSV (รองรับภาษาไทย — ใส่ BOM)
function toCsv(rows) {
  if (!rows.length) return "﻿";
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${csvSafe(v).replace(/"/g, '""')}"`;
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))];
  return "﻿" + lines.join("\r\n");
}

// ใช้เฉพาะเวลาจบงานที่บันทึกไว้จริง
// เดิมใช้ updatedAt เป็น fallback ซึ่งขยับทุกครั้งที่มีการแก้ไข ทำให้ "เวลาซ่อม" ของงานเก่าเพิ่มขึ้นเรื่อย ๆ
function ticketCompletedAt(ticket) {
  return ticket.resolvedAt || ticket.closedAt || null;
}

function repairDurationMinutes(ticket) {
  const completedAt = ticketCompletedAt(ticket);
  if (!ticket.createdAt || !completedAt) return null;
  return Math.max(0, Math.round((new Date(completedAt) - new Date(ticket.createdAt)) / 60000));
}

function formatRepairDuration(minutes) {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins ? `${hours} ชม. ${mins} นาที` : `${hours} ชม.`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} วัน ${restHours} ชม.` : `${days} วัน`;
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

function ticketWhereFromQuery(query) {
  const { status, priority, type, categoryId, assigneeId, q, month, year, sla } = query;
  const where = {};
  if (status) {
    const list = String(status).split(",").filter(Boolean);
    where.status = list.length === 1 ? list[0] : { in: list };
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
  return where;
}

// ─── สรุปภาพรวม (ช่วงวันที่) ───
router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const range = {};
    if (from) range.gte = new Date(from);
    if (to) range.lte = new Date(to);
    const where = from || to ? { createdAt: range } : {};

    const [byStatus, byPriority, byType, byCategory, byAgent, satisfaction] = await Promise.all([
      prisma.ticket.groupBy({ by: ["status"], where, _count: true }),
      prisma.ticket.groupBy({ by: ["priority"], where, _count: true }),
      prisma.ticket.groupBy({ by: ["type"], where, _count: true }),
      prisma.ticket.groupBy({ by: ["categoryId"], where, _count: true }),
      prisma.ticket.groupBy({ by: ["assigneeId"], where: { ...where, assigneeId: { not: null } }, _count: true }),
      prisma.ticket.aggregate({ where: { ...where, satisfaction: { not: null } }, _avg: { satisfaction: true }, _count: { satisfaction: true } }),
    ]);

    const [breached, total, respBreached, respMeasured] = await Promise.all([
      prisma.ticket.count({ where: { ...where, slaBreached: true } }),
      prisma.ticket.count({ where }),
      prisma.ticket.count({ where: { ...where, responseBreached: true } }),
      // วัดเฉพาะงานที่ตอบรับแล้ว หรือเลยกำหนดไปแล้ว — งานเก่าก่อนมีระบบนี้ไม่มีข้อมูล จึงไม่นับ
      prisma.ticket.count({ where: { ...where, OR: [{ firstRespAt: { not: null } }, { responseBreached: true }] } }),
    ]);

    const cats = await prisma.category.findMany();
    const catMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));
    const agents = await prisma.user.findMany({ where: { id: { in: byAgent.map((a) => a.assigneeId) } }, select: { id: true, fullName: true } });
    const agentMap = Object.fromEntries(agents.map((a) => [a.id, a.fullName]));

    res.json({
      total,
      slaCompliance: total ? Math.round(((total - breached) / total) * 100) : 100,
      responseCompliance: respMeasured ? Math.round(((respMeasured - respBreached) / respMeasured) * 100) : null,
      responseBreached: respBreached,
      responseMeasured: respMeasured,
      satisfactionAvg: satisfaction._avg.satisfaction ? Number(satisfaction._avg.satisfaction.toFixed(2)) : null,
      satisfactionCount: satisfaction._count.satisfaction,
      byStatus: byStatus.map((r) => ({ key: r.status, count: r._count })),
      // เรียงตามความรุนแรง ไม่ใช่ตามที่ groupBy คืนมา
      byPriority: byPriority
        .slice()
        .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority))
        .map((r) => ({ key: r.priority, count: r._count })),
      byType: byType.map((r) => ({ key: r.type, count: r._count })),
      byCategory: byCategory.map((r) => ({ key: catMap[r.categoryId] || "อื่น ๆ", count: r._count })),
      byAgent: byAgent.map((r) => ({ key: agentMap[r.assigneeId] || "—", count: r._count })),
    });
  })
);

// ─── Export Tickets เป็น CSV ───
router.get(
  "/tickets.csv",
  asyncHandler(async (req, res) => {
    const where = ticketWhereFromQuery(req.query);
    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { category: true, requester: { select: { fullName: true } }, assignee: { select: { fullName: true } } },
    });
    const rows = tickets.map((t) => {
      const repairMinutes = repairDurationMinutes(t);
      return {
        ticketNo: t.ticketNo, type: t.type, subject: t.subject, status: t.status, priority: t.priority,
        category: t.category?.name || "", requester: t.requester?.fullName || "", assignee: t.assignee?.fullName || "",
        deskPhone: t.deskPhone || "", mobilePhone: t.mobilePhone || "",
        slaBreached: t.slaBreached ? "เกิน" : "ปกติ",
        responseSla: t.responseBreached ? "เกิน" : t.firstRespAt ? "ปกติ" : "",
        "firstResponseAt (เวลาไทย)": thaiDateTime(t.firstRespAt),
        satisfaction: t.satisfaction || "",
        "createdAt (เวลาไทย)": thaiDateTime(t.createdAt),
        "resolvedAt (เวลาไทย)": thaiDateTime(t.resolvedAt),
        repairDuration: formatRepairDuration(repairMinutes),
        repairMinutes: repairMinutes ?? "",
      };
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="tickets.csv"');
    res.send(toCsv(rows));
  })
);

// ─── Export Assets เป็น CSV ───
router.get(
  "/assets.csv",
  asyncHandler(async (req, res) => {
    const assets = await prisma.asset.findMany({
      orderBy: { assetTag: "asc" },
      include: { type: true, owner: { select: { fullName: true } }, department: { select: { name: true } }, vendor: { select: { name: true } } },
    });
    const rows = assets.map((a) => ({
      assetTag: a.assetTag, type: a.type?.name || "", brand: a.brand, model: a.model, serialNo: a.serialNo || "",
      hostname: a.hostname || "", os: a.os || "", officeSuite: a.officeSuite || "", accountingAssetCode: a.accountingAssetCode || "",
      status: a.status, owner: a.owner?.fullName || "", department: a.department?.name || "", vendor: a.vendor?.name || "",
      purchasePrice: a.purchasePrice || "", purchaseDate: thaiDate(a.purchaseDate),
      warrantyExpiry: thaiDate(a.warrantyExpiry),
    }));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="assets.csv"');
    res.send(toCsv(rows));
  })
);

// ─── คำนวณค่าเสื่อมราคาแบบเส้นตรง (straight-line) ───
function depreciationRow(a, asOf = new Date()) {
  const price = a.purchasePrice != null ? Number(a.purchasePrice) : null;
  const salvage = a.salvageValue != null ? Number(a.salvageValue) : 0;
  const life = a.usefulLifeMonths || 0;
  if (price == null || !life || !a.purchaseDate) return null;
  const months = Math.max(0, Math.floor((asOf - new Date(a.purchaseDate)) / (30.44 * 86_400_000)));
  const used = Math.min(months, life);
  const depreciable = Math.max(0, price - salvage);
  const monthly = depreciable / life;
  const accumulated = Math.round(monthly * used * 100) / 100;
  const bookValue = Math.max(Math.round((price - accumulated) * 100) / 100, salvage);
  return {
    assetTag: a.assetTag, name: `${a.brand} ${a.model}`, type: a.type?.name || "",
    purchaseDate: thaiDate(a.purchaseDate),
    purchasePrice: price, salvageValue: salvage, usefulLifeMonths: life,
    monthsUsed: used, monthlyDepreciation: Math.round(monthly * 100) / 100,
    accumulatedDepreciation: accumulated, bookValue,
    fullyDepreciated: used >= life,
  };
}

async function depreciationRows() {
  const assets = await prisma.asset.findMany({
    where: { purchasePrice: { not: null }, usefulLifeMonths: { not: null }, status: { not: "DISPOSED" } },
    include: { type: { select: { name: true } } },
    orderBy: { assetTag: "asc" },
  });
  return assets.map((a) => depreciationRow(a)).filter(Boolean);
}

router.get(
  "/depreciation",
  asyncHandler(async (req, res) => {
    const rows = await depreciationRows();
    const totals = rows.reduce((s, r) => ({
      purchasePrice: s.purchasePrice + r.purchasePrice,
      accumulatedDepreciation: s.accumulatedDepreciation + r.accumulatedDepreciation,
      bookValue: s.bookValue + r.bookValue,
    }), { purchasePrice: 0, accumulatedDepreciation: 0, bookValue: 0 });
    res.json({ count: rows.length, totals, rows });
  })
);

router.get(
  "/depreciation.csv",
  asyncHandler(async (req, res) => {
    const rows = await depreciationRows();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="depreciation.csv"');
    res.send(toCsv(rows));
  })
);

module.exports = router;
