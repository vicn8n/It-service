const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");

const router = express.Router();
router.use(authenticate);

// รายการบริการที่ขอได้ (Service Catalog)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = req.user.role === "USER" ? { isActive: true } : {};
    const items = await prisma.serviceCatalogItem.findMany({ where, orderBy: { name: "asc" } });
    res.json(items);
  })
);

const schema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  icon: z.string().optional(),
  categoryId: z.coerce.number().int().nullable().optional(),
  requiresApproval: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

router.post(
  "/",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.serviceCatalogItem.create({ data: schema.parse(req.body) }));
  })
);

router.patch(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(await prisma.serviceCatalogItem.update({ where: { id: Number(req.params.id) }, data: schema.partial().parse(req.body) }));
  })
);

module.exports = router;
