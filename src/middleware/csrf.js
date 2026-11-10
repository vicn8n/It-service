const crypto = require("crypto");

// CSRF แบบ double-submit cookie
// - ทุก request ที่เข้า /api ถ้ายังไม่มี cookie "csrf" จะออกค่าสุ่มให้ (JS อ่านได้ เพราะ client ต้องส่งกลับใน header)
// - request ที่เปลี่ยนข้อมูล (POST/PUT/PATCH/DELETE) ต้องส่ง header X-CSRF-Token ให้ตรงกับ cookie
//   เว็บอื่นอ่าน cookie ของ origin เราไม่ได้ จึงปลอม header นี้ไม่ได้ แม้เบราว์เซอร์จะแนบ cookie token ไปให้
// - client ที่ใช้ Authorization: Bearer (ไม่มี cookie token) ไม่เสี่ยง CSRF จึงไม่ต้องตรวจ
const COOKIE = "csrf";
const HEADER = "x-csrf-token";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

const cookieOpts = () => ({
  httpOnly: false,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
});

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function csrfProtection(req, res, next) {
  let token = req.cookies?.[COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = crypto.randomBytes(32).toString("hex");
    res.cookie(COOKIE, token, cookieOpts());
    req.cookies[COOKIE] = undefined; // cookie ใหม่ยังไม่ถูกส่งมากับ request นี้
  }
  if (SAFE.has(req.method)) return next();

  const usesCookieAuth = Boolean(req.cookies?.token);
  if (!usesCookieAuth && req.headers.authorization?.startsWith("Bearer ")) return next();

  const sent = req.get(HEADER);
  if (!sent || !req.cookies?.[COOKIE] || !same(sent, req.cookies[COOKIE])) {
    return res.status(403).json({ error: "คำขอไม่ผ่านการตรวจสอบความปลอดภัย กรุณารีเฟรชหน้าเว็บแล้วลองใหม่", code: "CSRF" });
  }
  return next();
}

module.exports = { csrfProtection };
