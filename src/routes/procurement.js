// Vendor + Contract + Software License (Asset Lifecycle เชิงพาณิชย์)
const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { audit } = require("../utils/audit");
const { inTransaction, httpError } = require("../utils/transaction");

const router = express.Router();
router.use(authenticate);
const staff = requireRole("ADMIN", "AGENT");

// license key เป็นความลับระดับ ADMIN — ตัดออกก่อนตอบให้ role อื่น
function hideLicenseKey(license, user) {
  if (user.role === "ADMIN") return license;
  const { licenseKey, ...rest } = license;
  return { ...rest, licenseKey: licenseKey ? "••••••••" : null };
}

// ═══════ Vendors ═══════
router.get(
  "/vendors",
  staff,
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    const where = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { taxId: { contains: q } }] } : {};
    const items = await prisma.vendor.findMany({
      where, orderBy: { name: "asc" },
      include: { _count: { select: { assets: true, contracts: true, licenses: true } } },
    });
    res.json(items);
  })
);

const vendorSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  taxId: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/vendors", staff, asyncHandler(async (req, res) => {
  const v = await prisma.vendor.create({ data: vendorSchema.parse(req.body) });
  await audit(req, "CREATE_VENDOR", "Vendor", v.id);
  res.status(201).json(v);
}));

router.patch("/vendors/:id", staff, asyncHandler(async (req, res) => {
  res.json(await prisma.vendor.update({ where: { id: Number(req.params.id) }, data: vendorSchema.partial().parse(req.body) }));
}));

// ═══════ Contracts ═══════
const CONTRACT_TYPES = ["WARRANTY", "MAINTENANCE", "SUBSCRIPTION", "LEASE", "SUPPORT"];

router.get(
  "/contracts",
  staff,
  asyncHandler(async (req, res) => {
    const { expiringDays } = req.query;
    const where = {};
    if (expiringDays) {
      where.endDate = { lte: new Date(Date.now() + Number(expiringDays) * 86_400_000), gte: new Date() };
    }
    const items = await prisma.contract.findMany({ where, orderBy: { endDate: "asc" }, include: { vendor: { select: { name: true } }, _count: { select: { assets: true } } } });
    res.json(items);
  })
);

const contractSchema = z.object({
  contractNo: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(CONTRACT_TYPES),
  vendorId: z.coerce.number().int().nullable().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  value: z.coerce.number().optional(),
  autoRenew: z.boolean().default(false),
  notes: z.string().optional(),
});

router.post("/contracts", staff, asyncHandler(async (req, res) => {
  const c = await prisma.contract.create({ data: contractSchema.parse(req.body) });
  await audit(req, "CREATE_CONTRACT", "Contract", c.id);
  res.status(201).json(c);
}));

router.patch("/contracts/:id", staff, asyncHandler(async (req, res) => {
  res.json(await prisma.contract.update({ where: { id: Number(req.params.id) }, data: contractSchema.partial().parse(req.body) }));
}));

// ═══════ Software Licenses ═══════
router.get(
  "/licenses",
  staff,
  asyncHandler(async (req, res) => {
    const items = await prisma.softwareLicense.findMany({
      orderBy: { name: "asc" },
      include: { vendor: { select: { name: true } }, _count: { select: { assignments: true } } },
    });
    // คำนวณ seat คงเหลือ
    res.json(items.map((l) => hideLicenseKey({ ...l, usedSeats: l._count.assignments, availableSeats: l.totalSeats - l._count.assignments }, req.user)));
  })
);

router.get(
  "/licenses/:id",
  staff,
  asyncHandler(async (req, res) => {
    const l = await prisma.softwareLicense.findUnique({
      where: { id: Number(req.params.id) },
      include: { vendor: true, assignments: { include: { user: { select: { fullName: true, email: true } } } } },
    });
    if (!l) return res.status(404).json({ error: "ไม่พบ license" });
    res.json(hideLicenseKey({ ...l, usedSeats: l.assignments.length, availableSeats: l.totalSeats - l.assignments.length }, req.user));
  })
);

const licenseSchema = z.object({
  name: z.string().min(1),
  publisher: z.string().optional(),
  licenseKey: z.string().optional(),
  vendorId: z.coerce.number().int().nullable().optional(),
  totalSeats: z.coerce.number().int().min(1),
  expiry: z.coerce.date().optional(),
  cost: z.coerce.number().optional(),
  notes: z.string().optional(),
  billingCycle: z.enum(["NONE", "MONTHLY", "YEARLY"]).optional(),
  nextBillingDate: z.coerce.date().optional(),
  billingAmount: z.coerce.number().min(0).optional(),
  remindDaysBefore: z.coerce.number().int().min(0).max(60).optional(),
});

// วันชำระเปลี่ยน → จำ "วันที่ของเดือน" ไว้ใช้เลื่อนรอบถัดไป และล้างสถานะแจ้งเตือนเดิม
function withBillingDefaults(data) {
  if (data.nextBillingDate) {
    data.billingDay = data.nextBillingDate.getUTCDate();
    data.lastBillingRemindedFor = null;
  }
  return data;
}

router.post("/licenses", staff, asyncHandler(async (req, res) => {
  const data = withBillingDefaults(licenseSchema.parse(req.body));
  if (data.billingCycle && data.billingCycle !== "NONE" && !data.nextBillingDate) {
    return res.status(400).json({ error: "กรุณาระบุวันชำระครั้งถัดไป" });
  }
  const l = await prisma.softwareLicense.create({ data });
  await audit(req, "CREATE_LICENSE", "SoftwareLicense", l.id);
  res.status(201).json(l);
}));

router.patch("/licenses/:id", staff, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const data = withBillingDefaults(licenseSchema.partial().parse(req.body));
  if (data.billingCycle && data.billingCycle !== "NONE" && !data.nextBillingDate) {
    const cur = await prisma.softwareLicense.findUnique({ where: { id }, select: { nextBillingDate: true } });
    if (!cur?.nextBillingDate) return res.status(400).json({ error: "กรุณาระบุวันชำระครั้งถัดไป" });
  }
  res.json(await prisma.softwareLicense.update({ where: { id }, data }));
}));

// ADMIN สั่งตรวจรอบชำระทันที (ไม่ต้องรอรอบอัตโนมัติ)
router.post("/licenses/billing-check", staff, asyncHandler(async (req, res) => {
  const { checkLicenseBilling } = require("../services/licenseBillingJob");
  res.json(await checkLicenseBilling());
}));

router.delete("/licenses/:id", staff, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const license = await prisma.softwareLicense.findUnique({
    where: { id },
    include: { _count: { select: { assignments: true } } },
  });
  if (!license) return res.status(404).json({ error: "ไม่พบ license" });
  if (license._count.assignments > 0) {
    return res.status(409).json({ error: `ลบไม่ได้ เพราะยังมีผู้ถือ seat อยู่ ${license._count.assignments} ราย — ต้องคืน seat ก่อน` });
  }

  await prisma.softwareLicense.delete({ where: { id } });
  await audit(req, "DELETE_LICENSE", "SoftwareLicense", id, { name: license.name, assignments: license._count.assignments });
  res.json({ ok: true });
}));

// มอบหมาย/คืน seat
router.post("/licenses/:id/assign", staff, asyncHandler(async (req, res) => {
  const licenseId = Number(req.params.id);
  const { userId } = z.object({ userId: z.coerce.number().int() }).parse(req.body);
  // นับ seat และสร้าง assignment ใน transaction เดียว ไม่งั้นสองคำขอพร้อมกันจะแซง totalSeats ได้
  const a = await inTransaction(async (tx) => {
    const lic = await tx.softwareLicense.findUnique({ where: { id: licenseId }, include: { _count: { select: { assignments: true } } } });
    if (!lic) throw httpError(404, "ไม่พบ license");
    if (lic._count.assignments >= lic.totalSeats) throw httpError(400, "seat เต็มแล้ว");
    return tx.licenseAssignment.create({ data: { licenseId, userId } });
  });
  await audit(req, "ASSIGN_LICENSE", "SoftwareLicense", licenseId, { userId });
  res.status(201).json(a);
}));

router.delete("/licenses/:id/assign/:userId", staff, asyncHandler(async (req, res) => {
  await prisma.licenseAssignment.deleteMany({ where: { licenseId: Number(req.params.id), userId: Number(req.params.userId) } });
  res.json({ ok: true });
}));

module.exports = router;
