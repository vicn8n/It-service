const prisma = require("../db");
const { nextTicketNo } = require("../utils/ticketNo");
const { computeSlaDeadlines } = require("./sla");
const { autoAssign } = require("./assign");
const { notify } = require("./notify");

// ───────── config ─────────
const IMAP_ENABLED = String(process.env.IMAP_ENABLED || "").toLowerCase() === "true";
const CFG = {
  host: process.env.IMAP_HOST,
  port: Number(process.env.IMAP_PORT || 993),
  user: process.env.IMAP_USER,
  pass: process.env.IMAP_PASS,
  tls: String(process.env.IMAP_TLS ?? "true").toLowerCase() !== "false",
  pollSeconds: Number(process.env.IMAP_POLL_SECONDS || 60),
  mailbox: process.env.IMAP_MAILBOX || "INBOX",
};

const TICKET_RE = /\b(INC-\d{4,}(?:-\d{4,})?)\b/i; // INC-0032 (เลขเดิม) และ INC-2610-0001 (รายเดือน)

// โดเมนที่ยอมรับอีเมลขาเข้า — From address ปลอมได้ จึงต้องจำกัดไว้เสมอ
const ALLOWED_DOMAINS = String(process.env.IMAP_ALLOWED_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

function isAllowedSender(email) {
  if (!ALLOWED_DOMAINS.length) return false;
  const domain = email.split("@")[1];
  return Boolean(domain) && ALLOWED_DOMAINS.includes(domain);
}

// หาผู้แจ้งจากอีเมล — สร้างบัญชีใหม่เฉพาะโดเมนที่อนุญาต และตั้งเป็น inactive
// เพื่อไม่ให้กลายเป็นบัญชีที่ใช้ล็อกอินหรือถูกยึดได้ภายหลัง
async function findOrCreateRequester(email, name) {
  const lower = email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email: lower } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: lower, fullName: name || lower, role: "USER", authProvider: "LOCAL", isActive: false },
    });
  }
  return user;
}

/**
 * แปลงอีเมล 1 ฉบับเป็น ticket (หรือ comment ถ้าอ้างถึง ticket เดิมใน subject)
 * mail: { fromEmail, fromName, subject, text }
 * คืน { action: "comment"|"created"|"skipped", ticketNo? , ticketId? }
 */
async function createTicketFromEmail(mail) {
  const fromEmail = (mail.fromEmail || "").trim().toLowerCase();
  if (!fromEmail) return { action: "skipped", reason: "no-sender" };
  if (!isAllowedSender(fromEmail)) return { action: "skipped", reason: "sender-not-allowed" };
  const subject = (mail.subject || "(ไม่มีหัวข้อ)").trim();
  const body = (mail.text || "").trim() || "(อีเมลไม่มีเนื้อหา)";

  const requester = await findOrCreateRequester(fromEmail, mail.fromName);

  // 1) ตอบกลับ ticket เดิม → เพิ่มเป็น comment
  const m = subject.match(TICKET_RE);
  if (m) {
    const existing = await prisma.ticket.findUnique({ where: { ticketNo: m[1].toUpperCase() } });
    if (existing) {
      // เลข ticket ในหัวเรื่องเดาได้ — ต่อ comment เฉพาะผู้ที่เกี่ยวข้องกับ ticket นั้นจริง
      if (existing.requesterId !== requester.id && existing.assigneeId !== requester.id) {
        return { action: "skipped", reason: "not-a-participant", ticketNo: existing.ticketNo };
      }
      await prisma.ticketComment.create({
        data: { ticketId: existing.id, authorId: requester.id, body: `📧 ตอบกลับทางอีเมล:\n${body}`, isInternal: false },
      });
      if (existing.assigneeId)
        await notify(existing.assigneeId, `${existing.ticketNo} มีการตอบกลับทางอีเมล`, subject, `ticket-detail:${existing.id}`);
      return { action: "comment", ticketNo: existing.ticketNo, ticketId: existing.id };
    }
  }

  // 2) สร้าง ticket ใหม่
  const cleanSubject = subject.replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").trim() || "แจ้งปัญหาทางอีเมล";
  const priority = "MEDIUM";
  const { responseDueAt, resolveDueAt } = await computeSlaDeadlines(priority, null);
  const { assigneeId, teamId } = await autoAssign(null);

  const ticket = await prisma.$transaction(async (tx) => {
    const ticketNo = await nextTicketNo(tx);
    return tx.ticket.create({
      data: {
        ticketNo,
        type: "INCIDENT",
        subject: cleanSubject.slice(0, 200),
        description: body.slice(0, 5000),
        priority,
        status: assigneeId ? "ASSIGNED" : "NEW",
        assigneeId,
        teamId,
        requesterId: requester.id,
        responseDueAt,
        resolveDueAt,
      },
    });
  });

  if (assigneeId) await notify(assigneeId, `ticket ใหม่จากอีเมล: ${ticket.ticketNo}`, cleanSubject, `ticket-detail:${ticket.id}`);
  return { action: "created", ticketNo: ticket.ticketNo, ticketId: ticket.id };
}

// ───────── IMAP polling ─────────
let timer = null;
let polling = false;

async function pollOnce() {
  if (polling) return { skipped: true };
  polling = true;
  let client;
  try {
    const { ImapFlow } = require("imapflow");
    const { simpleParser } = require("mailparser");
    client = new ImapFlow({
      host: CFG.host, port: CFG.port, secure: CFG.tls,
      auth: { user: CFG.user, pass: CFG.pass }, logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock(CFG.mailbox);
    let processed = 0;
    try {
      for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
        try {
          const parsed = await simpleParser(msg.source);
          const res = await createTicketFromEmail({
            fromEmail: parsed.from?.value?.[0]?.address,
            fromName: parsed.from?.value?.[0]?.name,
            subject: parsed.subject,
            text: parsed.text || parsed.html?.replace(/<[^>]+>/g, " "),
          });
          await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
          processed++;
          console.log(`📧 [email-ingest] ${res.action} ${res.ticketNo || ""} จาก ${parsed.from?.text || "?"}`);
        } catch (e) {
          console.error("[email-ingest] ประมวลผลอีเมลล้มเหลว:", e.message);
        }
      }
    } finally {
      lock.release();
    }
    return { processed };
  } catch (e) {
    console.error("[email-ingest] เชื่อมต่อ IMAP ล้มเหลว:", e.message);
    return { error: e.message };
  } finally {
    if (client) await client.logout().catch(() => {});
    polling = false;
  }
}

function startEmailIngest() {
  if (!IMAP_ENABLED) {
    console.log("ℹ️  Email-to-Ticket: ปิดอยู่ (ตั้ง IMAP_ENABLED=true เพื่อเปิด)");
    return;
  }
  if (!CFG.host || !CFG.user || !CFG.pass) {
    console.warn("⚠️  Email-to-Ticket: เปิดไว้แต่ยังตั้ง IMAP_HOST/USER/PASS ไม่ครบ — ข้าม");
    return;
  }
  if (!ALLOWED_DOMAINS.length) {
    console.warn("⚠️  Email-to-Ticket: ยังไม่ได้ตั้ง IMAP_ALLOWED_DOMAINS — ข้าม (From address ปลอมได้ จึงต้องจำกัดโดเมน)");
    return;
  }
  console.log(`📧 Email-to-Ticket: เปิดใช้งาน (poll ทุก ${CFG.pollSeconds} วินาที จาก ${CFG.user})`);
  pollOnce();
  timer = setInterval(pollOnce, CFG.pollSeconds * 1000);
}

function stopEmailIngest() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startEmailIngest, stopEmailIngest, pollOnce, createTicketFromEmail, IMAP_ENABLED };
