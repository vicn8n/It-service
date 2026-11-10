const prisma = require("../db");
const telegram = require("./telegram");
const { sendMail, EMAIL_ENABLED, escapeHtml, appLink } = require("./email");

// สร้าง in-app notification ให้ผู้ใช้ + ส่ง Telegram/Email (ถ้าเปิดไว้) — ไม่ throw เพื่อไม่กระทบ flow หลัก
async function notify(userId, title, body, link) {
  try {
    await prisma.userNotification.create({ data: { userId, title, body: body || null, link: link || null } });
  } catch (e) {
    console.error("[NOTIFY] สร้าง notification ไม่สำเร็จ:", e.message);
  }
  // ช่องทาง Telegram (เสริม) — fire-and-forget
  if (telegram.TELEGRAM_ENABLED) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
      if (user?.telegramChatId) {
        telegram.sendMessage(user.telegramChatId, telegram.formatNotification(title, body)).catch(() => {});
      }
    } catch (e) {
      console.error("[NOTIFY] telegram lookup ล้มเหลว:", e.message);
    }
  }
  // ช่องทาง Email (เสริม) — fire-and-forget
  if (EMAIL_ENABLED) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailNotify: true } });
      if (user?.emailNotify && user.email) {
        const appUrl = appLink(link);
        const html = `
          <div style="font-family:Prompt,'Segoe UI',Tahoma,sans-serif;color:#1f2937">
            <h2 style="color:#2563eb">IT Service Desk</h2>
            <p><b>${escapeHtml(title)}</b></p>
            ${body ? `<p>${escapeHtml(body)}</p>` : ""}
            ${appUrl ? `<p><a href="${escapeHtml(appUrl)}" style="background:#2563eb;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">ดูรายละเอียด</a></p>` : ""}
            <p style="color:#9ca3af;font-size:12px">อีเมลนี้ส่งจากระบบอัตโนมัติ</p>
          </div>`;
        sendMail(user.email, title, html).catch(() => {});
      }
    } catch (e) {
      console.error("[NOTIFY] email lookup ล้มเหลว:", e.message);
    }
  }
}

// แจ้งหลายคนพร้อมกัน
async function notifyMany(userIds, title, body, link) {
  await Promise.all([...new Set(userIds)].filter(Boolean).map((id) => notify(id, title, body, link)));
}

module.exports = { notify, notifyMany };
