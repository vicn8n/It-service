// UI helpers — label, badge, format, toast, modal
const TICKET_STATUS = {
  NEW: "ใหม่", AWAITING_APPROVAL: "รออนุมัติ", ASSIGNED: "มอบหมายแล้ว", IN_PROGRESS: "กำลังดำเนินการ",
  PENDING: "รอดำเนินการ", RESOLVED: "แก้ไขแล้ว", CLOSED: "ปิด", CANCELLED: "ยกเลิก",
};
const PRIORITY = { CRITICAL: "วิกฤต", HIGH: "สูง", MEDIUM: "กลาง", LOW: "ต่ำ" };
const ASSET_STATUS = {
  IN_USE: "ใช้งานอยู่", IN_STOCK: "ว่าง/พร้อมใช้", REPAIR: "อยู่ระหว่างซ่อม",
  LOANED: "ยืมออก", RETIRED: "รอจำหน่าย", DISPOSED: "จำหน่ายแล้ว",
};
const ROLE = { ADMIN: "ผู้ดูแลระบบ", MANAGER: "หัวหน้า/ผู้อนุมัติ", AGENT: "เจ้าหน้าที่ IT", USER: "ผู้ใช้งาน" };
const PROBLEM_STATUS = { OPEN: "เปิด", INVESTIGATING: "กำลังวิเคราะห์", KNOWN_ERROR: "ทราบสาเหตุ (มี workaround)", RESOLVED: "แก้ไขแล้ว", CLOSED: "ปิด" };
const CHANGE_STATUS = { DRAFT: "ร่าง", SUBMITTED: "ส่งขออนุมัติ", APPROVED: "อนุมัติแล้ว", SCHEDULED: "นัดดำเนินการ", IN_PROGRESS: "กำลังทำ", COMPLETED: "สำเร็จ", FAILED: "ล้มเหลว", CANCELLED: "ยกเลิก" };
const CHANGE_TYPE = { STANDARD: "มาตรฐาน", NORMAL: "ปกติ", EMERGENCY: "ฉุกเฉิน" };
const STATUS_FLOW = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ───────── คลิกผ่าน data-* แทน inline onclick (CSP ห้าม inline script) ─────────
// navAttr("ticket-detail", { id: 5 })  → คลิกแล้ว navigate ไปหน้านั้น (Ctrl/กลางเมาส์ = แท็บใหม่)
// callAttr("teamForm", 3)              → คลิกแล้วเรียกฟังก์ชันใน CALLABLE พร้อมอาร์กิวเมนต์ (ต้องเป็น JSON ได้)
function navAttr(route, params = {}) {
  const p = Object.keys(params).length ? ` data-params="${esc(JSON.stringify(params))}"` : "";
  return `data-nav="${esc(route)}"${p}`;
}
function callAttr(fn, ...args) {
  return `data-call="${esc(fn)}" data-args="${esc(JSON.stringify(args))}"`;
}
// ฟังก์ชันที่ data-call เรียกได้ — จำกัดไว้ ไม่ให้ attribute เรียกอะไรก็ได้บน window
const CALLABLE = new Set([
  "userForm", "teamForm", "teamDelete", "unlinkTicket", "problemForm", "changeStatus", "changeForm",
  "decideApproval", "kbDeleteAttachment", "licenseForm", "vendorForm", "contractForm", "toast",
  "removeRelation", "removeUserRelation", "removeSoftwareRelation",
]);
function readParams(el) {
  try { return el.dataset.params ? JSON.parse(el.dataset.params) : {}; } catch { return {}; }
}
function runAction(el, e) {
  if (el.disabled || el.getAttribute("aria-disabled") === "true") return;
  if (el.dataset.nav) {
    const params = readParams(el);
    if (e && (e.ctrlKey || e.metaKey || e.button === 1)) {
      window.open(routeUrl(el.dataset.nav, params), "_blank", "noopener");
      return;
    }
    navigate(el.dataset.nav, params);
    return;
  }
  const fn = el.dataset.call;
  if (!CALLABLE.has(fn) || typeof window[fn] !== "function") return console.warn("data-call ไม่รู้จัก:", fn);
  let args = [];
  try { args = JSON.parse(el.dataset.args || "[]"); } catch {}
  window[fn](...args);
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-nav], [data-call]");
  if (!el || !document.contains(el)) return;
  runAction(el, e);
});
document.addEventListener("auxclick", (e) => {
  if (e.button !== 1) return;
  const el = e.target.closest("[data-nav]");
  if (el) { e.preventDefault(); runAction(el, e); }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const el = e.target.closest("[data-nav][tabindex], [data-call][tabindex]");
  if (el && el === e.target) runAction(el, e);
});

function statusBadge(s) { return `<span class="badge b-${s}">${esc(TICKET_STATUS[s] || ASSET_STATUS[s] || s)}</span>`; }
function priorityTag(p) { return `<span class="prio p-${p}">${esc(PRIORITY[p] || p)}</span>`; }

// ตรึงเป็นเวลาไทยเสมอ ไม่ให้เปลี่ยนตาม timezone ของเครื่องผู้ใช้
// (dashboard ฝั่ง server คิดตาม Asia/Bangkok อยู่แล้ว ต้องให้ตรงกัน)
const TZ = "Asia/Bangkok";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("th-TH", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("th-TH", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
// yyyy-mm-dd ตามเวลาไทย สำหรับ <input type="date">
// ห้ามใช้ toISOString().slice(0,10) เพราะจะถอยไป 1 วันเมื่อเวลาไทยอยู่ก่อน 07:00
function toDateInputValue(d) {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  return parts;
}
function fmtMoney(n) { return n == null ? "—" : "฿" + Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2 }); }
function initials(name) { return (name || "?").trim().charAt(0); }

function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function modal(html) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

// SLA indicator
function slaTag(ticket) {
  if (["CLOSED", "CANCELLED", "RESOLVED"].includes(ticket.status))
    return `<span style="color:var(--gray-400);font-size:12px">—</span>`;
  if (ticket.slaBreached) return `<span style="color:var(--danger);font-weight:600;font-size:12px">🔴 เกิน SLA</span>`;
  if (!ticket.resolveDueAt) return "—";
  const left = new Date(ticket.resolveDueAt) - Date.now();
  if (left < 0) return `<span style="color:var(--danger);font-weight:600;font-size:12px">🔴 เกิน SLA</span>`;
  // เทียบเกณฑ์จากเวลาจริง แล้วค่อยปัดเพื่อแสดงผล ไม่งั้นสีจะสลับไปมาที่ขอบ 2 ชม.
  const warning = left <= 2 * 3_600_000;
  const color = warning ? "var(--warning)" : "var(--success)";
  const dot = warning ? "🟡" : "🟢";
  const label = left < 3_600_000 ? `${Math.max(1, Math.round(left / 60_000))} นาที` : `${Math.floor(left / 3_600_000)} ชม.`;
  return `<span style="color:${color};font-size:12px">${dot} เหลือ ${label}</span>`;
}
