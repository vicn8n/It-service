const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");

const router = express.Router();
router.use(authenticate);

// ข้อมูลสำหรับ dropdown ต่าง ๆ ในครั้งเดียว
router.get(
  "/",
  asyncHandler(async (req, res) => {
    // vendor/asset type ใช้เฉพาะฟอร์มฝั่งเจ้าหน้าที่ — ไม่ส่งให้ USER
    const isStaff = ["ADMIN", "AGENT"].includes(req.user.role);
    const [categories, departments, assetTypes, locations, vendors, catalogItems] = await Promise.all([
      prisma.category.findMany({ orderBy: { name: "asc" } }),
      prisma.department.findMany({ orderBy: { name: "asc" } }),
      isStaff ? prisma.assetType.findMany({ orderBy: { name: "asc" } }) : [],
      prisma.location.findMany({ orderBy: { name: "asc" } }),
      isStaff ? prisma.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
      prisma.serviceCatalogItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    ]);
    res.json({ categories, departments, assetTypes, locations, vendors, catalogItems });
  })
);

// CRUD ง่าย ๆ สำหรับ master data (ADMIN)
// schema แยกตาม model — ไม่ส่ง req.body ดิบเข้า Prisma
const META_MODELS = [
  ["categories", "category", z.object({ name: z.string().min(1), icon: z.string().optional(), teamId: z.coerce.number().int().nullable().optional() })],
  ["departments", "department", z.object({ name: z.string().min(1), parentId: z.coerce.number().int().nullable().optional() })],
  ["asset-types", "assetType", z.object({ name: z.string().min(1), icon: z.string().optional() })],
];

for (const [path, model, schema] of META_MODELS) {
  router.post(
    `/${path}`,
    requireRole("ADMIN"),
    asyncHandler(async (req, res) => {
      const created = await prisma[model].create({ data: schema.parse(req.body) });
      res.status(201).json(created);
    })
  );
}

module.exports = router;
