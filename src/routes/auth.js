const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const prisma = require("../db");
const { authenticate } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/error");
const { audit } = require("../utils/audit");
const ldap = require("../services/ldap");
const { strongPassword } = require("../utils/password");
const { generateSecret, verifyTOTP, otpauthURL } = require("../utils/totp");
const telegram = require("../services/telegram");
const { sendMail, EMAIL_ENABLED } = require("../services/email");

const router = express.Router();

const loginSchema = z.object({
  email: z.string().min(1, "กรุณากรอกชื่อผู้ใช้หรืออีเมล"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
  totp: z.string().optional(),
});

// นโยบายล็อกบัญชี
const MAX_FAILED = Number(process.env.LOGIN_MAX_FAILED || 5);
const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 8 * 60 * 60 * 1000, // 8 ชม.
};

const registerSchema = z
  .object({
    fullName: z.string().min(1, "กรุณากรอกชื่อ-สกุล"),
    email: z.preprocess((value) => normalizeEmail(value) || undefined, z.string().email("อีเมลไม่ถูกต้อง").optional()),
    username: z.preprocess((value) => normalizeUsername(value) || undefined, z.string().optional()),
    employeeCode: z.preprocess((value) => cleanText(value) || undefined, z.string().min(1).max(80).optional()),
    password: strongPassword,
    departmentId: z.coerce.number().int().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const username = normalizeUsername(data.username || data.employeeCode);
    if (!username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["username"],
        message: "กรุณากรอกชื่อผู้ใช้",
      });
    } else if (!/^\S{3,40}$/u.test(username)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["username"],
        message: "ชื่อผู้ใช้ต้องยาว 3-40 ตัว และห้ามเว้นวรรค",
      });
    }
  });

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function normalizeUsername(value) {
  return cleanText(value).toLowerCase();
}

function syntheticEmailFromEmployeeCode(value) {
  const raw = cleanText(value).toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const hash = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 8);
  return `${slug || "user"}-${hash}@no-email.local`;
}

function legacyEmailFromIdentifier(identifier) {
  const value = cleanText(identifier);
  return value.includes("@") ? normalizeEmail(value) : syntheticEmailFromEmployeeCode(value);
}

async function findUserByLogin(identifier) {
  const value = cleanText(identifier);
  const username = normalizeUsername(value);
  let user = await prisma.user.findUnique({ where: { username } });
  if (user) return user;

  if (value.includes("@")) {
    user = await prisma.user.findUnique({ where: { email: normalizeEmail(value) } });
    if (user) return user;
  }

  return prisma.user.findUnique({ where: { email: legacyEmailFromIdentifier(value) } });
}

function authPayload(user) {
  return { id: user.id, email: user.email, username: user.username, role: user.role, fullName: user.fullName };
}

function issueLogin(res, user) {
  const payload = authPayload(user);
  const token = jwt.sign({ ...payload, sessionVersion: user.sessionVersion }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
  res.cookie("token", token, COOKIE_OPTS);
  return { user: payload, token };
}

router.get(
  "/register-options",
  asyncHandler(async (req, res) => {
    const departments = await prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
    res.json({ departments });
  })
);

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { fullName, email, username: requestedUsername, employeeCode, password, departmentId } = registerSchema.parse(req.body);
    const username = normalizeUsername(requestedUsername || employeeCode);
    const loginEmail = email || syntheticEmailFromEmployeeCode(username);
    const passwordHash = await bcrypt.hash(password, 10);
    const userByUsername = await prisma.user.findUnique({ where: { username } });
    const userByEmail = await prisma.user.findUnique({ where: { email: loginEmail } });
    if (userByUsername || userByEmail) {
      return res.status(409).json({ error: "ชื่อผู้ใช้หรืออีเมลนี้มีอยู่แล้ว กรุณาเข้าสู่ระบบหรือติดต่อผู้ดูแล" });
    }

    const data = {
      fullName,
      email: loginEmail,
      username,
      passwordHash,
      role: "USER",
      isActive: true,
      failedLogins: 0,
      lockedUntil: null,
      departmentId: departmentId || null,
    };

    const user = await prisma.user.create({ data });

    await audit(req, "SELF_REGISTER", "User", user.id).catch(() => {});
    res.status(201).json(issueLogin(res, user));
  })
);

// POST /api/auth/login
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password, totp } = loginSchema.parse(req.body);

    let user = await findUserByLogin(email);

    // บัญชีถูกล็อกชั่วคราว (พยายามผิดบ่อยเกินไป)
    if (user && user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil - new Date()) / 60000);
      return res.status(423).json({ error: `บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ใน ${mins} นาที` });
    }

    // LDAP/AD: ใช้เมื่อเปิด LDAP และ (ไม่พบ user ในระบบ หรือ user เป็นชนิด LDAP)
    if (ldap.LDAP_ENABLED && (!user || user.authProvider === "LDAP")) {
      const ldapUser = await ldap.authenticate(email, password);
      if (!ldapUser || !ldapUser.isActive) {
        return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
      }
      user = ldapUser;
    } else {
      // Local auth
      const passOk = user && user.isActive && user.passwordHash && (await bcrypt.compare(password, user.passwordHash));
      if (!passOk) {
        // นับความพยายามที่ล้มเหลว + ล็อกเมื่อถึงเกณฑ์
        if (user && user.authProvider === "LOCAL") {
          const fails = (user.failedLogins || 0) + 1;
          const data = { failedLogins: fails };
          if (fails >= MAX_FAILED) {
            data.failedLogins = 0;
            data.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
          }
          await prisma.user.update({ where: { id: user.id }, data }).catch(() => {});
          await audit(req, "LOGIN_FAILED", "User", user.id, { fails, locked: !!data.lockedUntil }).catch(() => {});
        }
        return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
      }
      // สำเร็จ → รีเซ็ตตัวนับ
      if (user.failedLogins || user.lockedUntil) {
        await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } }).catch(() => {});
      }
    }

    // 2FA gate (เฉพาะผู้ใช้ที่เปิด 2FA)
    if (user.totpEnabled && user.totpSecret) {
      if (!totp) return res.json({ twoFactorRequired: true });
      if (!verifyTOTP(user.totpSecret, totp)) {
        await audit(req, "LOGIN_2FA_FAILED", "User", user.id).catch(() => {});
        return res.status(401).json({ error: "รหัสยืนยัน 2FA ไม่ถูกต้อง" });
      }
    }

    await audit(req, "LOGIN", "User", user.id);
    res.json(issueLogin(res, user));
  })
);

// POST /api/auth/logout
router.post("/logout", authenticate, asyncHandler(async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { sessionVersion: { increment: 1 } } });
  res.clearCookie("token");
  res.json({ ok: true });
}));

// GET /api/auth/me
router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, username: true, fullName: true, role: true, jobTitle: true,
        totpEnabled: true, telegramChatId: true, emailNotify: true,
        department: { select: { id: true, name: true } },
      },
    });
    if (!user) return res.status(401).json({ error: "ไม่พบผู้ใช้" });
    res.json({ user });
  })
);

// POST /api/auth/change-password
router.post(
  "/change-password",
  authenticate,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: strongPassword,
    });
    const { currentPassword, newPassword } = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.passwordHash) {
      return res.status(400).json({ error: "บัญชีนี้ไม่ได้ใช้รหัสผ่านในระบบ" });
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(400).json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), sessionVersion: { increment: 1 } },
    });
    await audit(req, "CHANGE_PASSWORD", "User", user.id);
    issueLogin(res, updated);
    res.json({ ok: true });
  })
);

// ─────────── 2FA (TOTP) ───────────
// POST /api/auth/2fa/setup — สร้าง secret (ยังไม่เปิดใช้จนกว่าจะยืนยัน)
router.post(
  "/2fa/setup",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user.totpEnabled) return res.status(400).json({ error: "เปิดใช้ 2FA อยู่แล้ว" });
    const secret = generateSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
    res.json({ secret, otpauth: otpauthURL(secret, user.email) });
  })
);

// POST /api/auth/2fa/enable — ยืนยัน token เพื่อเปิดใช้
router.post(
  "/2fa/enable",
  authenticate,
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.totpSecret) return res.status(400).json({ error: "กรุณาเริ่มตั้งค่า 2FA ก่อน" });
    if (!verifyTOTP(user.totpSecret, token)) return res.status(400).json({ error: "รหัสยืนยันไม่ถูกต้อง" });
    const updated = await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true, sessionVersion: { increment: 1 } } });
    issueLogin(res, updated);
    await audit(req, "ENABLE_2FA", "User", user.id);
    res.json({ ok: true });
  })
);

// POST /api/auth/2fa/disable — ปิด 2FA (ต้องยืนยัน token ปัจจุบัน)
router.post(
  "/2fa/disable",
  authenticate,
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.totpEnabled || !verifyTOTP(user.totpSecret, token)) return res.status(400).json({ error: "รหัสยืนยันไม่ถูกต้อง" });
    const updated = await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null, sessionVersion: { increment: 1 } } });
    issueLogin(res, updated);
    await audit(req, "DISABLE_2FA", "User", user.id);
    res.json({ ok: true });
  })
);

// ─────────── Telegram notification ───────────
// POST /api/auth/telegram — บันทึก chat id (ส่งค่าว่าง = ยกเลิกการผูก)
router.post(
  "/telegram",
  authenticate,
  asyncHandler(async (req, res) => {
    const { chatId } = z.object({ chatId: z.string().optional() }).parse(req.body);
    const value = (chatId || "").trim() || null;
    await prisma.user.update({ where: { id: req.user.id }, data: { telegramChatId: value } });
    await audit(req, value ? "LINK_TELEGRAM" : "UNLINK_TELEGRAM", "User", req.user.id);
    res.json({ ok: true, linked: !!value });
  })
);

// POST /api/auth/telegram/test — ส่งข้อความทดสอบไปยัง chat id ที่ผูกไว้
router.post(
  "/telegram/test",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { telegramChatId: true, fullName: true } });
    if (!user?.telegramChatId) return res.status(400).json({ error: "ยังไม่ได้ผูก Telegram Chat ID" });
    try {
      await telegram.sendMessage(user.telegramChatId, telegram.formatNotification("ทดสอบการแจ้งเตือน", `สวัสดี ${user.fullName} — Telegram เชื่อมต่อกับ IT Service Desk เรียบร้อยแล้ว ✅`), { throwOnError: true });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  })
);

// ─────────── Email notification ───────────
// POST /api/auth/email-notify — เปิด/ปิดรับแจ้งเตือนทาง email ของผู้ใช้
router.post(
  "/email-notify",
  authenticate,
  asyncHandler(async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await prisma.user.update({ where: { id: req.user.id }, data: { emailNotify: enabled } });
    await audit(req, enabled ? "ENABLE_EMAIL_NOTIFY" : "DISABLE_EMAIL_NOTIFY", "User", req.user.id);
    res.json({ ok: true, enabled });
  })
);

// POST /api/auth/email-notify/test — ส่งอีเมลทดสอบไปยังอีเมลของผู้ใช้
router.post(
  "/email-notify/test",
  authenticate,
  asyncHandler(async (req, res) => {
    if (!EMAIL_ENABLED) return res.status(400).json({ error: "ยังไม่ได้เปิดใช้งานอีเมล (EMAIL_ENABLED)" });
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true, fullName: true } });
    const record = await sendMail(
      user.email,
      "ทดสอบการแจ้งเตือน",
      `<div style="font-family:Prompt,'Segoe UI',Tahoma,sans-serif;color:#1f2937"><h2 style="color:#2563eb">IT Service Desk</h2><p>สวัสดี ${user.fullName} — อีเมลเชื่อมต่อกับ IT Service Desk เรียบร้อยแล้ว ✅</p></div>`
    );
    if (record.error) return res.status(400).json({ error: record.error });
    res.json({ ok: true });
  })
);

module.exports = router;
