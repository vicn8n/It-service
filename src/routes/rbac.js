const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { audit } = require("../utils/audit");
const { MENU_ITEMS, EDITABLE_ROLES, getPermissionsForRole, getFullMatrix } = require("../services/rbac");

const router = express.Router();
router.use(authenticate);

// ─────────── GET /api/rbac/my-permissions — สิทธิ์เมนูของผู้ใช้ปัจจุบัน (ใช้กรอง nav) ───────────
router.get(
  "/my-permissions",
  asyncHandler(async (req, res) => {
    res.json(await getPermissionsForRole(req.user.role));
  })
);

// ─────────── GET /api/rbac/matrix — ตารางสิทธิ์ทั้งหมด (ADMIN) ───────────
router.get(
  "/matrix",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json({ items: await getFullMatrix(), roles: EDITABLE_ROLES });
  })
);

// ─────────── PUT /api/rbac/matrix — บันทึกสิทธิ์ (ADMIN) ───────────
const matrixSchema = z.object({
  changes: z.array(
    z.object({
      role: z.enum(EDITABLE_ROLES),
      menuKey: z.string(),
      allowed: z.boolean(),
    })
  ),
});

router.put(
  "/matrix",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { changes } = matrixSchema.parse(req.body);
    const validKeys = new Set(MENU_ITEMS.map((m) => m.key));
    for (const c of changes) {
      if (!validKeys.has(c.menuKey)) continue;
      await prisma.rolePermission.upsert({
        where: { role_menuKey: { role: c.role, menuKey: c.menuKey } },
        update: { allowed: c.allowed },
        create: { role: c.role, menuKey: c.menuKey, allowed: c.allowed },
      });
    }
    await audit(req, "UPDATE_RBAC", "RolePermission");
    res.json({ ok: true });
  })
);

module.exports = router;
