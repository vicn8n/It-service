const express = require("express");
const prisma = require("../db");
const { authenticate } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");

const router = express.Router();
router.use(authenticate);

// รายการแจ้งเตือนของฉัน + จำนวนที่ยังไม่อ่าน
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const [items, unread] = await Promise.all([
      prisma.userNotification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.userNotification.count({ where: { userId: req.user.id, isRead: false } }),
    ]);
    res.json({ items, unread });
  })
);

// ทำเครื่องหมายอ่านแล้ว (ทั้งหมด หรือรายตัว)
router.post(
  "/read",
  asyncHandler(async (req, res) => {
    const { id } = req.body;
    const where = { userId: req.user.id };
    if (id) where.id = Number(id);
    await prisma.userNotification.updateMany({ where, data: { isRead: true } });
    res.json({ ok: true });
  })
);

module.exports = router;
