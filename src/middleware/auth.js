const jwt = require("jsonwebtoken");
const prisma = require("../db");

// ตรวจสอบ JWT — รับจาก cookie (token) หรือ Authorization: Bearer
async function authenticate(req, res, next) {
  const token =
    req.cookies?.token ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    if (!Number.isInteger(payload.id) || !Number.isInteger(payload.sessionVersion)) throw new Error("Invalid session");
  } catch {
    return res.status(401).json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, username: true, role: true, fullName: true, isActive: true, sessionVersion: true },
    });
    if (!user?.isActive || user.sessionVersion !== payload.sessionVersion) {
      return res.status(401).json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
    }
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

// จำกัดเฉพาะ role ที่กำหนด เช่น requireRole("ADMIN", "AGENT")
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึงส่วนนี้" });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
