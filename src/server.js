const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const { notFound, errorHandler, asyncHandler } = require("./middleware/error");
const { authenticate } = require("./middleware/auth");
const { csrfProtection } = require("./middleware/csrf");
const { startSlaJob } = require("./services/slaJob");
const { startEmailIngest } = require("./services/emailIngest");
const { startAuditRetentionJob } = require("./services/auditRetention");
const { startLicenseBillingJob } = require("./services/licenseBillingJob");
const { UPLOAD_DIR, INLINE_TYPES, EXT_TO_TYPE } = require("./middleware/upload");
const prisma = require("./db");

const pkg = require("../package.json");
const STARTED_AT = Date.now();

const app = express();
app.set("trust proxy", 1); // อยู่หลัง IIS reverse proxy

// ─────────── Security & parsing ───────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // ห้าม inline script / onclick — ผูก event ผ่าน data-* ใน public/js เท่านั้น
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    },
  })
);
// ถ้าไม่ได้ตั้ง APP_URL ให้ปิด cross-origin ไปเลย — ห้าม fallback เป็น origin:true
// เพราะ credentials:true + สะท้อน origin ใดก็ได้ = เปิดให้เว็บอื่นเรียก API ด้วย cookie ของผู้ใช้
app.use(cors({ origin: process.env.APP_URL || false, credentials: true }));
if (!process.env.APP_URL) {
  console.warn("⚠️  ไม่ได้ตั้ง APP_URL — ปิด cross-origin ไว้ (หน้าเว็บที่เสิร์ฟจาก origin เดียวกันยังใช้งานได้ปกติ)");
}
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/api", csrfProtection);

// IIS (ARR) ส่ง X-Forwarded-For มาพร้อม port เช่น "192.168.100.30:54802"
// ต้องตัด port ออกก่อนส่งให้ express-rate-limit ไม่เช่นนั้นจะ throw ERR_ERL_INVALID_IP_ADDRESS
function ipKeyGenerator(req) {
  const ip = req.ip || "";
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
  if (v4) return v4[1];
  const v6 = ip.match(/^\[(.+)\]:\d+$/);
  if (v6) return v6[1];
  return ip;
}

// rate limit เฉพาะ API
app.use("/api", rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false, keyGenerator: ipKeyGenerator }));
// login เข้มกว่า
app.use(
  "/api/auth/login",
  rateLimit({ windowMs: 15 * 60_000, max: 10, message: { error: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่" }, keyGenerator: ipKeyGenerator })
);

// ─────────── Health check (สำหรับ IIS / load balancer / monitoring) ───────────
async function healthHandler(req, res) {
  const startedAt = Date.now();
  let db = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch (_) {
    db = "down";
  }
  const ok = db === "up";
  res.status(ok ? 200 : 503).json({
    ok,
    status: ok ? "healthy" : "degraded",
    db,
    dbLatencyMs: Date.now() - startedAt,
    uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
    version: pkg.version || "0.0.0",
    env: process.env.NODE_ENV || "development",
    ts: new Date().toISOString(),
  });
}
// /health (plain — สำหรับ probe) และ /api/health (เดิม)
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

// ─────────── Routes ───────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/tickets", require("./routes/tickets"));
app.use("/api/assets", require("./routes/assets"));
app.use("/api/users", require("./routes/users"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/meta", require("./routes/meta"));
// โมดูล Enterprise
app.use("/api/kb", require("./routes/kb"));
app.use("/api/catalog", require("./routes/catalog"));
app.use("/api/procurement", require("./routes/procurement"));
app.use("/api/approvals", require("./routes/approvals"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/search", require("./routes/search"));
app.use("/api/teams", require("./routes/teams"));
app.use("/api/problems", require("./routes/problems"));
app.use("/api/changes", require("./routes/changes"));
app.use("/api/rbac", require("./routes/rbac"));

// ไฟล์แนบ — ต้อง login ก่อน
app.get(
  "/uploads/:file",
  authenticate,
  asyncHandler(async (req, res) => {
    const file = path.basename(req.params.file || "");
    if (!file || file !== req.params.file) return res.status(400).json({ error: "Invalid file path" });

    // กำหนด Content-Type จากนามสกุลที่ระบบตั้งเอง ไม่เชื่อค่าที่บันทึกตอนอัปโหลด
    // และบังคับดาวน์โหลดทุกอย่างที่ไม่ใช่รูป กันไฟล์ถูกแสดงเป็น HTML ใน origin ของแอป
    const send = (fileName) => {
      const type = EXT_TO_TYPE.get(path.extname(fileName).toLowerCase());
      if (!type) return res.status(404).json({ error: "File not found" });
      res.type(type);
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (!INLINE_TYPES.has(type)) {
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      }
      return res.sendFile(path.join(path.resolve(UPLOAD_DIR), fileName));
    };

    const ticketAttachment = await prisma.ticketAttachment.findFirst({
      where: { filePath: file },
      include: { ticket: { select: { requesterId: true } } },
    });
    if (ticketAttachment) {
      if (req.user.role === "USER" && ticketAttachment.ticket.requesterId !== req.user.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return send(file);
    }

    // ไฟล์แนบทรัพย์สินเป็นข้อมูลภายใน — เฉพาะเจ้าหน้าที่
    const assetAttachment = await prisma.assetAttachment.findFirst({ where: { filePath: file }, select: { id: true } });
    if (assetAttachment) {
      if (!["ADMIN", "AGENT"].includes(req.user.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return send(file);
    }

    const kbAttachment = await prisma.kbAttachment.findFirst({
      where: { filePath: file },
      include: { article: { select: { published: true } } },
    });
    if (kbAttachment) {
      if (req.user.role === "USER" && !kbAttachment.article.published) {
        return res.status(403).json({ error: "Forbidden" });
      }
      return send(file);
    }

    return res.status(404).json({ error: "File not found" });
  })
);

// ─────────── Frontend (static) ───────────
const publicDir = path.join(__dirname, "..", "public");
async function sendIndex(req, res) {
  // inline ทั้ง fonts.css และ app.css เพื่อให้เบราว์เซอร์เริ่มโหลด woff2 ตั้งแต่ HTML ก้อนแรก
  // (fonts.css แยกไฟล์ไว้เพราะหน้าต่างพิมพ์ใน pages.js link ไฟล์เดียวกันนี้)
  const [html, fontsCss, css] = await Promise.all([
    fs.promises.readFile(path.join(publicDir, "index.html"), "utf8"),
    fs.promises.readFile(path.join(publicDir, "css", "fonts.css"), "utf8"),
    fs.promises.readFile(path.join(publicDir, "css", "app.css"), "utf8"),
  ]);
  res.type("html").send(
    html.replace("</head>", `<style data-inline-app-css>\n${fontsCss}\n${css}\n</style>\n</head>`)
  );
}
app.get("/", asyncHandler(sendIndex));
// ไฟล์ฟอนต์ไม่เปลี่ยนเนื้อหา (ชื่อไฟล์ผูกกับน้ำหนัก+ชุดอักขระ) — แคชยาวได้ ไม่ต้อง revalidate ทุกครั้ง
app.use(
  "/fonts",
  express.static(path.join(publicDir, "fonts"), { maxAge: "1y", immutable: true })
);
app.use(express.static(publicDir));
// SPA fallback — ส่ง index.html สำหรับเส้นทางที่ไม่ใช่ /api
app.get(/^(?!\/api).*/, asyncHandler(sendIndex));

// ─────────── Error handling ───────────
app.use("/api", notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, async () => {
  console.log(`✅ IT Service Desk ทำงานที่ port ${PORT} (${process.env.NODE_ENV || "development"})`);
  startSlaJob(); // ตรวจ SLA breach ทุก 5 นาที
  startEmailIngest(); // Email-to-Ticket (ถ้า IMAP_ENABLED=true)
  startAuditRetentionJob(); // ลบ Audit Log ที่เก่ากว่า 90 วันอัตโนมัติ
  startLicenseBillingJob(); // แจ้งเตือนรอบชำระ Software License (รายเดือน/รายปี) ทุกชั่วโมง
  const telegram = require("./services/telegram");
  await telegram.loadConfig();
  console.log(telegram.TELEGRAM_ENABLED ? "📲 Telegram: เปิดใช้งาน" : "ℹ️  Telegram: ปิดอยู่ (ตั้งได้ที่เมนู ตั้งค่าระบบ)");
});
