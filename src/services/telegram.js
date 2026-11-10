// แจ้งเตือนผ่าน Telegram Bot API (config-driven)
// ตั้งค่าได้ 2 ทาง: เมนู "ตั้งค่าระบบ" (เก็บในฐานข้อมูล แบบเข้ารหัส — มีผลทันที) หรือ .env (TELEGRAM_ENABLED / TELEGRAM_BOT_TOKEN)
// ค่าจากเมนูจะมาก่อนค่าใน .env
// ผู้ใช้แต่ละคนผูก chat id ของตัวเอง (User.telegramChatId)

const prisma = require("../db");
const { encrypt, decrypt } = require("../utils/secretBox");

const KEY_ENABLED = "telegram.enabled";
const KEY_TOKEN = "telegram.botToken";

const envEnabled = () => String(process.env.TELEGRAM_ENABLED || "").toLowerCase() === "true";

// cache ค่าจากฐานข้อมูล (null = ไม่ได้ตั้งไว้ → ใช้ค่าจาก .env)
let dbEnabled = null;
let dbToken = null;

const isEnabled = () => (dbEnabled !== null ? dbEnabled : envEnabled());
const getToken = () => dbToken || process.env.TELEGRAM_BOT_TOKEN || "";

async function loadConfig() {
  try {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: [KEY_ENABLED, KEY_TOKEN] } } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    dbEnabled = KEY_ENABLED in map ? map[KEY_ENABLED] === "true" : null;
    dbToken = KEY_TOKEN in map ? decrypt(map[KEY_TOKEN]) : null;
  } catch (e) {
    console.error("[TELEGRAM] โหลดค่าตั้งค่าจากฐานข้อมูลไม่สำเร็จ:", e.message);
  }
}

// บันทึกค่าจากเมนูตั้งค่า (token = undefined → ไม่แก้ token, "" → ลบ token ที่ตั้งจากเมนู แล้วกลับไปใช้ .env)
async function saveConfig({ enabled, token }) {
  const upsert = (key, value) => prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  if (typeof enabled === "boolean") await upsert(KEY_ENABLED, String(enabled));
  if (token === "") await prisma.systemSetting.deleteMany({ where: { key: KEY_TOKEN } });
  else if (token) await upsert(KEY_TOKEN, encrypt(token));
  await loadConfig();
}

function getStatus() {
  const token = getToken();
  return {
    enabled: isEnabled(),
    tokenSet: !!token,
    tokenHint: token ? `${token.split(":")[0]}:••••${token.slice(-4)}` : "",
    source: dbToken ? "web" : token ? "env" : "none",
  };
}

// ตรวจ token กับ Telegram — คืนชื่อบอท หรือ throw ถ้า token ไม่ถูกต้อง
async function verifyToken(token) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error("Bot Token ไม่ถูกต้อง: " + (data.description || `HTTP ${res.status}`));
  return data.result.username;
}

const escapeHtml = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// ส่งข้อความหา chat id หนึ่ง — ไม่ throw (กันกระทบ flow หลัก) เว้นแต่ throwOnError=true
async function sendMessage(chatId, text, { throwOnError = false } = {}) {
  const token = getToken();
  if (!isEnabled() || !token) {
    if (throwOnError) throw new Error("ยังไม่ได้เปิด/ตั้งค่า Telegram — ตั้งได้ที่เมนู ตั้งค่าระบบ (หรือ TELEGRAM_ENABLED / TELEGRAM_BOT_TOKEN ใน .env)");
    return { skipped: true };
  }
  if (!chatId) return { skipped: true };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const msg = data.description || `HTTP ${res.status}`;
      if (throwOnError) throw new Error("Telegram: " + msg);
      console.error("[TELEGRAM] ส่งไม่สำเร็จ:", msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    if (throwOnError) throw e;
    console.error("[TELEGRAM] error:", e.message);
    return { ok: false, error: e.message };
  }
}

// จัดรูปข้อความแจ้งเตือนมาตรฐาน
function formatNotification(title, body) {
  return `🔔 <b>${escapeHtml(title)}</b>` + (body ? `\n${escapeHtml(body)}` : "");
}

module.exports = {
  sendMessage,
  formatNotification,
  loadConfig,
  saveConfig,
  getStatus,
  verifyToken,
  isEnabled,
  get TELEGRAM_ENABLED() { return isEnabled() && !!getToken(); },
};
