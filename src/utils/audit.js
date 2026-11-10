const prisma = require("../db");

// บันทึก audit log — ไม่ throw error เพื่อไม่ให้กระทบ flow หลัก
async function audit(req, action, entityType, entityId, detail) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        detail: detail ? JSON.stringify(detail) : null,
        ipAddress: req.ip,
      },
    });
  } catch (e) {
    console.error("[AUDIT] บันทึก audit log ไม่สำเร็จ:", e.message);
  }
}

module.exports = { audit };
