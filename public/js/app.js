// App bootstrap + router
const State = { user: null };
let lastUnreadNotifications = null;

// ───────── Theme (dark mode) ─────────
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}
(function initTheme() {
  applyTheme(localStorage.getItem("theme") || "light");
  document.addEventListener("click", (e) => {
    if (e.target.id === "theme-toggle") applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });
})();

// ───────── i18n (TH ↔ EN) — แปลเมนู/แถบบน (เนื้อหาหน้ายังเป็นไทย) ─────────
const I18N = {
  "แจ้งซ่อม / บริการ": "Helpdesk / Service", "รายการแจ้งซ่อม": "Tickets", "แจ้งซ่อม / ขอบริการ": "New Request",
  "งานรออนุมัติ": "Approvals", "คลังความรู้": "Knowledge Base", "ทรัพย์สิน IT": "IT Assets",
  "ภาพรวมทรัพย์สิน": "Asset Overview", "รายการทรัพย์สิน": "Asset Inventory", "เพิ่มทรัพย์สิน": "Add Asset",
  "ผู้จำหน่าย": "Vendors", "สัญญา/ประกัน": "Contracts / Warranty", "ตรวจนับทรัพย์สิน": "Stock-take",
  "รายงานค่าเสื่อม": "Depreciation", "รายงาน & ผู้ดูแล": "Reports & Admin", "รายงาน & วิเคราะห์": "Reports & Analytics",
  "ผู้ใช้งาน": "Users", "ทีม / คิวงาน": "Teams / Queues", "ตั้งค่าระบบ": "Settings", "บัญชีของฉัน": "My Account",
  "ออกจากระบบ": "Logout", "IT Service Management": "IT Service Management",
  "อีเมล": "Email", "รหัสผ่าน": "Password", "เข้าสู่ระบบ": "Sign in",
};
function translateChrome(lang) {
  const tr = (th) => (lang === "en" ? I18N[th] || th : th);
  document.querySelectorAll(".sidebar-label, .nav-item, #logout-btn, .login-logo .s, label").forEach((el) => {
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3 && n.textContent.trim()) {
        if (n.__th === undefined) n.__th = n.textContent.trim();
        n.textContent = (lang === "en" ? (I18N[n.__th] || n.__th) : n.__th);
        if (el.classList.contains("nav-item")) n.textContent = " " + n.textContent + " ";
      }
    });
  });
  const search = document.getElementById("global-search");
  if (search) { if (!search.dataset.th) search.dataset.th = search.placeholder; search.placeholder = lang === "en" ? "Search tickets, assets, KB..." : search.dataset.th; }
}
function applyLang(lang) {
  localStorage.setItem("lang", lang);
  document.documentElement.lang = lang;
  const btn = document.getElementById("lang-toggle");
  if (btn) btn.textContent = lang === "en" ? "TH" : "EN";
  translateChrome(lang);
}
(function initLang() {
  document.addEventListener("click", (e) => {
    if (e.target.id === "lang-toggle") applyLang(localStorage.getItem("lang") === "en" ? "th" : "en");
  });
  applyLang(localStorage.getItem("lang") || "th");
})();

// ───────── URL routing (#/route?key=value) ─────────
// รีเฟรชแล้วอยู่หน้าเดิม, ปุ่ม Back/Forward ใช้ได้, ส่งลิงก์หน้าใดหน้าหนึ่งให้คนอื่นได้
const DEFAULT_ROUTE = "helpdesk";
// พารามิเตอร์ที่เป็นตัวเลข — อ่านกลับจาก URL แล้วแปลงเป็น Number ให้เหมือนตอน navigate ในแอป
const NUMERIC_PARAM = /^(id|page|pageSize|.+Id)$/;

function routeUrl(route, params = {}) {
  return "#/" + encodeURIComponent(route) + qs(params || {});
}
function parseLocation() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) return { route: DEFAULT_ROUTE, params: {} };
  const [path, query = ""] = raw.split("?");
  let route = DEFAULT_ROUTE;
  try { route = decodeURIComponent(path) || DEFAULT_ROUTE; } catch {}
  const params = {};
  new URLSearchParams(query).forEach((v, k) => {
    params[k] = NUMERIC_PARAM.test(k) && /^-?\d+$/.test(v) ? Number(v) : v;
  });
  return { route, params };
}
// ลิงก์จากแจ้งเตือนเก่าใช้รูปแบบ "route:id"
function linkToRoute(link) {
  const [route, id] = String(link || "").split(":");
  return { route: route || DEFAULT_ROUTE, params: id ? { id: Number(id) } : {} };
}

window.addEventListener("popstate", (e) => {
  if (!State.user) return;
  const target = e.state?.route ? e.state : parseLocation();
  navigate(target.route, target.params || {}, { history: "none" });
});

let navSeq = 0;
// opts.history: "push" (ค่าเริ่มต้น) | "replace" | "none"
async function navigate(route, params = {}, opts = {}) {
  params = params || {};
  const mode = opts.history || "push";
  const url = routeUrl(route, params);
  if (mode !== "none") {
    const state = { route, params };
    // เปลี่ยนตัวกรอง/หน้าในหน้าเดิม (route และ id เดิม) = แทนที่ ไม่สร้างประวัติ Back ทีละตัวอักษร
    const cur = history.state;
    const sameView = cur && cur.route === route && (cur.params?.id ?? null) === (params.id ?? null);
    if (mode === "push" && location.hash !== url && !sameView) history.pushState(state, "", url);
    else history.replaceState(state, "", url);
  }
  const seq = ++navSeq; // กันหน้าที่โหลดช้ากว่ามาทับหน้าที่กดทีหลัง
  const content = document.getElementById("content");
  content.innerHTML = '<div class="spinner"></div>';

  // highlight nav
  document.querySelectorAll(".nav-item").forEach((n) =>
    n.classList.toggle("active", n.dataset.route === route)
  );

  const renderer = Pages[route];
  if (!renderer) { content.innerHTML = '<div class="empty">ไม่พบหน้านี้</div>'; return; }
  if (State.permissions && State.permissions[route] === false) {
    content.innerHTML = '<div class="empty">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>';
    document.getElementById("page-title").textContent = "ไม่มีสิทธิ์เข้าถึง";
    return;
  }

  try {
    const { title, html, after } = await renderer(params);
    if (seq !== navSeq) return;
    document.getElementById("page-title").textContent = title;
    document.title = `${title} · IT Service Desk`;
    content.innerHTML = html;
    if (after) after();
    window.scrollTo(0, 0);
  } catch (e) {
    if (e.message === "กรุณาเข้าสู่ระบบ" || seq !== navSeq) return;
    content.innerHTML = `<div class="empty">เกิดข้อผิดพลาด: ${esc(e.message)}</div>`;
  }
}

function applyRoleVisibility() {
  document.querySelectorAll("[data-roles]").forEach((el) => {
    const allowed = el.dataset.roles.split(",");
    el.classList.toggle("hidden", !allowed.includes(State.user.role));
  });
}

// ซ่อนเมนูตามสิทธิ์ RBAC ที่ตั้งค่าไว้ใน "ตั้งค่าระบบ" (ทับ data-roles เดิม)
async function applyRbacVisibility() {
  try {
    const perms = await api.get("/rbac/my-permissions");
    State.permissions = perms;
    document.querySelectorAll(".nav-item[data-route]").forEach((el) => {
      if (perms[el.dataset.route] === false) el.classList.add("hidden");
    });
  } catch {}
}

function showApp(user) {
  State.user = user;
  lastUnreadNotifications = null;
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");
  document.getElementById("user-name").textContent = user.fullName;
  document.getElementById("user-role").textContent = ROLE[user.role] || user.role;
  document.getElementById("user-avatar").textContent = initials(user.fullName);
  if (user.department?.name) document.getElementById("org-name").textContent = user.department.name;
  applyRoleVisibility();
  applyRbacVisibility();
  applyLang(localStorage.getItem("lang") || "th");
  // เปิดหน้าตาม URL (รีเฟรช / ลิงก์จากอีเมล) — ไม่มีก็ไป Dashboard
  const start = parseLocation();
  navigate(start.route, start.params, { history: "replace" });
  refreshBadges();
}

// โหลดจำนวนงานรออนุมัติ + เคสแจ้งซ่อมใหม่ + การแจ้งเตือนที่ยังไม่อ่าน
async function refreshBadges() {
  if (["ADMIN", "MANAGER", "AGENT"].includes(State.user.role)) {
    try {
      const { count } = await api.get("/tickets/new-count");
      const t = document.getElementById("tickets-badge");
      t.textContent = count; t.classList.toggle("hidden", !count);
    } catch {}
  }
  try {
    const { items, unread } = await api.get("/notifications");
    const d = document.getElementById("notif-dot");
    d.textContent = unread; d.classList.toggle("hidden", !unread);
    if (lastUnreadNotifications != null && unread > lastUnreadNotifications) {
      const latest = (items || []).find((n) => !n.isRead) || (items || [])[0];
      toast(latest ? `แจ้งเตือนใหม่: ${latest.title}` : `มีการแจ้งเตือนใหม่ ${unread - lastUnreadNotifications} รายการ`, "success");
    }
    lastUnreadNotifications = unread;
  } catch {}
}

// รีเฟรช badge ทุก 30 วินาที เพื่อแจ้งเคสแจ้งซ่อมเข้าใหม่ใกล้เคียง real-time
setInterval(() => { if (State.user) refreshBadges(); }, 30_000);

// กระดิ่งแจ้งเตือน
document.getElementById("notif-bell").addEventListener("click", async (e) => {
  const panel = document.getElementById("notif-panel");
  if (e.target.closest(".notif-panel")) return; // คลิกในพาเนลไม่ปิด
  if (!panel.classList.contains("hidden")) { panel.classList.add("hidden"); return; }
  try {
    const { items } = await api.get("/notifications");
    // ใส่ link เป็น data attribute แล้วผูก handler ทีหลัง — ห้าม interpolate ลง onclick
    panel.innerHTML = items.length
      ? items.map((n) => `<div class="notif-item ${n.isRead ? "" : "unread"}"${n.link ? ` data-link="${esc(n.link)}"` : ""}>
          <div style="font-weight:600">${esc(n.title)}</div>${n.body ? `<div style="color:var(--gray-500);font-size:12px;margin-top:2px">${esc(n.body)}</div>` : ""}
          <div style="color:var(--gray-400);font-size:11px;margin-top:3px">${fmtDateTime(n.createdAt)}</div></div>`).join("")
      : '<div class="empty">ไม่มีการแจ้งเตือน</div>';
    panel.querySelectorAll(".notif-item[data-link]").forEach((el) => {
      el.onclick = () => openNotif(el.dataset.link);
    });
    panel.classList.remove("hidden");
    await api.post("/notifications/read", {});
    setTimeout(refreshBadges, 500);
  } catch (err) { toast(err.message, "error"); }
});
function openNotif(link) {
  const { route, params } = linkToRoute(link);
  document.getElementById("notif-panel").classList.add("hidden");
  navigate(route, params);
}
// ปิดพาเนลเมื่อคลิกที่อื่น
document.addEventListener("click", (e) => {
  if (!e.target.closest("#notif-bell")) document.getElementById("notif-panel")?.classList.add("hidden");
});

// ───────── Global Search ─────────
(function initGlobalSearch() {
  const input = document.getElementById("global-search");
  const box = document.getElementById("gs-results");
  if (!input || !box) return;
  let timer = null, lastQ = "";

  const render = (data) => {
    if (!data.groups.length) {
      box.innerHTML = `<div class="gs-empty">ไม่พบผลลัพธ์สำหรับ "${esc(data.q)}"</div>`;
      box.classList.remove("hidden");
      return;
    }
    box.innerHTML = data.groups.map((g) =>
      `<div class="gs-group-label">${esc(g.label)}</div>` +
      g.items.map((it) =>
        `<div class="gs-item" data-route="${esc(g.route)}" data-id="${esc(it.id)}">
          <div style="min-width:0">
            <div class="gs-t">${esc(it.title)}</div>
            ${it.sub ? `<div class="gs-s">${esc(it.sub)}</div>` : ""}
          </div>
          ${it.tag ? `<span class="gs-tag">${esc(it.tag)}</span>` : ""}
        </div>`).join("")
    ).join("");
    box.querySelectorAll(".gs-item").forEach((el) => {
      el.onclick = () => {
        const route = el.dataset.route, id = Number(el.dataset.id);
        box.classList.add("hidden"); input.value = ""; lastQ = "";
        navigate(route, route === "users" ? {} : { id });
      };
    });
    box.classList.remove("hidden");
  };

  const run = async () => {
    const q = input.value.trim();
    if (q === lastQ) return;
    lastQ = q;
    if (q.length < 2) { box.classList.add("hidden"); return; }
    box.innerHTML = '<div class="gs-hint">กำลังค้นหา...</div>';
    box.classList.remove("hidden");
    try { render(await api.get("/search?q=" + encodeURIComponent(q))); }
    catch { box.classList.add("hidden"); }
  };

  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 280); });
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) box.classList.remove("hidden"); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { box.classList.add("hidden"); input.blur(); } });
  document.addEventListener("click", (e) => { if (!e.target.closest(".global-search")) box.classList.add("hidden"); });
})();

function showLogin() {
  // ล้าง cache ทุกอย่างที่ผูกกับผู้ใช้คนก่อน ไม่งั้นคนที่ล็อกอินต่อในแท็บเดิมจะได้ RBAC/ข้อมูลของคนก่อน
  State.user = null;
  State.permissions = {};
  if (typeof META !== "undefined") META = EMPTY_META();
  if (typeof resetPageCache === "function") resetPageCache();
  document.getElementById("app-view").classList.add("hidden");
  document.getElementById("login-view").classList.remove("hidden");
}

// เมนูบนมือถือ — sidebar ถูกซ่อนที่จอ <900px จึงต้องมีปุ่มเปิด
const appShell = document.getElementById("app-view");
function closeNav() {
  appShell.classList.remove("nav-open");
  document.getElementById("nav-toggle")?.setAttribute("aria-expanded", "false");
}
document.getElementById("nav-toggle")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = appShell.classList.toggle("nav-open");
  e.currentTarget.setAttribute("aria-expanded", String(open));
});
document.getElementById("nav-scrim")?.addEventListener("click", closeNav);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNav(); });

// nav clicks
document.querySelectorAll(".nav-item").forEach((n) =>
  n.addEventListener("click", () => { closeNav(); navigate(n.dataset.route); })
);

// logout
document.getElementById("logout-btn").onclick = async () => {
  await api.post("/auth/logout").catch(() => {});
  // ออกเอง = ไม่ต้องจำหน้าเดิม (คนถัดไปที่ล็อกอินเครื่องนี้เริ่มที่ Dashboard)
  history.replaceState(null, "", location.pathname);
  showLogin();
};

// session expiry
window.addEventListener("unauthorized", showLogin);

let authMode = "login";

async function loadRegisterOptions() {
  const dept = document.getElementById("register-department");
  if (!dept || dept.dataset.loaded) return;
  try {
    const data = await api.get("/auth/register-options");
    dept.innerHTML = '<option value="">— ไม่ระบุ —</option>' + (data.departments || []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
    dept.dataset.loaded = "1";
  } catch {}
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === "register";
  document.querySelectorAll(".auth-register-field").forEach((el) => el.classList.toggle("hidden", !isRegister));
  document.querySelectorAll(".auth-login-field").forEach((el) => el.classList.toggle("hidden", isRegister));
  document.getElementById("login-totp-group").classList.add("hidden");
  document.getElementById("auth-login-tab").classList.toggle("active", !isRegister);
  document.getElementById("auth-register-tab").classList.toggle("active", isRegister);
  document.getElementById("login-password").autocomplete = isRegister ? "new-password" : "current-password";
  document.getElementById("login-email-label").textContent = isRegister ? "อีเมล (ถ้ามี)" : "ชื่อผู้ใช้ / อีเมล";
  document.getElementById("login-email").placeholder = isRegister ? "เว้นว่างได้ ถ้าไม่มีอีเมล" : "ชื่อผู้ใช้หรืออีเมล";
  document.getElementById("login-btn").textContent = isRegister ? "ลงทะเบียนและเข้าสู่ระบบ" : "เข้าสู่ระบบ";
  document.getElementById("login-error").classList.add("hidden");
  if (isRegister) loadRegisterOptions();
}

document.getElementById("auth-login-tab").onclick = () => setAuthMode("login");
document.getElementById("auth-register-tab").onclick = () => setAuthMode("register");

// login form
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  const btn = document.getElementById("login-btn");
  const oldText = btn.textContent;
  btn.disabled = true; btn.textContent = "กำลังเข้าสู่ระบบ...";
  try {
    if (authMode === "register") {
      btn.textContent = "กำลังลงทะเบียน...";
      const password = document.getElementById("login-password").value;
      const confirm = document.getElementById("register-confirm-password").value;
      const fullName = document.getElementById("register-full-name").value.trim();
      const email = "";
      const username = document.getElementById("register-username").value.trim();
      if (!fullName) throw new Error("กรุณากรอกชื่อ-สกุล");
      if (!username) throw new Error("กรุณากรอกชื่อผู้ใช้");
      if (!/^\S{3,40}$/u.test(username)) throw new Error("ชื่อผู้ใช้ต้องยาว 3-40 ตัว และห้ามเว้นวรรค");
      if (password !== confirm) throw new Error("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
      const resp = await api.post("/auth/register", {
        fullName,
        email: email || undefined,
        username,
        password,
        departmentId: document.getElementById("register-department").value || undefined,
      });
      showApp(resp.user);
      return;
    }
    const totpEl = document.getElementById("login-totp");
    const identifier = document.getElementById("login-email").value.trim();
    if (!identifier) throw new Error("กรุณากรอกชื่อผู้ใช้หรืออีเมล");
    const resp = await api.post("/auth/login", {
      email: identifier,
      password: document.getElementById("login-password").value,
      totp: totpEl.value || undefined,
    });
    if (resp.twoFactorRequired) {
      document.getElementById("login-totp-group").classList.remove("hidden");
      totpEl.focus();
      errEl.textContent = "กรุณากรอกรหัสยืนยัน 2 ชั้นจากแอป Authenticator";
      errEl.classList.remove("hidden");
      return;
    }
    showApp(resp.user);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = oldText;
  }
});

// initial session check
(async () => {
  try {
    const { user } = await api.get("/auth/me");
    showApp(user);
  } catch {
    showLogin();
  }
})();
