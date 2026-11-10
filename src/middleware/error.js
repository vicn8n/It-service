const { ZodError } = require("zod");

// 404
function notFound(req, res) {
  res.status(404).json({ error: "ไม่พบ endpoint ที่ร้องขอ" });
}

// Global error handler
function errorHandler(err, req, res, _next) {
  // Validation error จาก zod
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "ข้อมูลไม่ถูกต้อง",
      details: err.issues.map((e) => ({ field: e.path.join("."), message: e.message })),
    });
  }

  // Prisma — unique constraint
  if (err.code === "P2002") {
    return res.status(409).json({ error: `ข้อมูลซ้ำ: ${err.meta?.target?.join(", ")}` });
  }
  // Prisma — record not found
  if (err.code === "P2025") {
    return res.status(404).json({ error: "ไม่พบข้อมูลที่ระบุ" });
  }

  console.error("[ERROR]", err);
  res.status(err.status || 500).json({
    error: err.expose ? err.message : "เกิดข้อผิดพลาดภายในระบบ",
  });
}

// wrap async route handlers
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { notFound, errorHandler, asyncHandler };
