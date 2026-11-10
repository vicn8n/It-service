const nodemailer = require("nodemailer");
const prisma = require("../db");

let transporter = null;
const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";

if (EMAIL_ENABLED) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// ส่งอีเมล + บันทึกลงตาราง notifications เสมอ (เพื่อ audit/retry)
async function sendMail(toEmail, subject, body) {
  const record = await prisma.notification.create({
    data: { toEmail, subject, body, sent: false },
  });

  if (!EMAIL_ENABLED || !transporter) {
    return record; // โหมด log อย่างเดียว
  }

  // ต้องคืน record ที่ update แล้วเสมอ ไม่ใช่ค่าจากก่อนส่ง
  // ไม่งั้นผู้เรียกที่ตรวจ record.error จะไม่เห็นความล้มเหลว
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: toEmail,
      subject,
      html: body,
    });
    return await prisma.notification.update({
      where: { id: record.id },
      data: { sent: true, sentAt: new Date() },
    });
  } catch (e) {
    console.error("[EMAIL] ส่งไม่สำเร็จ:", e.message);
    return await prisma.notification.update({
      where: { id: record.id },
      data: { error: e.message },
    });
  }
}

// escape ก่อนใส่ลง HTML — หัวข้อ ticket มาจากผู้ใช้
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// template แจ้งเปลี่ยนสถานะ ticket
const STATUS_LABEL = {
  NEW: "ใหม่",
  ASSIGNED: "มอบหมายแล้ว",
  IN_PROGRESS: "กำลังดำเนินการ",
  PENDING: "รอดำเนินการ",
  RESOLVED: "แก้ไขแล้ว",
  CLOSED: "ปิดงาน",
  CANCELLED: "ยกเลิก",
};

// ลิงก์เข้าหน้าในแอปโดยตรง — link รูปแบบเดียวกับ in-app notification เช่น "ticket-detail:12"
function appLink(link) {
  const base = String(process.env.APP_URL || "").replace(/\/+$/, "");
  if (!base) return "";
  if (!link) return base + "/";
  const [route, id] = String(link).split(":");
  return `${base}/#/${encodeURIComponent(route)}${id ? `?id=${encodeURIComponent(id)}` : ""}`;
}

async function notifyTicketStatus(ticket, recipientEmail) {
  const appUrl = appLink(`ticket-detail:${ticket.id}`);
  const subject = `[${ticket.ticketNo}] อัปเดตสถานะ: ${STATUS_LABEL[ticket.status] || ticket.status}`;
  const body = `
    <div style="font-family:Prompt,'Segoe UI',Tahoma,sans-serif;color:#1f2937">
      <h2 style="color:#2563eb">IT Service Desk</h2>
      <p>เรียนผู้แจ้ง,</p>
      <p>คำร้องแจ้งซ่อม <b>${esc(ticket.ticketNo)}</b> ของท่านมีการอัปเดต</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:4px 12px;color:#6b7280">หัวข้อ</td><td style="padding:4px 12px"><b>${esc(ticket.subject)}</b></td></tr>
        <tr><td style="padding:4px 12px;color:#6b7280">สถานะ</td><td style="padding:4px 12px"><b>${esc(STATUS_LABEL[ticket.status] || ticket.status)}</b></td></tr>
      </table>
      ${appUrl ? `<p><a href="${esc(appUrl)}" style="background:#2563eb;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">ดูรายละเอียด</a></p>` : ""}
      <p style="color:#9ca3af;font-size:12px">อีเมลนี้ส่งจากระบบอัตโนมัติ</p>
    </div>`;
  return sendMail(recipientEmail, subject, body);
}

module.exports = { sendMail, notifyTicketStatus, EMAIL_ENABLED, escapeHtml: esc, appLink };
