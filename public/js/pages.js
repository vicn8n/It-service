// Page renderers — แต่ละ function คืน HTML และผูก event ผ่าน afterRender
const Pages = {};
// ต้องมีครบทุกคีย์ที่ /meta คืนมา ไม่งั้น META.vendors.map() / META.catalogItems.find() จะพังเป็น TypeError
const EMPTY_META = () => ({ categories: [], departments: [], assetTypes: [], locations: [], vendors: [], catalogItems: [] });
let META = EMPTY_META(); // cache dropdown data
// ข้อมูลหน้าทีมที่ฟอร์มแก้ไขทีมต้องใช้ (ค้นด้วย id ไม่ใช่ลำดับแถว) — ล้างตอน logout ผ่าน resetPageCache()
const TeamCache = { teams: [], users: [] };
function resetPageCache() { TeamCache.teams = []; TeamCache.users = []; }

async function loadMeta() {
  if (META.categories.length) return META;
  META = await api.get("/meta");
  return META;
}

// ═══════════════ HELPDESK DASHBOARD ═══════════════
Pages.helpdesk = async (params = {}) => {
  const d = await api.get("/dashboard/helpdesk" + qs({ month: params.month || "", year: params.year || "" }));
  const { month, year } = d.period;
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat("th-TH", {
    month: "long", timeZone: "Asia/Bangkok",
  }).format(new Date(Date.UTC(2026, i, 1))));
  const currentYear = Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "Asia/Bangkok" }).format(new Date()));
  const years = Array.from(new Set([year, ...Array.from({ length: 8 }, (_, i) => currentYear - i)])).sort((a, b) => b - a);
  const periodLabel = `${months[month - 1]} ${year + 543}`;
  const sorted = [...d.byCategory].sort((a, b) => b.count - a.count);
  const catRows = sorted.map((c, i) => {
    const pct = d.kpi.total ? Math.round((c.count / d.kpi.total) * 100) : 0;
    return barRow(c.category, c.count, pct);
  }).join("") || `<div class="empty">ยังไม่มีข้อมูล</div>`;

  const segs = d.byStatus.map((s) => ({ label: TICKET_STATUS[s.status] || s.status, count: s.count, color: STATUS_COLOR[s.status] || "#94a3b8" }));
  const activeTotal = d.byStatus.reduce((a, s) => a + s.count, 0);
  const donut = segs.length ? donutChart(segs, activeTotal, "Ticket ทั้งหมด") : '<div class="empty">ยังไม่มีข้อมูล</div>';
  const priorityRows = (d.byPriority || []).map((p) => ({ label: PRIORITY[p.priority] || p.priority, count: p.count, color: PRIORITY_COLOR[p.priority] || "#94a3b8" }));

  return {
    title: "Dashboard — แจ้งซ่อม IT",
    html: `
      <div class="filter-bar dashboard-filters">
        <label for="dash-month">เดือน</label>
        <select class="filter" id="dash-month">
          ${months.map((name, i) => `<option value="${i + 1}" ${month === i + 1 ? "selected" : ""}>${name}</option>`).join("")}
        </select>
        <label for="dash-year">ปี</label>
        <select class="filter" id="dash-year">
          ${years.map((value) => `<option value="${value}" ${year === value ? "selected" : ""}>${value + 543}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm" id="dash-current-month">เดือนปัจจุบัน</button>
      </div>
      <div class="dash-hero">
        <span class="hero-deco">◎</span>
        <h2>${greeting()}, ${esc((State.user?.fullName || "").split(" ")[0] || "")}</h2>
        <p>ภาพรวมงานบริการ IT · ${periodLabel} · อัปเดตล่าสุด ${fmtDateTime(new Date())}</p>
        <div class="hero-pills">
          <span class="hero-pill is-link" ${ticketsLink({ status: STATUS_GROUP_OPEN }, month, year)}><b>${d.kpi.open}</b> งานที่ต้องดำเนินการ</span>
          <span class="hero-pill is-link" ${ticketsLink({ status: STATUS_GROUP_DONE }, month, year)}><b>${d.kpi.resolutionRate}%</b> อัตราการแก้ไข</span>
          <span class="hero-pill"><b>${d.kpi.slaCompliance}%</b> KPI SLA</span>
          <span class="hero-pill is-link" ${ticketsLink({ sla: "breached" }, month, year)}><b>${d.kpi.breached}</b> เกิน SLA</span>
        </div>
      </div>
      <div class="kpi-modern-grid">
        ${modernKpiCard("blue", "Ticket ประจำเดือน", d.kpi.total, `เปิดงานใน${periodLabel}`, d.kpi.total ? 100 : 0, ticketsLink({}, month, year))}
        ${modernKpiCard("amber", "รอดำเนินการ", d.kpi.open, "NEW / ASSIGNED / IN PROGRESS", activeTotal ? Math.round((d.kpi.open / activeTotal) * 100) : 0, ticketsLink({ status: STATUS_GROUP_OPEN }, month, year))}
        ${modernKpiCard("green", "แก้ไขแล้ว", d.kpi.resolved, `อัตราแก้ไข ${d.kpi.resolutionRate}%`, d.kpi.resolutionRate, ticketsLink({ status: STATUS_GROUP_DONE }, month, year))}
        ${modernKpiCard("red", "เกิน SLA", d.kpi.breached, `KPI SLA ${d.kpi.slaCompliance}%`, 100 - d.kpi.slaCompliance, ticketsLink({ sla: "breached" }, month, year))}
      </div>
      <div class="dashboard-lab">
        <div class="kpi-panel kpi-panel-main">
          <div class="panel-head"><div><div class="eyebrow">KPI SERVICE</div><h3>เป้าหมายแก้ไขภายใน 4 ชม.ทำงาน</h3></div><span class="panel-chip">จันทร์-ศุกร์ 08:00-18:00</span></div>
          <div class="kpi-showcase">
            ${slaGauge(d.kpi.slaCompliance, d.kpi.breached)}
            ${repairTrendChart(d.trend || [])}
          </div>
        </div>
        <div class="kpi-panel">
          <div class="panel-head"><div><div class="eyebrow">WORKLOAD</div><h3>ระดับความสำคัญประจำเดือน</h3></div></div>
          ${priorityChart(priorityRows)}
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">📊 Ticket ตามหมวดหมู่</div></div>
          <div class="card-body">${catRows}</div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">📋 สถานะ Ticket</div></div>
          <div class="card-body">${donut}</div>
        </div>
      </div>`,
    after: () => {
      const apply = () => navigate("helpdesk", { month: val("dash-month"), year: val("dash-year") });
      document.getElementById("dash-month").onchange = apply;
      document.getElementById("dash-year").onchange = apply;
      document.getElementById("dash-current-month").onclick = () => navigate("helpdesk");
      document.querySelectorAll(".repair-week").forEach((button) => {
        const show = () => {
          document.getElementById("repair-trend-detail").textContent = button.getAttribute("aria-label");
          document.querySelectorAll(".repair-week").forEach((week) => week.classList.toggle("is-active", week === button));
        };
        button.onmouseenter = show;
        button.onfocus = show;
        button.onclick = show;
      });
    },
  };
};

// ═══════════════ TICKET LIST ═══════════════
Pages.tickets = async (params = {}) => {
  await loadMeta();
  const query = { status: params.status || "", priority: params.priority || "", sla: params.sla || "", month: params.month || "", year: params.year || "", q: params.q || "", page: params.page || 1 };
  const data = await api.get("/tickets" + qs(query));
  const months = [
    ["1", "มกราคม"], ["2", "กุมภาพันธ์"], ["3", "มีนาคม"], ["4", "เมษายน"],
    ["5", "พฤษภาคม"], ["6", "มิถุนายน"], ["7", "กรกฎาคม"], ["8", "สิงหาคม"],
    ["9", "กันยายน"], ["10", "ตุลาคม"], ["11", "พฤศจิกายน"], ["12", "ธันวาคม"],
  ];
  const currentYear = new Date().getFullYear();
  const selectedYear = Number(query.year) || currentYear;
  const years = Array.from(new Set([selectedYear, ...Array.from({ length: 8 }, (_, i) => currentYear - i)])).sort((a, b) => b - a);
  const exportQuery = { ...query };
  delete exportQuery.page;

  // ใช้เฉพาะเวลาจบงานที่บันทึกไว้จริง — updatedAt ขยับทุกครั้งที่มีการแก้ไข จึงไม่ใช่เวลาซ่อมเสร็จ
  const completedDate = (t) => t.resolvedAt || t.closedAt || null;
  const repairDuration = (t) => {
    const done = completedDate(t);
    if (!t.createdAt || !done) return "—";
    const minutes = Math.max(0, Math.round((new Date(done) - new Date(t.createdAt)) / 60000));
    if (minutes < 60) return `${minutes} นาที`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) return mins ? `${hours} ชม. ${mins} นาที` : `${hours} ชม.`;
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? `${days} วัน ${restHours} ชม.` : `${days} วัน`;
  };
  const rows = data.items.map((t) => `
    <tr class="clickable" ${navAttr("ticket-detail", { id: t.id })}>
      <td class="col-id link">${esc(t.ticketNo)}</td>
      <td class="col-subject"><div style="font-weight:500">${esc(t.subject)}</div>
          <div style="font-size:11.5px;color:var(--gray-500)">${esc(t.category?.name || "")}</div></td>
      <td class="col-person">${esc(t.requester?.fullName || "")}<div style="font-size:11.5px;color:var(--gray-500)">${esc(t.requester?.department?.name || "")}</div></td>
      <td>${priorityTag(t.priority)}</td>
      <td>${statusBadge(t.status)}</td>
      <td class="col-person">${esc(t.assignee?.fullName || "—")}</td>
      <td class="col-date">${fmtDateTime(t.createdAt)}</td>
      <td class="col-date">${fmtDateTime(completedDate(t))}</td>
      <td class="col-date" style="font-weight:600">${esc(repairDuration(t))}</td>
      <td class="col-date">${slaTag(t)}</td>
    </tr>`).join("") || `<tr><td colspan="10"><div class="empty">ไม่พบรายการ</div></td></tr>`;

  return {
    title: "รายการแจ้งซ่อม IT",
    html: `
      <div class="filter-bar">
        <input class="search-input" id="f-q" placeholder="ค้นหา Ticket ID, หัวข้อ..." value="${esc(query.q)}">
        <select class="filter" id="f-status">
          <option value="">สถานะทั้งหมด</option>
          <option value="${STATUS_GROUP_OPEN}" ${query.status === STATUS_GROUP_OPEN ? "selected" : ""}>▸ รอดำเนินการ (ใหม่/มอบหมาย/กำลังทำ/รอ)</option>
          <option value="${STATUS_GROUP_DONE}" ${query.status === STATUS_GROUP_DONE ? "selected" : ""}>▸ แก้ไขแล้ว / ปิด</option>
          ${Object.entries(TICKET_STATUS).map(([k, v]) => `<option value="${k}" ${query.status === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <select class="filter" id="f-sla">
          <option value="">SLA ทั้งหมด</option>
          <option value="breached" ${query.sla === "breached" ? "selected" : ""}>เกิน SLA</option>
          <option value="response_breached" ${query.sla === "response_breached" ? "selected" : ""}>ตอบรับเกินกำหนด</option>
        </select>
        <select class="filter" id="f-priority">
          <option value="">ความสำคัญทั้งหมด</option>
          ${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${query.priority === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <select class="filter" id="f-month">
          <option value="">เดือนทั้งหมด</option>
          ${months.map(([value, label]) => `<option value="${value}" ${String(query.month) === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <select class="filter" id="f-year">
          <option value="">ปีทั้งหมด</option>
          ${years.map((year) => `<option value="${year}" ${String(query.year) === String(year) ? "selected" : ""}>${year + 543}</option>`).join("")}
        </select>
        ${State.user.role !== "USER" ? `<a class="btn btn-ghost btn-sm" href="/api/reports/tickets.csv${qs(exportQuery)}">📥 Export CSV</a>` : ""}
        <button class="btn btn-primary btn-sm" data-nav="ticket-new">+ แจ้งซ่อมใหม่</button>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Ticket ทั้งหมด <span style="font-weight:400;color:var(--gray-500)">(${data.total})</span></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Ticket ID</th><th>หัวข้อ</th><th>ผู้แจ้ง</th><th>ความสำคัญ</th><th>สถานะ</th><th>ผู้รับผิดชอบ</th><th>วันที่แจ้ง</th><th>วันที่ซ่อมเสร็จ</th><th>เวลาซ่อม</th><th>SLA</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${pagination(data, "tickets", query)}
      </div>`,
    after: () => {
      const apply = () => navigate("tickets", { q: val("f-q"), status: val("f-status"), priority: val("f-priority"), sla: val("f-sla"), month: val("f-month"), year: val("f-year") });
      document.getElementById("f-status").onchange = apply;
      document.getElementById("f-sla").onchange = apply;
      document.getElementById("f-priority").onchange = apply;
      document.getElementById("f-month").onchange = apply;
      document.getElementById("f-year").onchange = apply;
      document.getElementById("f-q").onkeydown = (e) => { if (e.key === "Enter") apply(); };
    },
  };
};

// ═══════════════ NEW TICKET ═══════════════
Pages["ticket-new"] = async (params = {}) => {
  await loadMeta();
  const isSR = params.type === "SERVICE_REQUEST";
  const initialAsset = params.assetId
    ? await api.get("/assets/pick" + qs({ id: Number(params.assetId) })).then((r) => r.items?.[0] || null).catch(() => null)
    : null;
  const isMyAsset = (asset) => Number(asset?.ownerId ?? asset?.owner?.id) === Number(State.user.id);
  const initialMode = initialAsset ? (isMyAsset(initialAsset) ? "mine" : "other") : "mine";
  const catalogItem = isSR && params.catalogId ? META.catalogItems.find((c) => c.id === params.catalogId) : null;
  return {
    title: isSR ? "ขอรับบริการ (Service Request)" : "แจ้งซ่อมใหม่",
    html: `
      <div class="card card-narrow">
        <div class="card-header"><div class="card-title">${isSR ? "🛒 แบบฟอร์มขอรับบริการ" : "📋 แบบฟอร์มแจ้งซ่อม IT"}</div></div>
        <div class="card-body"><form id="ticket-form"><div class="form-grid">
          <input type="hidden" id="t-type" value="${isSR ? "SERVICE_REQUEST" : "INCIDENT"}">
          <input type="hidden" id="t-catalog" value="${params.catalogId || ""}">
          <div class="form-group full">
            <label>ประเภทคำร้อง</label>
            <div style="display:flex;gap:8px">
              <button type="button" class="btn ${!isSR ? "btn-primary" : "btn-ghost"}" data-nav="ticket-new">🔧 แจ้งซ่อม (Incident)</button>
              <button type="button" class="btn ${isSR ? "btn-primary" : "btn-ghost"}" data-nav="catalog">🛒 ขอบริการ (Service Request)</button>
            </div>
            ${catalogItem?.requiresApproval ? '<span class="form-hint" style="color:var(--warning)">⚠️ คำขอนี้ต้องผ่านการอนุมัติจากหัวหน้าก่อน</span>' : ""}
          </div>
          <div class="form-group full">
            <label>${isSR ? "หัวข้อคำขอ" : "หัวข้อปัญหา"} <span class="req">*</span></label>
            <input id="t-subject" required placeholder="สรุปโดยย่อ" value="${esc(params.subject || "")}">
          </div>
          <div class="form-group">
            <label>หมวดหมู่ <span class="req">*</span></label>
            <select id="t-category" required>
              <option value="">-- เลือกหมวดหมู่ --</option>
              ${META.categories.map((c) => `<option value="${c.id}">${esc(c.icon || "")} ${esc(c.name)}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label>ความสำคัญ <span class="req">*</span></label>
            <select id="t-priority">
              <option value="CRITICAL">🔴 วิกฤต — ระบบหยุดทำงาน</option>
              <option value="HIGH">🟠 สูง — กระทบงานมาก</option>
              <option value="MEDIUM" selected>🟡 กลาง — มี workaround</option>
              <option value="LOW">🟢 ต่ำ — ไม่กระทบงาน</option>
            </select>
          </div>
          <div class="form-group full">
            <label>รายละเอียดปัญหา <span class="req">*</span></label>
            <textarea id="t-description" required style="min-height:100px" placeholder="อธิบายอาการที่พบ เกิดขึ้นเมื่อไหร่..."></textarea>
          </div>
          <fieldset class="form-group full ticket-asset-fieldset">
            <legend>เครื่องที่แจ้งซ่อม</legend>
            <div class="ticket-asset-modes">
              ${[["mine", "เครื่องของฉัน"], ["other", "เครื่องของคนอื่น"], ["none", "ไม่เกี่ยวกับเครื่อง"]].map(([value, label]) => `<label><input type="radio" name="ticket-asset-mode" value="${value}" ${value === initialMode ? "checked" : ""}><span>${label}</span></label>`).join("")}
            </div>
          </fieldset>
          <div class="form-group full${initialMode !== "mine" ? " hidden" : ""}" id="t-my-asset-wrap">
            <label for="t-asset">เลือกเครื่องของฉัน <span class="req">*</span></label>
            <select id="t-asset">
              <option value="">กำลังโหลดเครื่องของฉัน...</option>
            </select>
            <span class="form-hint" id="t-asset-hint"></span>
          </div>
          <div class="form-group full${initialMode !== "other" ? " hidden" : ""}" id="t-other-asset-wrap">
            <label for="t-other-asset">ค้นหาเครื่องของคนอื่น / เครื่องส่วนกลาง</label>
            <input id="t-other-asset" placeholder="ชื่อเครื่อง หรือ Asset ID" autocomplete="off">
            <label for="t-other-asset-select">เลือกเครื่องที่แจ้งซ่อม <span class="req">*</span></label>
            <select id="t-other-asset-select"><option value="">ยังไม่ได้เลือกเครื่อง</option></select>
            <span class="form-hint" id="t-other-asset-hint" aria-live="polite"></span>
          </div>
          <div class="form-group">
            <label>สถานที่ / ที่ตั้ง</label>
            <input id="t-location" placeholder="เช่น ชั้น 2 ห้อง HR-201">
          </div>
          <div class="form-group">
            <label>เบอร์โต๊ะ</label>
            <input id="t-desk-phone" placeholder="เช่น 1234 หรือ 02-xxx-xxxx">
          </div>
          <div class="form-group">
            <label>มือถือ</label>
            <input id="t-mobile-phone" placeholder="เช่น 08x-xxx-xxxx">
          </div>
          <div class="ticket-asset-summary full" aria-live="polite">
            <div><span>ผู้แจ้ง</span><strong>${esc(State.user.fullName || "")}</strong></div>
            <div><span>บันทึกประวัติให้</span><strong id="t-asset-summary">ยังไม่ได้เลือกเครื่อง</strong></div>
            <div><span>เจ้าของเครื่อง</span><strong id="t-asset-owner">-</strong></div>
          </div>
        </div></form></div>
        <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" data-nav="tickets">ยกเลิก</button>
          <button class="btn btn-primary" id="t-submit">📨 ส่งคำร้องแจ้งซ่อม</button>
        </div>
      </div>`,
    after: () => {
      const assetSelect = document.getElementById("t-asset");
      const assetHint = document.getElementById("t-asset-hint");
      const otherAssetInput = document.getElementById("t-other-asset");
      const otherAssetSelect = document.getElementById("t-other-asset-select");
      const otherAssetHint = document.getElementById("t-other-asset-hint");
      let mode = initialMode;
      let ownedAssets = [];
      let otherAssetChoices = [];
      let otherAssetTimer = null;
      let searchVersion = 0;
      const computerType = (a) => /desktop|notebook|laptop|computer|คอม/i.test(a?.type?.name || "");
      const displayAssetValue = (a) => a?.hostname || a?.assetTag || "";
      const assetLabel = (a) => [
        displayAssetValue(a),
        a.hostname && a.assetTag && a.hostname !== a.assetTag ? `Asset ${a.assetTag}` : "",
        a.type?.name,
        [a.brand, a.model].filter(Boolean).join(" "),
        a.owner?.fullName,
      ].filter(Boolean).join(" — ");
      const sortAssetsForTicket = (items) => [...(items || [])].sort((a, b) => {
        const byKind = Number(computerType(b)) - Number(computerType(a));
        if (byKind) return byKind;
        return displayAssetValue(a).localeCompare(displayAssetValue(b), "th");
      });
      const selectedAsset = () => mode === "mine"
        ? ownedAssets.find((asset) => String(asset.id) === assetSelect.value)
        : mode === "other" ? otherAssetChoices.find((asset) => String(asset.id) === otherAssetSelect.value) : null;
      const updateSummary = () => {
        const asset = selectedAsset();
        document.getElementById("t-asset-summary").textContent = mode === "none"
          ? "ไม่ผูกประวัติกับเครื่อง" : asset ? assetLabel(asset) : "ยังไม่ได้เลือกเครื่อง";
        document.getElementById("t-asset-owner").textContent = asset ? asset.owner?.fullName || "ยังไม่ระบุเจ้าของ" : "-";
      };
      const applyMode = () => {
        document.getElementById("t-my-asset-wrap").classList.toggle("hidden", mode !== "mine");
        document.getElementById("t-other-asset-wrap").classList.toggle("hidden", mode !== "other");
        assetSelect.disabled = mode !== "mine";
        otherAssetInput.disabled = mode !== "other";
        otherAssetSelect.disabled = mode !== "other";
        updateSummary();
      };
      const loadAllOwnedAssets = async () => {
        const r = await api.get("/assets/pick" + qs({ ownerId: "me", pageSize: 100 }));
        return r.items || [];
      };
      const setAssetOptions = (items) => {
        const seen = new Set();
        const choices = sortAssetsForTicket(items).filter((a) => {
          if (!a?.id || seen.has(a.id)) return false;
          seen.add(a.id);
          return true;
        });
        ownedAssets = choices;
        assetSelect.innerHTML = '<option value="">-- เลือกเครื่อง --</option>' + choices.map((a) => `<option value="${a.id}">${esc(assetLabel(a))}</option>`).join("");
        if (initialAsset && isMyAsset(initialAsset)) assetSelect.value = String(initialAsset.id);
        assetHint.textContent = choices.length
          ? `พบเครื่องของฉัน ${choices.length} รายการ`
          : "ไม่พบเครื่องที่มีคุณเป็นเจ้าของ";
        updateSummary();
      };
      const loadOwnedAssets = async () => {
        try {
          const items = await loadAllOwnedAssets();
          if (!assetSelect.isConnected) return;
          setAssetOptions(items);
        } catch {
          if (!assetSelect.isConnected) return;
          assetSelect.innerHTML = '<option value="">โหลด Asset ไม่สำเร็จ</option>';
          assetHint.textContent = "โหลด Asset ที่เกี่ยวข้องไม่สำเร็จ";
        }
      };
      const setOtherOptions = (items) => {
        otherAssetChoices = sortAssetsForTicket(items).filter((asset) => !isMyAsset(asset));
        otherAssetSelect.innerHTML = '<option value="">-- เลือกเครื่อง --</option>' + otherAssetChoices.map((asset) => `<option value="${asset.id}">${esc(assetLabel(asset))}</option>`).join("");
        updateSummary();
      };
      const searchOtherAssets = async (version) => {
        const q = otherAssetInput.value.trim();
        if (q.length < 2) {
          otherAssetHint.textContent = "ระบุชื่อเครื่องหรือ Asset ID อย่างน้อย 2 ตัวอักษร";
          return;
        }
        try {
          const r = await api.get("/assets/pick" + qs({ q, pageSize: 20 }));
          if (version !== searchVersion || !otherAssetInput.isConnected) return;
          setOtherOptions(r.items || []);
          otherAssetHint.textContent = otherAssetChoices.length
            ? `พบ ${otherAssetChoices.length} รายการ${r.total > 20 ? " (แสดงผลบางส่วน ระบุชื่อให้เจาะจงขึ้น)" : ""}`
            : "ไม่พบเครื่องของคนอื่นหรือเครื่องส่วนกลางตามคำค้น";
        } catch {
          if (version !== searchVersion || !otherAssetInput.isConnected) return;
          setOtherOptions([]);
          otherAssetHint.textContent = "ค้นหาเครื่องไม่สำเร็จ กรุณาลองอีกครั้ง";
        }
      };
      if (initialAsset && !isMyAsset(initialAsset)) {
        setOtherOptions([initialAsset]);
        otherAssetInput.value = initialAsset.assetTag;
        otherAssetSelect.value = String(initialAsset.id);
      }
      applyMode();
      loadOwnedAssets();
      document.querySelectorAll('input[name="ticket-asset-mode"]').forEach((radio) => {
        radio.onchange = () => { mode = radio.value; applyMode(); };
      });
      assetSelect.onchange = updateSummary;
      otherAssetSelect.onchange = updateSummary;
      otherAssetInput.addEventListener("input", () => {
        clearTimeout(otherAssetTimer);
        const version = ++searchVersion;
        setOtherOptions([]);
        otherAssetHint.textContent = "กำลังค้นหา...";
        otherAssetTimer = setTimeout(() => searchOtherAssets(version), 250);
      });
      document.getElementById("ticket-form").onsubmit = (event) => {
        event.preventDefault();
        document.getElementById("t-submit").click();
      };

      document.getElementById("t-submit").onclick = async () => {
        const body = {
          type: val("t-type") || "INCIDENT",
          subject: val("t-subject"), description: val("t-description"),
          priority: val("t-priority"), categoryId: val("t-category") || undefined,
          catalogId: val("t-catalog") || undefined,
          location: val("t-location") || undefined,
          deskPhone: val("t-desk-phone") || undefined,
          mobilePhone: val("t-mobile-phone") || undefined,
        };
        if (!body.subject || !body.description) return toast("กรุณากรอกหัวข้อและรายละเอียด", "error");
        // ปุ่ม submit อยู่นอก <form> ทำให้ required ของเบราว์เซอร์ไม่ทำงาน จึงต้องตรวจเอง
        if (!body.categoryId) return toast("กรุณาเลือกหมวดปัญหา", "error");
        if (mode !== "none") {
          const asset = selectedAsset();
          if (!asset) return toast("กรุณาเลือกเครื่องที่แจ้งซ่อมก่อนส่งคำร้อง", "error");
          body.assetId = asset.id;
        }
        try {
          await submitBtn("t-submit", () => api.post("/tickets", body));
          toast("ส่งคำร้องสำเร็จ", "success");
          if (typeof refreshBadges === "function") refreshBadges();
          navigate("tickets");
        } catch (e) { toast(e.message, "error"); }
      };
    },
  };
};

// ═══════════════ TICKET DETAIL ═══════════════
Pages["ticket-detail"] = async ({ id }) => {
  const [t, agents] = await Promise.all([
    api.get("/tickets/" + id),
    State.user.role !== "USER" ? api.get("/users" + qs({ role: "AGENT" })).catch(() => []) : Promise.resolve([]),
  ]);
  const isStaff = State.user.role !== "USER";

  const wf = STATUS_FLOW.map((s, i) => {
    const cur = STATUS_FLOW.indexOf(t.status);
    const cls = t.status === s ? "current" : i < cur ? "done" : "";
    return `<div class="wf-step ${cls}">${TICKET_STATUS[s]}</div>`;
  }).join('<span class="wf-arrow">→</span>');

  const comments = t.comments.filter((c) => isStaff || !c.isInternal).map((c) => `
    <div class="comment">
      <div class="comment-avatar">${esc(initials(c.author.fullName))}</div>
      <div class="comment-content ${c.isInternal ? "internal" : ""}">
        <div><span class="comment-author">${esc(c.author.fullName)}</span>
          ${c.isInternal ? '<span style="font-size:10px;color:var(--warning)">🔒 ภายใน</span>' : ""}
          <span class="comment-time">${fmtDateTime(c.createdAt)}</span></div>
        <div class="comment-text">${esc(c.body)}</div>
      </div>
    </div>`).join("") || `<div class="empty">ยังไม่มีบันทึก</div>`;

  return {
    title: `${t.ticketNo} — ${t.subject}`,
    html: `
      <div class="card"><div class="card-body" style="padding:14px 20px">
        <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:8px">ขั้นตอนการดำเนินการ</div>
        <div class="workflow">${wf}</div>
      </div></div>
      <div class="card">
        <div style="padding:20px;border-bottom:1px solid var(--gray-200);display:flex;gap:16px;align-items:flex-start">
          <div style="flex:1">
            <div style="font-size:12px;color:var(--gray-500);font-weight:600">${esc(t.ticketNo)} · แจ้งซ่อม IT</div>
            <div style="font-size:17px;font-weight:700;margin:4px 0">${esc(t.subject)}</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--gray-500)">
              ${statusBadge(t.status)} ${priorityTag(t.priority)}
              <span>${esc(t.category?.name || "")}</span>
              <span>แจ้งเมื่อ <b>${fmtDateTime(t.createdAt)}</b></span>
            </div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 280px">
          <div style="padding:20px;border-right:1px solid var(--gray-200)">
            <div style="margin-bottom:16px">
              <label style="font-size:11.5px;text-transform:uppercase;color:var(--gray-500)">รายละเอียดปัญหา</label>
              <p style="font-size:13.5px;line-height:1.6;margin-top:4px">${esc(t.description)}</p>
            </div>
            <label style="font-size:11.5px;text-transform:uppercase;color:var(--gray-500)">บันทึกการดำเนินการ</label>
            <div style="margin-top:10px">${comments}</div>
            <div style="margin-top:16px">
              <textarea id="c-body" placeholder="พิมพ์บันทึก / ข้อความ..."></textarea>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                ${isStaff ? `<label style="display:flex;gap:6px;font-size:12px;font-weight:400"><input type="checkbox" id="c-internal" style="width:auto"> บันทึกภายใน (ผู้แจ้งไม่เห็น)</label>` : "<span></span>"}
                <button class="btn btn-primary btn-sm" id="c-submit">💾 บันทึก</button>
              </div>
            </div>
          </div>
          <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
            <div>
              <div style="font-size:11.5px;text-transform:uppercase;color:var(--gray-500);margin-bottom:10px">ข้อมูล Ticket</div>
              <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
                ${kv("ผู้แจ้ง", t.requester?.fullName)}
                ${kv("แผนก", t.requester?.department?.name)}
                ${kv("อีเมล", t.requester?.email)}
                ${kv("เบอร์โต๊ะ", t.deskPhone)}
                ${kv("มือถือ", t.mobilePhone)}
                ${kv("ผู้รับผิดชอบ", t.assignee?.fullName || "—")}
                ${kv("SLA ตอบรับ", fmtDateTime(t.responseDueAt))}
                ${kv("ตอบรับเมื่อ", t.firstRespAt ? fmtDateTime(t.firstRespAt) + (t.responseBreached ? " (เกินกำหนด)" : "") : (t.responseBreached ? "ยังไม่ตอบรับ (เกินกำหนด)" : "—"))}
                ${kv("SLA แก้ไข", fmtDateTime(t.resolveDueAt))}
              </div>
            </div>
            ${t.asset ? `<div style="background:var(--gray-50);border-radius:8px;padding:12px">
              <div style="font-size:11.5px;text-transform:uppercase;color:var(--gray-500);margin-bottom:8px">Asset ที่เกี่ยวข้อง</div>
              <div class="link clickable" ${navAttr("asset-detail", { id: t.asset.id })}>${esc(t.asset.assetTag)} — ${esc(t.asset.brand)} ${esc(t.asset.model)}</div>
            </div>` : ""}
            <div>
              <div style="font-size:11.5px;text-transform:uppercase;color:var(--gray-500);margin-bottom:10px">ไฟล์แนบ (${(t.attachments || []).length})</div>
              <div style="display:flex;flex-direction:column;gap:6px;font-size:12.5px">
                ${(t.attachments || []).map((a) => `<a href="/uploads/${encodeURIComponent(a.filePath)}" target="_blank" class="link">📎 ${esc(a.fileName)} <span style="color:var(--gray-400)">(${fmtFileSize(a.fileSize)})</span></a>`).join("") || '<span style="color:var(--gray-400)">ยังไม่มีไฟล์แนบ</span>'}
              </div>
              <label class="btn btn-ghost btn-sm" style="margin-top:10px;cursor:pointer;display:inline-flex">📎 แนบไฟล์<input type="file" id="att-file" style="display:none"></label>
            </div>
            ${approvalActions(t)}
            ${isStaff ? staffActions(t, agents) : userActions(t)}
          </div>
        </div>
      </div>`,
    after: () => {
      document.getElementById("c-submit").onclick = async () => {
        const body = val("c-body");
        if (!body) return toast("กรุณากรอกข้อความ", "error");
        const isInternal = document.getElementById("c-internal")?.checked || false;
        try {
          await api.post(`/tickets/${id}/comments`, { body, isInternal });
          navigate("ticket-detail", { id });
        } catch (e) { toast(e.message, "error"); }
      };
      // ปุ่มอนุมัติ / ปฏิเสธ
      const decide = async (btn, decision) => {
        const comment = val("ap-comment") || undefined;
        btn.disabled = true;
        try {
          await api.post(`/approvals/${btn.dataset.ap}/decision`, { decision, comment });
          toast(decision === "APPROVED" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว", "success");
          navigate("ticket-detail", { id });
        } catch (e) { btn.disabled = false; toast(e.message, "error"); }
      };
      const apOk = document.getElementById("ap-approve");
      if (apOk) apOk.onclick = () => decide(apOk, "APPROVED");
      const apNo = document.getElementById("ap-reject");
      if (apNo) apNo.onclick = () => decide(apNo, "REJECTED");

      if (isStaff) {
        document.getElementById("st-status").onchange = (e) => updateTicket(id, { status: e.target.value });
        document.getElementById("st-assignee").onchange = (e) => updateTicket(id, { assigneeId: e.target.value ? Number(e.target.value) : null });
        document.getElementById("st-priority").onchange = (e) => updateTicket(id, { priority: e.target.value });
        const delBtn = document.getElementById("tk-delete");
        if (delBtn) delBtn.onclick = async () => {
          if (!confirm(`ลบเคส ${delBtn.dataset.no} ถาวร?\nคอมเมนต์ ไฟล์แนบ และประวัติการอนุมัติจะถูกลบทั้งหมด และกู้คืนไม่ได้`)) return;
          try {
            await api.del("/tickets/" + id);
            toast(`ลบเคส ${delBtn.dataset.no} แล้ว`, "success");
            navigate("tickets");
          } catch (e) { toast(e.message, "error"); }
        };
      }
      // แนบไฟล์
      const af = document.getElementById("att-file");
      if (af) af.onchange = async () => {
        const f = af.files[0]; if (!f) return;
        const fd = new FormData(); fd.append("file", f);
        try {
          // ใช้ api.upload เพื่อให้ 401 เด้งกลับหน้า login เหมือน request อื่น ๆ
          await api.upload(`/tickets/${id}/attachments`, fd);
          toast("แนบไฟล์แล้ว", "success"); navigate("ticket-detail", { id });
        } catch (e) { toast(e.message, "error"); }
      };
      // ให้คะแนนความพึงพอใจ (CSAT)
      const rt = document.getElementById("rating");
      if (rt) {
        const stars = [...rt.querySelectorAll("span")];
        const paint = (n) => stars.forEach((s) => (s.textContent = Number(s.dataset.n) <= n ? "★" : "☆"));
        stars.forEach((s) => {
          s.onmouseenter = () => paint(Number(s.dataset.n));
          s.onclick = async () => {
            try { await api.post(`/tickets/${id}/satisfaction`, { rating: Number(s.dataset.n) }); toast("ขอบคุณสำหรับคะแนน!", "success"); navigate("ticket-detail", { id }); }
            catch (e) { toast(e.message, "error"); }
          };
        });
        rt.onmouseleave = () => paint(0);
      }
    },
  };
};

// กล่องอนุมัติในหน้ารายละเอียด — เมนู "งานรออนุมัติ" ถูกนำออกไปแล้ว
// ถ้าไม่มีตรงนี้ ticket ที่สถานะ AWAITING_APPROVAL จะค้างโดยไม่มีทางดำเนินการต่อ
function pendingApprovalFor(t) {
  const canDecide = ["ADMIN", "MANAGER"].includes(State.user.role);
  return (t.approvals || []).find((a) => a.status === "PENDING" && (a.approverId === State.user.id || canDecide)) || null;
}

function approvalActions(t) {
  const history = (t.approvals || []).filter((a) => a.status !== "PENDING");
  const pending = pendingApprovalFor(t);
  if (!pending && !history.length) return "";

  const historyHtml = history.map((a) => `
    <div style="font-size:12px;color:var(--gray-500)">
      ${a.status === "APPROVED" ? "✅ อนุมัติ" : "❌ ปฏิเสธ"} โดย ${esc(a.approver?.fullName || "—")}
      ${a.decidedAt ? `<span> · ${fmtDateTime(a.decidedAt)}</span>` : ""}
      ${a.comment ? `<div style="margin-top:2px">${esc(a.comment)}</div>` : ""}
    </div>`).join("");

  return `<div style="background:var(--gray-50);border-radius:8px;padding:12px">
    <div style="font-size:11.5px;text-transform:uppercase;color:var(--gray-500);margin-bottom:8px">การอนุมัติ</div>
    ${historyHtml}
    ${pending ? `
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:8px">รออนุมัติโดย ${esc(pending.approver?.fullName || "—")}</div>
      <textarea id="ap-comment" placeholder="ความเห็น (ไม่บังคับ)" style="margin-bottom:8px"></textarea>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="ap-approve" data-ap="${pending.id}">✅ อนุมัติ</button>
        <button class="btn btn-ghost btn-sm" id="ap-reject" data-ap="${pending.id}">❌ ปฏิเสธ</button>
      </div>` : ""}
  </div>`;
}

function staffActions(t, agents) {
  return `<div>
    <div style="font-size:11.5px;text-transform:uppercase;color:var(--gray-500);margin-bottom:10px">จัดการ (เจ้าหน้าที่)</div>
    <div class="form-group" style="margin-bottom:10px"><label>สถานะ</label>
      <select id="st-status">${Object.entries(TICKET_STATUS).map(([k, v]) => `<option value="${k}" ${t.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    <div class="form-group" style="margin-bottom:10px"><label>ผู้รับผิดชอบ</label>
      <select id="st-assignee"><option value="">— ยังไม่มอบหมาย —</option>
        ${agents.map((a) => `<option value="${a.id}" ${t.assigneeId === a.id ? "selected" : ""}>${esc(a.fullName)}</option>`).join("")}</select></div>
    <div class="form-group"><label>ความสำคัญ</label>
      <select id="st-priority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${t.priority === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    ${State.user.role === "ADMIN" ? `<button class="btn btn-ghost btn-sm" id="tk-delete" data-no="${esc(t.ticketNo)}" style="margin-top:14px;color:var(--danger);border-color:var(--danger)">🗑️ ลบเคสนี้</button>` : ""}
  </div>`;
}
function userActions(t) {
  if (!["RESOLVED", "CLOSED"].includes(t.status) || t.satisfaction) return "";
  return `<div><div style="font-size:11.5px;text-transform:uppercase;color:var(--gray-500);margin-bottom:8px">ให้คะแนนความพึงพอใจ</div>
    <div id="rating" style="font-size:24px;cursor:pointer">${[1,2,3,4,5].map((n)=>`<span data-n="${n}">☆</span>`).join("")}</div></div>`;
}
async function updateTicket(id, patch) {
  try { await api.patch("/tickets/" + id, patch); toast("อัปเดตแล้ว", "success"); navigate("ticket-detail", { id }); }
  catch (e) { toast(e.message, "error"); }
}

// ═══════════════ ASSET DASHBOARD ═══════════════
Pages["assets-dash"] = async () => {
  const d = await api.get("/dashboard/assets");
  const sorted = [...d.byType].sort((a,b)=>b.count-a.count);
  const typeRows = sorted.map((t, i) => {
    const pct = d.kpi.total ? Math.round((t.count / d.kpi.total) * 100) : 0;
    return barRow(t.type, t.count, pct);
  }).join("") || '<div class="empty">ยังไม่มีข้อมูล</div>';

  const segs = d.byStatus.map((s) => ({ label: ASSET_STATUS[s.status] || s.status, count: s.count, color: STATUS_COLOR[s.status] || "#94a3b8" }));
  const utilization = d.kpi.total ? Math.round((d.kpi.inUse / d.kpi.total) * 100) : 0;
  const donut = segs.length ? donutChart(segs, d.kpi.total, "ทรัพย์สิน") : '<div class="empty">ยังไม่มีข้อมูล</div>';

  const warranty = await api.get("/assets" + qs({ warrantyExpiring: 30, pageSize: 5 }));
  return {
    title: "ภาพรวมทรัพย์สิน IT",
    html: `
      <div class="dash-hero" style="background:linear-gradient(120deg,#0f172a 0%,#0e7490 55%,#06b6d4 100%);box-shadow:0 14px 34px rgba(14,116,144,.28)">
        <span class="hero-deco">💻</span>
        <h2>ภาพรวมทรัพย์สิน IT 📦</h2>
        <p>ทะเบียนทรัพย์สินและสถานะการใช้งาน · อัปเดตล่าสุด ${fmtDateTime(new Date())}</p>
        <div class="hero-pills">
          <span class="hero-pill"><b>${utilization}%</b> อัตราการใช้งาน</span>
          <span class="hero-pill"><b>${d.kpi.repair}</b> อยู่ระหว่างซ่อม</span>
          <span class="hero-pill"><b>${d.kpi.warrantyExpiring}</b> ประกันใกล้หมด</span>
        </div>
      </div>
      <div class="stat-grid">
        ${statCard("blue", "📦", d.kpi.total, "ทรัพย์สินทั้งหมด")}
        ${statCard("green", "✅", d.kpi.inUse, "ใช้งานอยู่", utilization + "%")}
        ${statCard("amber", "⏰", d.kpi.warrantyExpiring, "ประกันใกล้หมด (30 วัน)")}
        ${statCard("red", "🔧", d.kpi.repair, "อยู่ระหว่างซ่อม")}
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">📊 ทรัพย์สินตามประเภท</div></div><div class="card-body">${typeRows}</div></div>
        <div class="card"><div class="card-header"><div class="card-title">🍩 สัดส่วนตามสถานะ</div></div><div class="card-body">${donut}</div></div>
      </div>
      <div>
        <div class="card"><div class="card-header"><div class="card-title">⚠️ ประกันใกล้หมดอายุ</div></div>
          <div class="table-wrap"><table><thead><tr><th>Asset</th><th>อุปกรณ์</th><th>หมดประกัน</th></tr></thead>
          <tbody>${warranty.items.map((a) => `<tr class="clickable" ${navAttr("asset-detail", { id: a.id })}><td class="link">${esc(a.assetTag)}</td><td>${esc(a.brand)} ${esc(a.model)}</td><td style="color:var(--danger);font-weight:600">${fmtDate(a.warrantyExpiry)}</td></tr>`).join("") || '<tr><td colspan="3"><div class="empty">ไม่มี</div></td></tr>'}</tbody></table></div>
        </div>
      </div>`,
  };
};

// ═══════════════ ASSET LIST ═══════════════
Pages.assets = async (params = {}) => {
  await loadMeta();
  const query = { typeId: params.typeId || "", status: params.status || "", q: params.q || "", page: params.page || 1 };
  const data = await api.get("/assets" + qs(query));
  const rows = data.items.map((a) => `
    <tr class="clickable" ${navAttr("asset-detail", { id: a.id })}>
      <td class="link">${esc(a.assetTag)}</td>
      <td>${esc(a.type?.icon || "")} ${esc(a.type?.name || "")}</td>
      <td>${esc(a.brand)} ${esc(a.model)}</td>
      <td style="font-family:var(--font-mono);font-size:12px">${esc(a.serialNo || "—")}</td>
      <td>${esc(a.owner?.fullName || "—")}</td>
      <td>${esc(a.department?.name || "—")}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="font-size:12px">${fmtDate(a.warrantyExpiry)}</td>
    </tr>`).join("") || `<tr><td colspan="8"><div class="empty">ไม่พบรายการ</div></td></tr>`;
  return {
    title: "ทะเบียนทรัพย์สิน IT",
    html: `
      <div class="filter-bar">
        <input class="search-input" id="f-q" placeholder="ค้นหา Asset ID, ยี่ห้อ, Serial No..." value="${esc(query.q)}">
        <select class="filter" id="f-type"><option value="">ประเภททั้งหมด</option>
          ${META.assetTypes.map((t) => `<option value="${t.id}" ${query.typeId == t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
        <select class="filter" id="f-status"><option value="">สถานะทั้งหมด</option>
          ${Object.entries(ASSET_STATUS).map(([k, v]) => `<option value="${k}" ${query.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button class="btn btn-ghost btn-sm" id="asset-import-btn">📤 Import CSV/Excel</button>
        <a class="btn btn-ghost btn-sm" href="/api/reports/assets.csv">📥 Export CSV</a>
        <button class="btn btn-primary btn-sm" data-nav="asset-new">+ เพิ่มทรัพย์สิน</button>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">ทะเบียนทรัพย์สิน <span style="font-weight:400;color:var(--gray-500)">(${data.total})</span></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Asset ID</th><th>ประเภท</th><th>ยี่ห้อ/รุ่น</th><th>Serial No.</th><th>ผู้ครอบครอง</th><th>แผนก</th><th>สถานะ</th><th>ประกันหมด</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${pagination(data, "assets", query)}
      </div>`,
    after: () => {
      const apply = () => navigate("assets", { q: val("f-q"), typeId: val("f-type"), status: val("f-status") });
      document.getElementById("f-type").onchange = apply;
      document.getElementById("f-status").onchange = apply;
      document.getElementById("f-q").onkeydown = (e) => { if (e.key === "Enter") apply(); };
      document.getElementById("asset-import-btn").onclick = assetImportModal;
    },
  };
};

// ═══════════════ ASSET NEW/EDIT ═══════════════
function downloadAssetImportTemplate() {
  const headers = [
    "Asset ID", "รหัสทรัพย์สินบัญชี", "ประเภท", "ยี่ห้อ", "รุ่น", "Serial Number", "Hostname", "OS", "Office ที่ใช้", "Specification",
    "IP Address", "MAC Address", "สถานที่", "สถานะ", "วันที่ซื้อ", "ราคา",
    "วันหมดประกัน", "อายุการใช้งานเดือน", "มูลค่าซาก", "ผู้จำหน่าย", "ผู้ครอบครอง", "แผนก", "หมายเหตุ",
  ];
  const sample = [
    "PC-HR-003", META.assetTypes?.[0]?.name || "Desktop", "Dell", "OptiPlex 7090", "SN123456",
    "HR-PC-003", "Windows 11 Pro 64-bit", "Microsoft 365 Business", "i5, 16GB, SSD 512GB", "192.168.1.50", "00:11:22:33:44:55",
    "ชั้น 2 ห้อง HR-201", "IN_USE", "01/08/2026", "25000", "01/08/2029", "60", "0",
    META.vendors?.[0]?.name || "", "", META.departments?.[0]?.name || "", "",
  ];
  const csv = [headers, sample].map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "asset-import-template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function assetImportModal() {
  const overlay = modal(`
    <div class="card-header"><div class="card-title">📤 Import ทรัพย์สินจาก CSV/Excel</div></div>
    <div class="card-body">
      <div class="form-grid">
        <div class="form-group full">
          <label>ไฟล์ CSV, XLSX, XLS <span class="req">*</span></label>
          <input type="file" id="asset-import-file" accept=".csv,.xlsx,.xls">
          <span class="form-hint">คอลัมน์ที่ต้องมี: Asset ID, ประเภท, ยี่ห้อ, รุ่น</span>
        </div>
        <div class="form-group full">
          <label style="display:flex;align-items:center;gap:8px;font-weight:500">
            <input type="checkbox" id="asset-import-update" style="width:auto">
            อัปเดตรายการเดิมเมื่อ Asset ID ซ้ำ
          </label>
        </div>
      </div>
      <div class="import-help">
        <button class="btn btn-ghost btn-sm" id="asset-template-btn">⬇️ ดาวน์โหลด Template</button>
        <div>ระบบจับคู่ ประเภท/ผู้ครอบครอง/แผนก/ผู้จำหน่าย จากชื่อที่มีอยู่ในระบบ</div>
      </div>
      <div id="asset-import-result"></div>
    </div>
    <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" id="asset-import-cancel">ยกเลิก</button>
      <button class="btn btn-primary" id="asset-import-submit">นำเข้า</button>
    </div>`);

  document.getElementById("asset-import-cancel").onclick = () => overlay.remove();
  document.getElementById("asset-template-btn").onclick = downloadAssetImportTemplate;
  document.getElementById("asset-import-submit").onclick = async () => {
    const file = document.getElementById("asset-import-file").files[0];
    if (!file) return toast("กรุณาเลือกไฟล์ก่อนนำเข้า", "error");

    const btn = document.getElementById("asset-import-submit");
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "กำลังนำเข้า...";
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("updateExisting", document.getElementById("asset-import-update").checked ? "true" : "false");
      const result = await api.upload("/assets/import", form);
      const details = (result.errors || []).slice(0, 20).map((e) => `
        <tr><td>${esc(e.row)}</td><td>${esc(e.assetTag || "—")}</td><td>${esc(e.message)}</td></tr>`).join("");
      const changed = Number(result.created || 0) + Number(result.updated || 0);
      document.getElementById("asset-import-result").innerHTML = `
        <div class="import-summary">
          <span class="chip green">เพิ่ม ${result.created}</span>
          <span class="chip blue">อัปเดต ${result.updated}</span>
          <span class="chip amber">ข้าม ${result.skipped}</span>
          <span class="chip">ผิดพลาด ${result.failed}</span>
        </div>
        ${details ? `<div class="table-wrap" style="margin-top:12px"><table>
          <thead><tr><th>แถว</th><th>Asset ID</th><th>รายละเอียด</th></tr></thead><tbody>${details}</tbody>
        </table></div>` : ""}
        <div style="margin-top:12px;display:flex;justify-content:flex-end">
          <button class="btn btn-primary btn-sm" id="asset-import-refresh" ${changed ? "" : "disabled"}>รีเฟรชรายการ</button>
        </div>`;
      const refreshBtn = document.getElementById("asset-import-refresh");
      if (refreshBtn) refreshBtn.onclick = () => { overlay.remove(); navigate("assets"); };
      toast(changed ? "นำเข้าเสร็จแล้ว กดรีเฟรชรายการเพื่อดูข้อมูล" : "นำเข้าไม่สำเร็จ ดูรายละเอียดในตาราง", changed ? "success" : "error");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  };
}

Pages["asset-new"] = async ({ id } = {}) => {
  await loadMeta();
  const [users, asset] = await Promise.all([
    api.get("/users").catch(() => []),
    id ? api.get("/assets/" + id) : Promise.resolve(null),
  ]);
  const v = (k) => (asset ? asset[k] ?? "" : "");
  const dateV = (k) => (asset && asset[k] ? toDateInputValue(asset[k]) : "");
  const ownerName = asset?.owner?.fullName || "";
  const canDelete = id && State.user.role === "ADMIN";
  return {
    title: id ? "แก้ไขทรัพย์สิน" : "เพิ่มทรัพย์สิน",
    html: `
      <div class="card" style="max-width:820px">
        <div class="card-header"><div class="card-title">➕ ${id ? "แก้ไข" : "เพิ่ม"}ทรัพย์สิน IT</div></div>
        <div class="card-body"><div class="form-grid">
          ${field("a-tag", "Asset ID", v("assetTag"), true, "เช่น PC-HR-003")}
          <div class="form-group"><label>ประเภท <span class="req">*</span></label>
            <select id="a-type">${META.assetTypes.map((t) => `<option value="${t.id}" ${v("typeId") == t.id ? "selected" : ""}>${esc(t.icon || "")} ${esc(t.name)}</option>`).join("")}</select></div>
          ${field("a-brand", "ยี่ห้อ", v("brand"), true, "Dell, HP, Apple")}
          ${field("a-model", "รุ่น", v("model"), true, "OptiPlex 7090")}
          ${field("a-serial", "Serial Number", v("serialNo"))}
          ${field("a-hostname", "Hostname", v("hostname"))}
          ${field("a-os", "OS", v("os"), false, "เช่น Windows 11 Pro 64-bit")}
          ${field("a-office", "Office ที่ใช้", v("officeSuite"), false, "เช่น Microsoft 365 Business, Office 2019")}
          ${field("a-accounting-code", "รหัสทรัพย์สินบัญชี", v("accountingAssetCode"), false, "เช่น FA-IT-000123")}
          <div class="form-group full">${labelHtml("Specification")}<input id="a-spec" value="${esc(v("specification"))}" placeholder="i5-11500, 16GB, SSD 512GB, Win11 Pro"></div>
          ${field("a-ip", "IP Address", v("ipAddress"))}
          ${field("a-mac", "MAC Address", v("macAddress"))}
          ${field("a-location", "สถานที่ตั้ง (รายละเอียด)", v("locationText"), false, "ชั้น 2 ห้อง HR-201")}
          <div class="form-group"><label>สถานะ <span class="req">*</span></label>
            <select id="a-status">${Object.entries(ASSET_STATUS).map(([k, l]) => `<option value="${k}" ${v("status") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="form-group"><label>วันที่ซื้อ</label><input type="date" id="a-purchase" value="${dateV("purchaseDate")}"></div>
          ${field("a-price", "ราคา (บาท)", v("purchasePrice"))}
          <div class="form-group"><label>วันหมดประกัน</label><input type="date" id="a-warranty" value="${dateV("warrantyExpiry")}"></div>
          ${field("a-life", "อายุการใช้งาน (เดือน)", v("usefulLifeMonths"), false, "เช่น 60 = 5 ปี (ใช้คำนวณค่าเสื่อม)")}
          ${field("a-salvage", "มูลค่าซาก (บาท)", v("salvageValue"), false, "มูลค่าคงเหลือเมื่อหมดอายุ (ดีฟอลต์ 0)")}
          <div class="form-group"><label>ผู้จำหน่าย (Vendor)</label>
            <select id="a-vendor"><option value="">— ไม่ระบุ —</option>${META.vendors.map((vd) => `<option value="${vd.id}" ${v("vendorId") == vd.id ? "selected" : ""}>${esc(vd.name)}</option>`).join("")}</select></div>
          <div class="form-group"><label>ผู้ครอบครอง</label>
            <input id="a-owner-name" list="a-owner-list" value="${esc(ownerName)}" placeholder="เลือกหรือพิมพ์ชื่อผู้ครอบครองใหม่">
            <datalist id="a-owner-list">${users.map((u) => `<option value="${esc(u.fullName)}">${esc(u.email || "")}</option>`).join("")}</datalist>
            <span class="form-hint">ถ้าพิมพ์ชื่อใหม่ ระบบจะสร้างผู้ใช้แบบไม่มีรหัสผ่านให้อัตโนมัติ</span></div>
          <div class="form-group"><label>แผนก</label>
            <select id="a-dept"><option value="">— ไม่ระบุ —</option>${META.departments.map((d) => `<option value="${d.id}" ${v("departmentId") == d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
          <div class="form-group full">${labelHtml("หมายเหตุ")}<textarea id="a-notes">${esc(v("notes"))}</textarea></div>
        </div></div>
        <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
          ${canDelete ? `<button class="btn btn-danger" id="a-delete">ลบทรัพย์สิน</button>` : ""}
          <button class="btn btn-ghost" data-nav="assets">ยกเลิก</button>
          <button class="btn btn-primary" id="a-submit">💾 บันทึก</button>
        </div>
      </div>`,
    after: () => {
      const del = document.getElementById("a-delete");
      if (del) del.onclick = () => deleteAsset(Number(id), v("assetTag"));
      document.getElementById("a-submit").onclick = async () => {
        const body = {
          assetTag: val("a-tag"), typeId: Number(val("a-type")), brand: val("a-brand"), model: val("a-model"),
          serialNo: val("a-serial") || undefined, hostname: val("a-hostname") || undefined,
          os: val("a-os") || undefined,
          officeSuite: val("a-office") || undefined,
          accountingAssetCode: val("a-accounting-code") || undefined,
          specification: val("a-spec") || undefined, ipAddress: val("a-ip") || undefined, macAddress: val("a-mac") || undefined,
          locationText: val("a-location") || undefined, status: val("a-status"),
          purchaseDate: val("a-purchase") || undefined, purchasePrice: val("a-price") || undefined,
          warrantyExpiry: val("a-warranty") || undefined,
          usefulLifeMonths: val("a-life") || undefined, salvageValue: val("a-salvage") || undefined,
          vendorId: val("a-vendor") ? Number(val("a-vendor")) : null,
          ownerId: (() => {
            const name = val("a-owner-name").toLowerCase();
            const found = users.find((u) => (u.fullName || "").trim().toLowerCase() === name);
            return name ? found?.id : null;
          })(),
          ownerName: (() => {
            const name = val("a-owner-name");
            const found = users.find((u) => (u.fullName || "").trim().toLowerCase() === name.toLowerCase());
            return name && !found ? name : undefined;
          })(),
          departmentId: val("a-dept") ? Number(val("a-dept")) : null,
          notes: val("a-notes") || undefined,
        };
        if (!body.assetTag || !body.brand || !body.model) return toast("กรุณากรอกข้อมูลที่จำเป็น", "error");
        try {
          const saved = id ? await api.patch("/assets/" + id, body) : await api.post("/assets", body);
          toast("บันทึกสำเร็จ", "success");
          navigate("asset-detail", { id: saved.id });
        } catch (e) { toast(e.message, "error"); }
      };
    },
  };
};

// ═══════════════ ASSET DETAIL ═══════════════
Pages["asset-detail"] = async ({ id }) => {
  const a = await api.get("/assets/" + id);
  const isStaff = State.user.role !== "USER";
  const history = a.tickets.map((t) => `<tr class="clickable" ${navAttr("ticket-detail", { id: t.id })}><td class="link">${esc(t.ticketNo)}</td><td>${esc(t.subject)}</td><td>${fmtDate(t.createdAt)}</td><td>${statusBadge(t.status)}</td></tr>`).join("") || '<tr><td colspan="4"><div class="empty">ยังไม่มีประวัติแจ้งซ่อม</div></td></tr>';
  return {
    title: `${assetLabel(a)} — ${a.brand} ${a.model}`,
    html: `
      <div class="card">
        <div style="padding:20px;border-bottom:1px solid var(--gray-200);display:flex;gap:16px;align-items:flex-start">
          <div style="width:60px;height:60px;background:var(--primary-light);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:28px">${esc(a.type?.icon || "📦")}</div>
          <div style="flex:1">
            <div style="font-size:12px;color:var(--gray-500);font-weight:600">${esc(a.assetTag)} · ${esc(a.type?.name || "")}</div>
            <div style="font-size:17px;font-weight:700;margin:4px 0">${esc(a.brand)} ${esc(a.model)}</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--gray-500)">
              ${statusBadge(a.status)}<span>ผู้ครอบครอง: <b>${esc(a.owner?.fullName || "—")}</b></span>
              <span>แผนก: <b>${esc(a.department?.name || "—")}</b></span><span>${esc(a.location || "")}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" id="asset-print-pdf">PDF A4</button>
            ${isStaff ? `<button class="btn btn-ghost btn-sm" ${navAttr("asset-new", { id: a.id })}>✏️ แก้ไข</button>` : ""}
            <button class="btn btn-primary btn-sm" ${navAttr("ticket-new", { assetId: a.id })}>🎫 แจ้งซ่อม</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr">
          <div style="padding:20px;border-right:1px solid var(--gray-100)">
            <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:14px">ข้อมูลอุปกรณ์</div>
            <dl class="dl">
              <dt>Asset ID</dt><dd class="link">${esc(a.assetTag)}</dd>
              <dt>Serial No.</dt><dd style="font-family:var(--font-mono)">${esc(a.serialNo || "—")}</dd>
              <dt>Hostname</dt><dd style="font-family:var(--font-mono)">${esc(a.hostname || "—")}</dd>
              <dt>IP Address</dt><dd style="font-family:var(--font-mono)">${esc(a.ipAddress || "—")}</dd>
              <dt>MAC</dt><dd style="font-family:var(--font-mono)">${esc(a.macAddress || "—")}</dd>
              <dt>OS</dt><dd>${esc(a.os || "—")}</dd>
              <dt>Office</dt><dd>${esc(a.officeSuite || "—")}</dd>
              <dt>รหัสบัญชี</dt><dd>${esc(a.accountingAssetCode || "—")}</dd>
              <dt>Spec</dt><dd>${esc(a.specification || "—")}</dd>
            </dl>
          </div>
          <div style="padding:20px">
            <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:14px">การจัดซื้อ & ประกัน</div>
            <dl class="dl">
              <dt>วันที่ซื้อ</dt><dd>${fmtDate(a.purchaseDate)}</dd>
              <dt>ราคา</dt><dd>${fmtMoney(a.purchasePrice)}</dd>
              <dt>ผู้จำหน่าย</dt><dd>${esc(a.vendor?.name || "—")}</dd>
              <dt>เลขที่ PO</dt><dd>${esc(a.poNumber || "—")}</dd>
              <dt>ประกันหมด</dt><dd>${fmtDate(a.warrantyExpiry)}</dd>
              <dt>สถานที่</dt><dd>${esc(a.locationText || a.location?.name || "—")}</dd>
            </dl>
          </div>
        </div>
        <div style="padding:0 20px 20px">
          <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin:16px 0 12px">ประวัติการแจ้งซ่อม</div>
          <table><thead><tr><th>Ticket ID</th><th>ปัญหา</th><th>วันที่</th><th>สถานะ</th></tr></thead><tbody>${history}</tbody></table>
        </div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">🔗 ความสัมพันธ์ (CMDB)</div>
          ${isStaff ? `<button class="btn btn-ghost btn-sm" id="rel-add">+ เพิ่มความสัมพันธ์</button>` : ""}</div>
          <div class="card-body" id="rel-list">${relationsHtml(a, isStaff)}</div></div>
        <div class="card"><div class="card-header"><div class="card-title">🏷️ บาร์โค้ด / ตรวจนับ</div></div>
          <div class="card-body" style="text-align:center">
            <div id="asset-barcode" style="margin:6px 0 12px"></div>
            <div style="font-size:12px;color:var(--gray-500);margin-bottom:12px">ตรวจนับล่าสุด: <b>${a.lastSeenAt ? fmtDateTime(a.lastSeenAt) : "— ยังไม่เคย —"}</b></div>
            <div style="display:flex;gap:8px;justify-content:center">
              <button class="btn btn-ghost btn-sm" id="asset-print-barcode">🖨️ พิมพ์</button>
              ${isStaff ? `<button class="btn btn-primary btn-sm" id="mark-seen">✅ ตรวจนับเจอแล้ว</button>` : ""}
            </div>
          </div></div>
      </div>`,
    after: () => {
      const bc = document.getElementById("asset-barcode");
      if (bc && window.barcodeSVG) bc.innerHTML = barcodeSVG(a.assetTag, { module: 2, height: 56 });
      const pdfBtn = document.getElementById("asset-print-pdf");
      if (pdfBtn) pdfBtn.onclick = () => printAssetPdf(a);
      // ผูก handler ด้วย JS แทนการฝัง assetTag ลง onclick — esc() ไม่ปลอดภัยใน string literal ของ JS
      const bcBtn = document.getElementById("asset-print-barcode");
      if (bcBtn) bcBtn.onclick = () => printBarcode(a.assetTag);
      if (isStaff) {
        const ra = document.getElementById("rel-add"); if (ra) ra.onclick = () => relationModal(a.id);
        const ms = document.getElementById("mark-seen");
        if (ms) ms.onclick = async () => { try { await api.post(`/assets/${a.id}/seen`, {}); toast("บันทึกการตรวจนับแล้ว", "success"); navigate("asset-detail", { id: a.id }); } catch (e) { toast(e.message, "error"); } };
      }
    },
  };
};

const REL_TYPE = { DEPENDS_ON: "พึ่งพา", CONNECTS_TO: "เชื่อมต่อกับ", PART_OF: "เป็นส่วนของ", INSTALLED_ON: "ติดตั้งบน", BACKUP_OF: "สำรองของ" };

function assetLabel(a) {
  return `${a.assetTag}${a.type?.name ? ` · ${a.type.name}` : ""}`;
}

function assetFullLabel(a) {
  return `${assetLabel(a)} - ${[a.brand, a.model].filter(Boolean).join(" ")}`.trim();
}

async function removeRelation(assetId, relId) {
  try { await api.del(`/assets/${assetId}/relations/${relId}`); toast("ลบแล้ว", "success"); navigate("asset-detail", { id: assetId }); }
  catch (e) { toast(e.message, "error"); }
}
async function removeUserRelation(assetId, relId) {
  try { await api.del(`/assets/${assetId}/user-relations/${relId}`); toast("ลบแล้ว", "success"); navigate("asset-detail", { id: assetId }); }
  catch (e) { toast(e.message, "error"); }
}
function softwareLicenseLabel(license) {
  if (!license) return "-";
  return [license.name, license.publisher].filter(Boolean).join(" - ");
}

function relationsHtml(a, isStaff) {
  const out = (a.relationsFrom || []).map((r) => ({ kind: "asset", relId: r.id, label: REL_TYPE[r.type] || r.type, other: r.target }))
    .concat((a.relationsTo || []).map((r) => ({ kind: "asset", relId: r.id, label: (REL_TYPE[r.type] || r.type) + " (โดย)", other: r.source })))
    .concat((a.assignments || []).filter((r) => !r.returnedAt).map((r) => ({ kind: "user", relId: r.id, label: "ผู้ใช้งาน", user: r.user })))
    .concat((a.softwareAssignments || []).map((r) => ({ kind: "software", relId: r.id, label: "Software", license: r.license })));
  if (!out.length) return '<div class="empty">ยังไม่มีความสัมพันธ์</div>';
  return out.map((r) => {
    const body = r.kind === "user"
      ? `<span>${esc(r.user?.fullName || "-")}${r.user?.username ? ` <span class="muted">(${esc(r.user.username)})</span>` : ""}</span>`
      : r.kind === "software"
        ? `<span>${esc(softwareLicenseLabel(r.license))}${r.license?.expiry ? ` <span class="muted">(หมดอายุ ${fmtDate(r.license.expiry)})</span>` : ""}</span>`
        : `<span class="link" style="cursor:pointer" ${navAttr("asset-detail", { id: r.other.id })}>${esc(assetFullLabel(r.other))}</span>`;
    const remove = callAttr(r.kind === "user" ? "removeUserRelation" : r.kind === "software" ? "removeSoftwareRelation" : "removeRelation", a.id, r.relId);
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--gray-100)">
      <div><span class="chip">${esc(r.label)}</span> ${body}</div>
      ${isStaff ? `<button class="btn btn-ghost btn-sm" ${remove}>🗑️</button>` : ""}
    </div>`;
  }).join("");
}

async function relationModal(assetId) {
  const [data, users, licenses] = await Promise.all([api.get("/assets?pageSize=100"), api.get("/users"), api.get("/procurement/licenses")]);
  const userOpts = users.map((u) => {
    const label = `${u.fullName}${u.username ? ` (${u.username})` : ""}`;
    return `<option value="${u.id}" title="${esc(label)}">${esc(label)}</option>`;
  }).join("");
  const softwareOpts = licenses.length ? licenses.map((l) => {
    const label = softwareLicenseLabel(l);
    return `<option value="${l.id}" title="${esc(label)}">${esc(label)}</option>`;
  }).join("") : '<option value="">ยังไม่มี Software License</option>';
  const topts = Object.entries(REL_TYPE).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const overlay = modal(`<div class="card-header"><div class="card-title">เพิ่มความสัมพันธ์</div></div>
    <div class="card-body"><div class="form-grid">
      <div class="form-group"><label>ผูกกับ</label><select id="rel-kind"><option value="asset">ทรัพย์สิน</option><option value="user">ผู้ใช้งาน</option><option value="software">Software License</option></select></div>
      <div class="form-group" id="rel-type-wrap"><label>ความสัมพันธ์</label><select id="rel-type">${topts}</select></div>
      <div class="form-group full" id="rel-asset-wrap"><label>ทรัพย์สิน</label><input id="rel-target" list="rel-target-options" placeholder="พิมพ์ Asset ID, Hostname, ยี่ห้อ หรือรุ่น"><datalist id="rel-target-options"></datalist><span class="form-hint" id="rel-target-preview"></span></div>
      <div class="form-group full hidden" id="rel-user-wrap"><label>ผู้ใช้งาน</label><select id="rel-user">${userOpts}</select><span class="form-hint" id="rel-user-preview"></span></div>
      <div class="form-group full hidden" id="rel-software-wrap"><label>Software License</label><select id="rel-software">${softwareOpts}</select><span class="form-hint" id="rel-software-preview"></span></div>
    </div></div>
    <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" id="rel-cancel">ยกเลิก</button><button class="btn btn-primary" id="rel-save">เพิ่ม</button></div>`);
  overlay.querySelector(".modal").classList.add("relation-modal");
  const relTarget = overlay.querySelector("#rel-target");
  const relTargetList = overlay.querySelector("#rel-target-options");
  const relTargetPreview = overlay.querySelector("#rel-target-preview");
  let assetChoices = (data.items || []).filter((x) => x.id !== assetId);
  let assetSearchTimer = null;
  const renderAssetChoices = (items) => {
    const seen = new Set();
    assetChoices = (items || []).filter((x) => x.id !== assetId && !seen.has(x.id) && seen.add(x.id));
    relTargetList.innerHTML = assetChoices.map((x) => {
      const label = assetFullLabel(x);
      return `<option value="${esc(x.assetTag)}" label="${esc(label)}"></option>`;
    }).join("");
  };
  const syncAssetTarget = () => {
    const q = relTarget.value.trim().toLowerCase();
    const exact = assetChoices.filter((x) =>
      String(x.assetTag || "").toLowerCase() === q ||
      String(x.hostname || "").toLowerCase() === q ||
      assetFullLabel(x).toLowerCase() === q
    );
    const picked = exact.length === 1 ? exact[0] : null;
    relTarget.dataset.targetId = picked ? String(picked.id) : "";
    relTargetPreview.textContent = picked
      ? assetFullLabel(picked)
      : q ? "เลือกจากรายการ หรือพิมพ์ Asset ID/Hostname ให้ตรง" : "";
  };
  const searchAssetChoices = async () => {
    const q = relTarget.value.trim();
    relTarget.dataset.targetId = "";
    if (q.length < 2) {
      renderAssetChoices(data.items || []);
      syncAssetTarget();
      return;
    }
    try {
      const r = await api.get("/assets" + qs({ q, pageSize: 20 }));
      renderAssetChoices(r.items || []);
    } catch {
      relTargetList.innerHTML = "";
      assetChoices = [];
    }
    syncAssetTarget();
  };
  renderAssetChoices(assetChoices);
  const syncPreview = (selectId, previewId) => {
    const select = overlay.querySelector(selectId);
    const preview = overlay.querySelector(previewId);
    preview.textContent = select?.selectedOptions?.[0]?.textContent || "";
  };
  const toggleKind = () => {
    const kind = overlay.querySelector("#rel-kind").value;
    overlay.querySelector("#rel-type-wrap").classList.toggle("hidden", kind !== "asset");
    overlay.querySelector("#rel-asset-wrap").classList.toggle("hidden", kind !== "asset");
    overlay.querySelector("#rel-user-wrap").classList.toggle("hidden", kind !== "user");
    overlay.querySelector("#rel-software-wrap").classList.toggle("hidden", kind !== "software");
  };
  syncPreview("#rel-user", "#rel-user-preview");
  syncPreview("#rel-software", "#rel-software-preview");
  relTarget.addEventListener("input", () => {
    clearTimeout(assetSearchTimer);
    assetSearchTimer = setTimeout(searchAssetChoices, 250);
  });
  relTarget.addEventListener("change", syncAssetTarget);
  overlay.querySelector("#rel-user").onchange = () => syncPreview("#rel-user", "#rel-user-preview");
  overlay.querySelector("#rel-software").onchange = () => syncPreview("#rel-software", "#rel-software-preview");
  overlay.querySelector("#rel-kind").onchange = toggleKind;
  overlay.querySelector("#rel-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#rel-save").onclick = async () => {
    const kind = val("rel-kind");
    let targetId = kind === "user" ? val("rel-user") : kind === "software" ? val("rel-software") : relTarget.dataset.targetId;
    if (kind === "asset" && !targetId && val("rel-target")) {
      try {
        const q = val("rel-target");
        const r = await api.get("/assets" + qs({ q, pageSize: 10 }));
        const exact = (r.items || []).filter((x) =>
          x.id !== assetId && (
            String(x.assetTag || "").toLowerCase() === q.toLowerCase() ||
            String(x.hostname || "").toLowerCase() === q.toLowerCase()
          )
        );
        if (exact.length === 1) targetId = String(exact[0].id);
        else {
          const filtered = (r.items || []).filter((x) => x.id !== assetId);
          if (filtered.length === 1) targetId = String(filtered[0].id);
        }
      } catch {}
    }
    if (!targetId) {
      if (kind === "asset") return toast("กรุณาเลือกทรัพย์สินจากรายการ หรือพิมพ์ Asset ID/Hostname ให้ตรง", "error");
      return overlay.remove();
    }
    try {
      if (kind === "user") await api.post(`/assets/${assetId}/user-relations`, { userId: Number(targetId) });
      else if (kind === "software") await api.post(`/assets/${assetId}/software-relations`, { licenseId: Number(targetId) });
      else await api.post(`/assets/${assetId}/relations`, { targetId: Number(targetId), type: val("rel-type") });
      toast("เพิ่มแล้ว", "success"); overlay.remove(); navigate("asset-detail", { id: assetId });
    } catch (e) { toast(e.message, "error"); }
  };
  toggleKind();
}

async function removeSoftwareRelation(assetId, relId) {
  try { await api.del(`/assets/${assetId}/software-relations/${relId}`); toast("ลบแล้ว", "success"); navigate("asset-detail", { id: assetId }); }
  catch (e) { toast(e.message, "error"); }
}

async function deleteAsset(assetId, assetTag) {
  const ok = confirm(`ต้องการลบทรัพย์สิน "${assetTag}" ออกจากฐานข้อมูลจริงหรือไม่?\n\nการลบนี้ไม่ใช่การเปลี่ยนสถานะ และกู้คืนจากหน้าระบบไม่ได้`);
  if (!ok) return;
  try {
    await api.del(`/assets/${assetId}`);
    toast("ลบทรัพย์สินออกจากฐานข้อมูลแล้ว", "success");
    navigate("assets");
  } catch (e) {
    toast(e.message, "error");
  }
}
function printAssetPdf(a) {
  const safe = (v) => esc(v || "—");
  const row = (label, value) => `<tr><th>${safe(label)}</th><td>${safe(value)}</td></tr>`;
  const money = (v) => v == null ? "—" : fmtMoney(v);
  const barcode = window.barcodeSVG ? barcodeSVG(a.assetTag, { module: 2, height: 58 }) : "";
  const repairs = (a.tickets || []).map((t) => `<tr>
    <td>${safe(t.ticketNo)}</td><td>${safe(t.subject)}</td><td>${fmtDate(t.createdAt)}</td><td>${safe(TICKET_STATUS[t.status] || t.status)}</td>
  </tr>`).join("") || '<tr><td colspan="4" class="muted center">ยังไม่มีประวัติแจ้งซ่อม</td></tr>';
  const relations = []
    .concat((a.assignments || []).filter((r) => !r.returnedAt).map((r) => ["ผู้ใช้งาน", `${r.user?.fullName || "-"}${r.user?.username ? ` (${r.user.username})` : ""}`]))
    .concat((a.softwareAssignments || []).map((r) => ["Software", `${softwareLicenseLabel(r.license)}${r.license?.expiry ? ` (หมดอายุ ${fmtDate(r.license.expiry)})` : ""}`]))
    .concat((a.relationsFrom || []).map((r) => [REL_TYPE[r.type] || r.type, assetFullLabel(r.target)]))
    .concat((a.relationsTo || []).map((r) => [`${REL_TYPE[r.type] || r.type} (โดย)`, assetFullLabel(r.source)]));
  const relationRows = relations.map(([kind, text]) => `<tr><td>${safe(kind)}</td><td>${safe(text)}</td></tr>`).join("") ||
    '<tr><td colspan="2" class="muted center">ยังไม่มีความสัมพันธ์</td></tr>';
  const title = `${a.assetTag} - ${a.brand || ""} ${a.model || ""}`.trim();
  const generatedAt = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  const doc = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${safe(title)}</title>
    <link rel="stylesheet" href="/css/fonts.css">
    <style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #e5e7eb; color: #111827; font-family: 'Prompt', 'Tahoma', 'Arial', sans-serif; font-size: 12px; line-height: 1.5; }
      .toolbar { position: sticky; top: 0; display: flex; justify-content: center; gap: 8px; padding: 10px; background: #111827; z-index: 5; }
      .toolbar button { border: 0; border-radius: 7px; padding: 8px 14px; font-weight: 700; cursor: pointer; }
      .toolbar .primary { background: #2563eb; color: white; }
      .sheet { width: 210mm; min-height: 297mm; margin: 16px auto; background: white; padding: 12mm; box-shadow: 0 10px 28px rgba(15,23,42,.18); }
      .head { display: grid; grid-template-columns: 1fr 150px; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #1d4ed8; }
      .brand { font-size: 12px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
      h1 { margin: 4px 0 8px; font-size: 24px; line-height: 1.18; color: #0f172a; }
      .subtitle { color: #475569; font-size: 12px; }
      .status { display: inline-block; margin-top: 10px; padding: 5px 10px; border-radius: 999px; background: #dcfce7; color: #166534; font-weight: 700; }
      .barcode { text-align: right; }
      .barcode svg { max-width: 145px; height: auto; }
      .section { margin-top: 13px; break-inside: avoid; }
      .section-title { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; color: #0f172a; font-size: 13px; font-weight: 800; }
      .section-title::before { content: ""; width: 5px; height: 16px; border-radius: 4px; background: #2563eb; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; }
      th, td { border-bottom: 1px solid #e2e8f0; padding: 7px 8px; vertical-align: top; }
      th { width: 35%; color: #64748b; text-align: left; background: #f8fafc; font-weight: 700; }
      td { color: #0f172a; font-weight: 600; overflow-wrap: anywhere; }
      .data-table th { width: auto; color: #334155; }
      .data-table thead th { background: #eff6ff; color: #1e3a8a; }
      .muted { color: #94a3b8; font-weight: 500; }
      .center { text-align: center; }
      .notes { min-height: 44px; border: 1px solid #e2e8f0; padding: 9px; border-radius: 8px; color: #334155; line-height: 1.55; }
      .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 24px; }
      .sig { text-align: center; padding-top: 30px; border-top: 1px solid #94a3b8; color: #475569; }
      .foot { display: flex; justify-content: space-between; margin-top: 14px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 10.5px; }
      @media print {
        body { background: white; }
        .toolbar { display: none; }
        .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
      }
    </style></head><body>
    <div class="toolbar"><button class="primary" id="print-now">พิมพ์ / Save เป็น PDF</button><button id="print-close">ปิด</button></div>
    <main class="sheet">
      <header class="head">
        <div>
          <div class="brand">IT Service Desk</div>
          <h1>ใบรายละเอียดทรัพย์สิน IT</h1>
          <div class="subtitle">${safe(title)} · ${safe(a.type?.name)} · ผู้ครอบครอง ${safe(a.owner?.fullName)}</div>
          <span class="status">${safe(ASSET_STATUS[a.status] || a.status)}</span>
        </div>
        <div class="barcode">${barcode}</div>
      </header>
      <section class="section grid">
        <div>
          <div class="section-title">ข้อมูลอุปกรณ์</div>
          <table><tbody>
            ${row("Asset ID", a.assetTag)}
            ${row("รหัสทรัพย์สินบัญชี", a.accountingAssetCode)}
            ${row("ยี่ห้อ / รุ่น", [a.brand, a.model].filter(Boolean).join(" "))}
            ${row("Serial No.", a.serialNo)}
            ${row("Hostname", a.hostname)}
            ${row("OS", a.os)}
            ${row("Office", a.officeSuite)}
          </tbody></table>
        </div>
        <div>
          <div class="section-title">เครือข่ายและผู้รับผิดชอบ</div>
          <table><tbody>
            ${row("IP Address", a.ipAddress)}
            ${row("MAC Address", a.macAddress)}
            ${row("ผู้ครอบครอง", a.owner?.fullName)}
            ${row("แผนก", a.department?.name)}
            ${row("สถานที่", a.locationText || a.location?.name)}
            ${row("ตรวจนับล่าสุด", a.lastSeenAt ? fmtDateTime(a.lastSeenAt) : "ยังไม่เคย")}
          </tbody></table>
        </div>
      </section>
      <section class="section">
        <div class="section-title">Specification</div>
        <div class="notes">${safe(a.specification)}</div>
      </section>
      <section class="section grid">
        <div>
          <div class="section-title">การจัดซื้อและประกัน</div>
          <table><tbody>
            ${row("วันที่ซื้อ", fmtDate(a.purchaseDate))}
            ${row("ราคา", money(a.purchasePrice))}
            ${row("ผู้จำหน่าย", a.vendor?.name)}
            ${row("เลขที่ PO", a.poNumber)}
            ${row("ประกันหมด", fmtDate(a.warrantyExpiry))}
          </tbody></table>
        </div>
        <div>
          <div class="section-title">หมายเหตุ</div>
          <div class="notes">${safe(a.notes)}</div>
        </div>
      </section>
      <section class="section">
        <div class="section-title">ความสัมพันธ์ / Software</div>
        <table class="data-table"><thead><tr><th>ประเภท</th><th>รายการ</th></tr></thead><tbody>${relationRows}</tbody></table>
      </section>
      <section class="section">
        <div class="section-title">ประวัติการแจ้งซ่อม</div>
        <table class="data-table"><thead><tr><th>Ticket ID</th><th>ปัญหา</th><th>วันที่</th><th>สถานะ</th></tr></thead><tbody>${repairs}</tbody></table>
      </section>
      <section class="signatures">
        <div class="sig">ผู้ครอบครอง</div>
        <div class="sig">เจ้าหน้าที่ IT</div>
        <div class="sig">ผู้ตรวจสอบ</div>
      </section>
      <footer class="foot"><span>สร้างจาก IT Service Desk</span><span>พิมพ์เมื่อ ${safe(generatedAt)}</span></footer>
    </main>
  </body></html>`;
  const w = window.open("", "_blank", "width=980,height=900");
  if (!w) return toast("Browser บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต popup", "error");
  w.document.write(doc);
  w.document.close();
  // หน้าต่าง about:blank สืบทอด CSP ของแอป (ห้าม inline script) จึงผูกปุ่มและสั่งพิมพ์จากหน้าต่างหลักแทน
  w.document.getElementById("print-now")?.addEventListener("click", () => w.print());
  w.document.getElementById("print-close")?.addEventListener("click", () => w.close());
  printWhenReady(w, 350);
}

// รอฟอนต์ในหน้าต่างพิมพ์โหลดเสร็จก่อนสั่งพิมพ์
function printWhenReady(w, delay = 0) {
  const go = () => setTimeout(() => { try { w.focus(); w.print(); } catch {} }, delay);
  if (w.document.fonts?.ready) w.document.fonts.ready.then(go, go);
  else go();
}

function printBarcode(tag) {
  const svg = window.barcodeSVG ? barcodeSVG(tag, { module: 3, height: 80 }) : "";
  const w = window.open("", "_blank", "width=420,height=260");
  if (!w) return toast("Browser บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต popup", "error");
  w.document.write(`<html><head><title>${esc(tag)}</title><link rel="stylesheet" href="/css/fonts.css"></head><body style="text-align:center;font-family:'Prompt',sans-serif;padding:20px">${svg}</body></html>`);
  w.document.close();
  printWhenReady(w);
}

// ═══════════════ DEPRECIATION REPORT (ค่าเสื่อมราคา) ═══════════════
Pages.depreciation = async () => {
  const d = await api.get("/reports/depreciation");
  const rows = d.rows.map((r) => `<tr>
    <td class="link">${esc(r.assetTag)}</td><td>${esc(r.name)}</td>
    <td style="text-align:right">${fmtMoney(r.purchasePrice)}</td>
    <td style="text-align:center">${r.monthsUsed}/${r.usefulLifeMonths}</td>
    <td style="text-align:right">${fmtMoney(r.monthlyDepreciation)}</td>
    <td style="text-align:right;color:var(--danger)">${fmtMoney(r.accumulatedDepreciation)}</td>
    <td style="text-align:right;font-weight:600">${fmtMoney(r.bookValue)}</td>
    <td>${r.fullyDepreciated ? '<span class="chip">เสื่อมเต็ม</span>' : '<span class="chip green">กำลังใช้</span>'}</td>
  </tr>`).join("") || `<tr><td colspan="8"><div class="empty">ยังไม่มีทรัพย์สินที่ตั้งราคา + อายุใช้งาน</div></td></tr>`;
  return {
    title: "รายงานค่าเสื่อมราคา",
    html: `<div class="filter-bar">
        <div style="flex:1;color:var(--gray-500);font-size:13px">คำนวณแบบเส้นตรง (straight-line) จากราคาซื้อ − มูลค่าซาก ÷ อายุใช้งาน (เดือน)</div>
        <a class="btn btn-ghost btn-sm" href="/api/reports/depreciation.csv">📥 Export CSV</a></div>
      <div class="kpi-grid">
        ${kpiCard("blue", "💰", fmtMoney(d.totals.purchasePrice), "มูลค่าซื้อรวม")}
        ${kpiCard("red", "📉", fmtMoney(d.totals.accumulatedDepreciation), "ค่าเสื่อมสะสม")}
        ${kpiCard("green", "🏦", fmtMoney(d.totals.bookValue), "มูลค่าตามบัญชีคงเหลือ")}
        ${kpiCard("yellow", "📦", d.count, "รายการ")}
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Asset ID</th><th>อุปกรณ์</th><th style="text-align:right">ราคาซื้อ</th><th style="text-align:center">ใช้แล้ว(ด.)</th><th style="text-align:right">ค่าเสื่อม/เดือน</th><th style="text-align:right">ค่าเสื่อมสะสม</th><th style="text-align:right">มูลค่าคงเหลือ</th><th>สถานะ</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`,
  };
};

// ═══════════════ STOCK-TAKE (ตรวจนับทรัพย์สิน) ═══════════════
Pages.stocktake = async () => {
  return {
    title: "ตรวจนับทรัพย์สิน (Stock-take)",
    html: `<div class="card"><div class="card-body">
        <div style="color:var(--gray-500);font-size:13px;margin-bottom:12px">สแกนบาร์โค้ด หรือพิมพ์ Asset ID แล้วกด Enter เพื่อบันทึกว่าตรวจนับเจอ</div>
        <div style="display:flex;gap:8px;max-width:480px">
          <input class="search-input" id="st-tag" placeholder="สแกน/พิมพ์ Asset ID เช่น MON-HR-003" autofocus style="flex:1">
          <button class="btn btn-primary" id="st-go">ตรวจนับ</button>
        </div>
      </div></div>
      <div class="card"><div class="card-header"><div class="card-title">รายการที่ตรวจนับในรอบนี้ <span id="st-count" style="color:var(--gray-500);font-weight:400">(0)</span></div></div>
        <div class="table-wrap"><table><thead><tr><th>เวลา</th><th>Asset ID</th><th>อุปกรณ์</th><th>สถานะ</th><th>ผล</th></tr></thead><tbody id="st-rows"></tbody></table></div></div>`,
    after: () => {
      const input = document.getElementById("st-tag"), tbody = document.getElementById("st-rows"), cnt = document.getElementById("st-count");
      let n = 0;
      const scan = async () => {
        const tag = input.value.trim(); if (!tag) return;
        input.value = ""; input.focus();
        const now = new Date().toLocaleTimeString("th-TH");
        let row;
        try {
          const a = await api.get("/assets/by-tag/" + encodeURIComponent(tag));
          await api.post(`/assets/${a.id}/seen`, {});
          row = `<tr><td style="font-size:12px">${now}</td><td class="link">${esc(a.assetTag)}</td><td>${esc(a.brand)} ${esc(a.model)}</td><td>${statusBadge(a.status)}</td><td><span class="chip green">✅ พบ</span></td></tr>`;
        } catch (e) {
          row = `<tr><td style="font-size:12px">${now}</td><td>${esc(tag)}</td><td colspan="2" style="color:var(--gray-400)">—</td><td><span class="chip">❌ ไม่พบ</span></td></tr>`;
        }
        tbody.insertAdjacentHTML("afterbegin", row); cnt.textContent = `(${++n})`;
      };
      document.getElementById("st-go").onclick = scan;
      input.onkeydown = (e) => { if (e.key === "Enter") scan(); };
    },
  };
};

// ═══════════════ USERS (ADMIN) ═══════════════
Pages.users = async (params = {}) => {
  await loadMeta();
  const query = { q: params.q || "", role: params.role || "", page: params.page || 1, pageSize: 20 };
  const data = await api.get("/users" + qs(query));
  const users = data.items || data;
  const isAdmin = State.user.role === "ADMIN";
  const rows = users.map((u) => `<tr>
    <td><div style="font-weight:500">${esc(u.fullName)}</div><div style="font-size:11.5px;color:var(--gray-500)">${esc([u.username, u.email].filter(Boolean).join(" · "))}</div></td>
    <td>${esc(ROLE[u.role])}</td><td>${esc(u.department?.name || "—")}</td>
    <td>${u.isActive ? '<span class="badge b-IN_USE">ใช้งาน</span>' : '<span class="badge b-RETIRED">ปิด</span>'}</td>
    ${isAdmin ? `<td><button class="btn btn-ghost btn-sm" ${callAttr("userForm", { id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, jobTitle: u.jobTitle, role: u.role, departmentId: u.department?.id, isActive: u.isActive })}>แก้ไข</button></td>` : ""}
  </tr>`).join("") || `<tr><td colspan="${isAdmin ? 5 : 4}"><div class="empty">ไม่พบผู้ใช้งาน</div></td></tr>`;
  return {
    title: "จัดการผู้ใช้งาน",
    html: `<div class="filter-bar">
        <input class="search-input" id="u-q" placeholder="ค้นหาชื่อ, อีเมล, ชื่อผู้ใช้..." value="${esc(query.q)}">
        <select class="filter" id="u-role">
          <option value="">บทบาททั้งหมด</option>
          ${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${query.role === k ? "selected" : ""}>${esc(v)}</option>`).join("")}
        </select>
        <button class="btn btn-primary btn-sm" id="u-search">ค้นหา</button>
        <button class="btn btn-ghost btn-sm" id="u-clear" ${query.q || query.role ? "" : "disabled"}>ล้าง</button>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">ผู้ใช้งาน (${data.total ?? users.length}) <span style="font-weight:400;color:var(--gray-500)">แสดงหน้า ${data.page ?? 1} ครั้งละ ${data.pageSize ?? users.length} รายการ</span></div>
      ${isAdmin ? `<button class="btn btn-primary btn-sm" id="u-new">+ เพิ่มผู้ใช้</button>` : ""}</div>
      <div class="table-wrap"><table><thead><tr><th>ชื่อ / อีเมล</th><th>บทบาท</th><th>แผนก</th><th>สถานะ</th>${isAdmin ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>
      ${pagination(data, "users", query)}</div>`,
    after: () => {
      const apply = () => navigate("users", { q: val("u-q"), role: val("u-role"), page: 1 });
      let searchTimer;
      document.getElementById("u-role").onchange = apply;
      document.getElementById("u-search").onclick = apply;
      document.getElementById("u-clear").onclick = () => navigate("users");
      document.getElementById("u-q").oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(apply, 350);
      };
      document.getElementById("u-q").onkeydown = (e) => { if (e.key === "Enter") apply(); };
      if (isAdmin) document.getElementById("u-new").onclick = () => userForm();
    },
  };
};
// ═══════════════ TEAMS / QUEUES ═══════════════
Pages.teams = async () => {
  await loadMeta();
  const [teams, users] = await Promise.all([api.get("/teams"), api.get("/users")]);
  const isAdmin = State.user.role === "ADMIN";
  TeamCache.users = users;
  TeamCache.teams = teams;
  const cards = teams.map((t) => `
    <div class="card">
      <div class="card-header">
        <div class="card-title">${esc(t.name)} ${t.isActive ? "" : '<span class="chip">ปิดใช้งาน</span>'}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="chip blue">🎫 ${t.ticketCount}</span>
          ${isAdmin ? `<button class="btn btn-ghost btn-sm" ${callAttr("teamForm", t.id)}>แก้ไข</button>
          <button class="btn btn-ghost btn-sm" ${callAttr("teamDelete", t.id)} title="ลบทีม">🗑️</button>` : ""}
        </div>
      </div>
      <div class="card-body">
        ${t.description ? `<div style="color:var(--gray-500);font-size:13px;margin-bottom:10px">${esc(t.description)}</div>` : ""}
        <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:4px">สมาชิก (${t.members.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
          ${t.members.map((m) => `<span class="chip">${esc(m.fullName)}</span>`).join("") || '<span style="color:var(--gray-400);font-size:13px">— ยังไม่มีสมาชิก —</span>'}
        </div>
        <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:4px">หมวดที่ดูแล (auto-assign)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${t.categories.map((c) => `<span class="chip blue">${esc(c.icon || "")} ${esc(c.name)}</span>`).join("") || '<span style="color:var(--gray-400);font-size:13px">— ไม่ผูกหมวด —</span>'}
        </div>
      </div>
    </div>`).join("") || '<div class="empty">ยังไม่มีทีม</div>';
  return {
    title: "ทีม / คิวงาน",
    html: `<div class="filter-bar">
        <div style="flex:1;color:var(--gray-500);font-size:13px">จัดกลุ่มเจ้าหน้าที่เป็นทีม + ผูกหมวดปัญหา → ระบบมอบหมาย ticket ให้สมาชิกในทีมที่งานน้อยสุดอัตโนมัติ</div>
        ${isAdmin ? '<button class="btn btn-primary btn-sm" id="t-new">+ สร้างทีม</button>' : ""}
      </div>
      <div class="grid-2">${cards}</div>`,
    after: () => { if (isAdmin) document.getElementById("t-new").onclick = () => teamForm(); },
  };
};

function teamForm(id) {
  const team = id ? TeamCache.teams.find((t) => t.id === id) : null;
  const users = TeamCache.users.filter((u) => u.role !== "USER");
  const cats = META.categories || [];
  const memberIds = new Set((team?.members || []).map((m) => m.id));
  const catIds = new Set((team?.categories || []).map((c) => c.id));
  const checks = (items, prefix, label, checkedSet) => `
    <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin:6px 0 4px">${label}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;max-height:160px;overflow:auto">
      ${items.map((it) => `<label class="chip" style="cursor:pointer;display:flex;gap:5px;align-items:center;font-weight:400">
        <input type="checkbox" value="${it.id}" data-grp="${prefix}" style="width:auto" ${checkedSet.has(it.id) ? "checked" : ""}>
        ${esc(it.name || it.fullName)}</label>`).join("")}
    </div>`;
  const overlay = modal(`<div class="card-header"><div class="card-title">${team ? "แก้ไขทีม" : "สร้างทีมใหม่"}</div></div>
    <div class="card-body">
      <div class="form-group full"><label>ชื่อทีม <span class="req">*</span></label><input id="tm-name" value="${esc(team?.name || "")}" placeholder="เช่น Network Team"></div>
      <div class="form-group full"><label>คำอธิบาย</label><input id="tm-desc" value="${esc(team?.description || "")}" placeholder="ขอบเขตงานของทีม"></div>
      <label style="display:flex;gap:6px;font-weight:400;margin:4px 0"><input type="checkbox" id="tm-active" style="width:auto" ${team ? (team.isActive ? "checked" : "") : "checked"}> เปิดใช้งาน</label>
      ${checks(users, "mem", "สมาชิกทีม (เจ้าหน้าที่)", memberIds)}
      ${checks(cats, "cat", "หมวดปัญหาที่ทีมดูแล", catIds)}
    </div>
    <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" id="tm-cancel">ยกเลิก</button><button class="btn btn-primary" id="tm-save">💾 บันทึก</button></div>`);
  overlay.querySelector("#tm-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#tm-save").onclick = async () => {
    const name = val("tm-name");
    if (!name) return toast("กรุณากรอกชื่อทีม", "error");
    const pick = (grp) => [...overlay.querySelectorAll(`input[data-grp="${grp}"]:checked`)].map((c) => Number(c.value));
    const payload = { name, description: val("tm-desc"), isActive: overlay.querySelector("#tm-active").checked, memberIds: pick("mem"), categoryIds: pick("cat") };
    const btn = overlay.querySelector("#tm-save"); btn.disabled = true;
    try {
      if (team) await api.patch("/teams/" + team.id, payload);
      else await api.post("/teams", payload);
      toast("บันทึกทีมแล้ว", "success"); overlay.remove(); navigate("teams");
    } catch (e) { toast(e.message, "error"); btn.disabled = false; }
  };
}

async function teamDelete(id) {
  if (!confirm("ยืนยันลบทีมนี้? (ticket/หมวดที่ผูกอยู่จะถูกปลดออกจากทีม)")) return;
  try { await api.del("/teams/" + id); toast("ลบทีมแล้ว", "success"); navigate("teams"); }
  catch (e) { toast(e.message, "error"); }
}

// ═══════════════ PROBLEM MANAGEMENT (ITIL) ═══════════════
function pBadge(s) { const c = { INVESTIGATING: "blue", KNOWN_ERROR: "amber", RESOLVED: "green" }[s] || ""; return `<span class="chip ${c}">${esc(PROBLEM_STATUS[s] || s)}</span>`; }
const itilStaff = () => ["ADMIN", "MANAGER", "AGENT"].includes(State.user.role);

Pages.problems = async () => {
  const items = await api.get("/problems");
  const staff = itilStaff();
  const rows = items.map((p) => `<tr class="clickable" ${navAttr("problem-detail", { id: p.id })}>
    <td class="link">${esc(p.problemNo)}</td>
    <td><div style="font-weight:500">${esc(p.title)}</div></td>
    <td>${priorityTag(p.priority)}</td>
    <td>${pBadge(p.status)}</td>
    <td>${esc(p.owner?.fullName || "—")}</td>
    <td><span class="chip blue">🎫 ${p._count.tickets}</span></td>
    <td style="font-size:12px">${fmtDate(p.createdAt)}</td>
  </tr>`).join("") || `<tr><td colspan="7"><div class="empty">ยังไม่มี Problem</div></td></tr>`;
  return {
    title: "Problem Management",
    html: `<div class="filter-bar">
        <div style="flex:1;color:var(--gray-500);font-size:13px">รวมเหตุขัดข้องที่เกิดซ้ำ → วิเคราะห์หาสาเหตุราก (root cause) เพื่อแก้ถาวร</div>
        ${staff ? '<button class="btn btn-primary btn-sm" id="p-new">+ สร้าง Problem</button>' : ""}</div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>เลขที่</th><th>หัวข้อ</th><th>ความสำคัญ</th><th>สถานะ</th><th>ผู้รับผิดชอบ</th><th>Incident</th><th>วันที่</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`,
    after: () => { if (staff) document.getElementById("p-new").onclick = () => problemForm(); },
  };
};

Pages["problem-detail"] = async ({ id }) => {
  const p = await api.get("/problems/" + id);
  const staff = itilStaff();
  const tickets = p.tickets.map((t) => `<tr class="clickable" ${navAttr("ticket-detail", { id: t.id })}>
    <td class="link">${esc(t.ticketNo)}</td><td>${esc(t.subject)}</td><td>${statusBadge(t.status)}</td>
    ${staff ? `<td><button class="btn btn-ghost btn-sm" ${callAttr("unlinkTicket", id,t.id)}>ปลด</button></td>` : ""}
  </tr>`).join("") || `<tr><td colspan="${staff ? 4 : 3}"><div class="empty">ยังไม่มี Incident ที่เชื่อมโยง</div></td></tr>`;
  return {
    title: p.problemNo + " — " + p.title,
    html: `<div class="grid-2">
      <div class="card"><div class="card-header"><div class="card-title">รายละเอียด Problem</div>
        ${staff ? `<button class="btn btn-ghost btn-sm" ${callAttr("problemForm", { id: p.id, title: p.title, description: p.description, priority: p.priority, status: p.status, rootCause: p.rootCause, workaround: p.workaround, ownerId: p.owner?.id })}>แก้ไข</button>` : ""}</div>
        <div class="card-body">
          <div style="display:flex;gap:8px;margin-bottom:12px">${pBadge(p.status)} ${priorityTag(p.priority)}</div>
          <p style="white-space:pre-wrap;margin-bottom:14px">${esc(p.description)}</p>
          <div style="font-weight:600;font-size:13px;color:var(--gray-500)">🔍 สาเหตุราก (Root Cause)</div>
          <p style="white-space:pre-wrap;margin-bottom:12px">${esc(p.rootCause || "— ยังไม่ระบุ —")}</p>
          <div style="font-weight:600;font-size:13px;color:var(--gray-500)">🩹 วิธีแก้ชั่วคราว (Workaround)</div>
          <p style="white-space:pre-wrap;margin-bottom:12px">${esc(p.workaround || "— ยังไม่ระบุ —")}</p>
          <div style="font-size:12px;color:var(--gray-500)">ผู้รับผิดชอบ: ${esc(p.owner?.fullName || "—")} · สร้าง ${fmtDate(p.createdAt)}${p.resolvedAt ? " · แก้ไขเมื่อ " + fmtDate(p.resolvedAt) : ""}</div>
        </div></div>
      <div class="card"><div class="card-header"><div class="card-title">🎫 Incident ที่เชื่อมโยง (${p.tickets.length})</div>
        ${staff ? `<button class="btn btn-ghost btn-sm" id="link-tk">+ เชื่อม Incident</button>` : ""}</div>
        <div class="table-wrap"><table><thead><tr><th>เลขที่</th><th>หัวข้อ</th><th>สถานะ</th>${staff ? "<th></th>" : ""}</tr></thead><tbody>${tickets}</tbody></table></div></div>
      </div>`,
    after: () => { if (staff) { const b = document.getElementById("link-tk"); if (b) b.onclick = () => linkTicketModal(id); } },
  };
};

function problemForm(p) {
  const sopts = Object.entries(PROBLEM_STATUS).map(([k, v]) => ({ value: k, label: v }));
  const popts = Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v }));
  const fields = [
    { key: "title", label: "หัวข้อ", req: true, full: true },
    { key: "description", label: "รายละเอียด", type: "textarea", req: true },
    { key: "priority", label: "ความสำคัญ", type: "select", options: popts, default: "MEDIUM" },
    ...(p ? [{ key: "status", label: "สถานะ", type: "select", options: sopts }] : []),
    { key: "rootCause", label: "สาเหตุราก (Root Cause)", type: "textarea" },
    { key: "workaround", label: "วิธีแก้ชั่วคราว (Workaround)", type: "textarea" },
  ];
  formModal({
    title: p ? "แก้ไข Problem" : "สร้าง Problem", fields, values: p || {},
    onSubmit: async (data) => {
      const saved = p ? await api.patch("/problems/" + p.id, data) : await api.post("/problems", data);
      toast("บันทึก Problem แล้ว", "success");
      navigate(p ? "problem-detail" : "problems", p ? { id: p.id } : {});
    },
  });
}

async function linkTicketModal(problemId) {
  const data = await api.get("/tickets?pageSize=100");
  const opts = data.items.filter((t) => !t.problemId).map((t) => `<option value="${t.id}">${esc(t.ticketNo)} — ${esc(t.subject)}</option>`).join("");
  const overlay = modal(`<div class="card-header"><div class="card-title">เชื่อม Incident เข้ากับ Problem</div></div>
    <div class="card-body"><div class="form-group full"><label>เลือก Ticket</label><select id="lk-ticket">${opts || '<option value="">— ไม่มี ticket ว่าง —</option>'}</select></div></div>
    <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" id="lk-cancel">ยกเลิก</button><button class="btn btn-primary" id="lk-save">เชื่อม</button></div>`);
  overlay.querySelector("#lk-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#lk-save").onclick = async () => {
    const ticketId = val("lk-ticket"); if (!ticketId) return overlay.remove();
    try { await api.post(`/problems/${problemId}/link-ticket`, { ticketId: Number(ticketId) }); toast("เชื่อมแล้ว", "success"); overlay.remove(); navigate("problem-detail", { id: problemId }); }
    catch (e) { toast(e.message, "error"); }
  };
}
async function unlinkTicket(problemId, ticketId) {
  try { await api.del(`/problems/${problemId}/link-ticket/${ticketId}`); toast("ปลดแล้ว", "success"); navigate("problem-detail", { id: problemId }); }
  catch (e) { toast(e.message, "error"); }
}

// ═══════════════ CHANGE MANAGEMENT (ITIL) ═══════════════
function cBadge(s) { const c = { APPROVED: "blue", SCHEDULED: "blue", IN_PROGRESS: "amber", COMPLETED: "green", FAILED: "", CANCELLED: "" }[s] || ""; return `<span class="chip ${c}">${esc(CHANGE_STATUS[s] || s)}</span>`; }

Pages.changes = async () => {
  const items = await api.get("/changes");
  const staff = itilStaff();
  const rows = items.map((c) => `<tr class="clickable" ${navAttr("change-detail", { id: c.id })}>
    <td class="link">${esc(c.changeNo)}</td>
    <td><div style="font-weight:500">${esc(c.title)}</div></td>
    <td><span class="chip">${esc(CHANGE_TYPE[c.type] || c.type)}</span></td>
    <td>${priorityTag(c.risk)}</td>
    <td>${cBadge(c.status)}</td>
    <td>${esc(c.requester?.fullName || "—")}</td>
    <td style="font-size:12px">${fmtDate(c.plannedStart)}</td>
  </tr>`).join("") || `<tr><td colspan="7"><div class="empty">ยังไม่มี Change</div></td></tr>`;
  return {
    title: "Change Management",
    html: `<div class="filter-bar">
        <div style="flex:1;color:var(--gray-500);font-size:13px">บริหารการเปลี่ยนแปลงระบบอย่างมีแผน — ขออนุมัติ นัดเวลา มีแผนสำรอง (rollback)</div>
        ${staff ? '<button class="btn btn-primary btn-sm" id="c-new">+ สร้าง Change</button>' : ""}</div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>เลขที่</th><th>หัวข้อ</th><th>ประเภท</th><th>ความเสี่ยง</th><th>สถานะ</th><th>ผู้ขอ</th><th>นัดเริ่ม</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`,
    after: () => { if (staff) document.getElementById("c-new").onclick = () => changeForm(); },
  };
};

Pages["change-detail"] = async ({ id }) => {
  const c = await api.get("/changes/" + id);
  const staff = itilStaff();
  const canApprove = ["ADMIN", "MANAGER"].includes(State.user.role);
  // ปุ่ม workflow ตามสถานะ
  const flow = { DRAFT: ["SUBMITTED"], SUBMITTED: canApprove ? ["APPROVED", "CANCELLED"] : [], APPROVED: ["SCHEDULED"], SCHEDULED: ["IN_PROGRESS"], IN_PROGRESS: ["COMPLETED", "FAILED"] };
  const next = flow[c.status] || [];
  const btns = staff ? next.map((s) => `<button class="btn btn-${s === "FAILED" || s === "CANCELLED" ? "ghost" : "primary"} btn-sm" ${callAttr("changeStatus", id, s)}>${esc(CHANGE_STATUS[s])}</button>`).join("") : "";
  return {
    title: c.changeNo + " — " + c.title,
    html: `<div class="card"><div class="card-header"><div class="card-title">รายละเอียด Change</div>
        <div style="display:flex;gap:6px">${btns}
        ${staff ? `<button class="btn btn-ghost btn-sm" ${callAttr("changeForm", { id: c.id, title: c.title, description: c.description, type: c.type, risk: c.risk, plannedStart: toDateInputValue(c.plannedStart), plannedEnd: toDateInputValue(c.plannedEnd), implementationPlan: c.implementationPlan, rollbackPlan: c.rollbackPlan })}>แก้ไข</button>` : ""}</div></div>
      <div class="card-body">
        <div style="display:flex;gap:8px;margin-bottom:12px">${cBadge(c.status)} <span class="chip">${esc(CHANGE_TYPE[c.type])}</span> ${priorityTag(c.risk)}</div>
        <p style="white-space:pre-wrap;margin-bottom:14px">${esc(c.description)}</p>
        <div class="grid-2">
          <div><div style="font-weight:600;font-size:13px;color:var(--gray-500)">🛠️ แผนดำเนินการ</div><p style="white-space:pre-wrap">${esc(c.implementationPlan || "—")}</p></div>
          <div><div style="font-weight:600;font-size:13px;color:var(--gray-500)">↩️ แผนสำรอง (Rollback)</div><p style="white-space:pre-wrap">${esc(c.rollbackPlan || "—")}</p></div>
        </div>
        <div style="font-size:12px;color:var(--gray-500);margin-top:14px">ผู้ขอ: ${esc(c.requester?.fullName || "—")} · นัด ${fmtDate(c.plannedStart)} → ${fmtDate(c.plannedEnd)}${c.problem ? ` · เชื่อมกับ ${esc(c.problem.problemNo)}` : ""}</div>
      </div></div>`,
  };
};

function changeForm(c) {
  const topts = Object.entries(CHANGE_TYPE).map(([k, v]) => ({ value: k, label: v }));
  const ropts = Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v }));
  const fields = [
    { key: "title", label: "หัวข้อ", req: true, full: true },
    { key: "description", label: "รายละเอียด", type: "textarea", req: true },
    { key: "type", label: "ประเภท", type: "select", options: topts, default: "NORMAL" },
    { key: "risk", label: "ความเสี่ยง", type: "select", options: ropts, default: "MEDIUM" },
    { key: "plannedStart", label: "นัดเริ่ม", type: "date" },
    { key: "plannedEnd", label: "นัดเสร็จ", type: "date" },
    { key: "implementationPlan", label: "แผนดำเนินการ", type: "textarea" },
    { key: "rollbackPlan", label: "แผนสำรอง (Rollback)", type: "textarea" },
  ];
  formModal({
    title: c ? "แก้ไข Change" : "สร้าง Change", fields, values: c || {},
    onSubmit: async (data) => {
      if (c) await api.patch("/changes/" + c.id, data); else await api.post("/changes", data);
      toast("บันทึก Change แล้ว", "success");
      navigate(c ? "change-detail" : "changes", c ? { id: c.id } : {});
    },
  });
}
async function changeStatus(id, status) {
  try { await api.patch("/changes/" + id, { status }); toast("อัปเดตสถานะแล้ว", "success"); navigate("change-detail", { id }); }
  catch (e) { toast(e.message, "error"); }
}

// ═══════════════ SERVICE CATALOG ═══════════════
Pages.catalog = async () => {
  const items = await api.get("/catalog");
  const tiles = items.map((c) => `<div class="cat-tile" ${navAttr("ticket-new", { type: "SERVICE_REQUEST", catalogId: c.id, subject: c.name })}>
    <div style="font-size:32px">${esc(c.icon || "🛒")}</div>
    <div style="font-weight:600;margin-top:8px">${esc(c.name)}</div>
    <div style="font-size:12px;color:var(--gray-500);margin-top:4px">${esc(c.description || "")}</div>
    ${c.requiresApproval ? '<div class="chip amber" style="margin-top:8px">ต้องอนุมัติ</div>' : '<div class="chip green" style="margin-top:8px">อัตโนมัติ</div>'}
  </div>`).join("") || '<div class="empty">ยังไม่มีบริการ</div>';
  return {
    title: "Service Catalog — แคตตาล็อกบริการ",
    html: `<div class="card"><div class="card-body">
      <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">เลือกบริการที่ต้องการขอ — ระบบจะสร้างคำขอและเข้ากระบวนการอนุมัติอัตโนมัติหากจำเป็น</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px">${tiles}</div></div></div>`,
  };
};

// ═══════════════ APPROVALS ═══════════════
Pages.approvals = async () => {
  const items = await api.get("/approvals/mine");
  const rows = items.map((a) => `<tr>
    <td class="link clickable" ${navAttr("ticket-detail", { id: a.ticket.id })}>${esc(a.ticket.ticketNo)}</td>
    <td>${esc(a.ticket.subject)}</td>
    <td><span class="badge b-NEW">${a.ticket.type === "SERVICE_REQUEST" ? "คำขอบริการ" : "แจ้งซ่อม"}</span></td>
    <td>${esc(a.ticket.requester?.fullName || "")}</td>
    <td style="font-size:12px">${fmtDate(a.createdAt)}</td>
    <td><button class="btn btn-primary btn-sm" ${callAttr("decideApproval", a.id,'APPROVED')}>✓ อนุมัติ</button>
        <button class="btn btn-ghost btn-sm" ${callAttr("decideApproval", a.id,'REJECTED')}>✗ ปฏิเสธ</button></td></tr>`).join("");
  return {
    title: "งานรออนุมัติ (Approvals)",
    html: `<div class="card"><div class="card-header"><div class="card-title">รายการรออนุมัติของฉัน <span style="font-weight:400;color:var(--gray-500)">(${items.length})</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>เลขที่</th><th>เรื่อง</th><th>ประเภท</th><th>ผู้ขอ</th><th>วันที่</th><th>การดำเนินการ</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><div class="empty">ไม่มีงานรออนุมัติ</div></td></tr>'}</tbody></table></div></div>`,
  };
};
async function decideApproval(id, decision) {
  try {
    await api.post(`/approvals/${id}/decision`, { decision });
    toast(decision === "APPROVED" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว", "success");
    navigate("approvals");
    refreshBadges();
  } catch (e) { toast(e.message, "error"); }
}

// ═══════════════ KNOWLEDGE BASE ═══════════════
Pages.kb = async (params = {}) => {
  const [cats, data] = await Promise.all([
    api.get("/kb/categories"),
    api.get("/kb/articles" + qs({ q: params.q || "", categoryId: params.categoryId || "" })),
  ]);
  const tiles = cats.map((c) => `<div class="cat-tile" ${navAttr("kb", { categoryId: c.id })}><div style="font-size:28px">${esc(c.icon || "📁")}</div><div style="font-weight:600;margin-top:6px;font-size:13px">${esc(c.name)}</div><div style="font-size:11px;color:var(--gray-500)">${c._count?.articles ?? 0} บทความ</div></div>`).join("");
  const list = data.items.map((a) => `<div class="kb-card" ${navAttr("kb-article", { id: a.id })}>
    <div style="font-weight:600;font-size:14px;color:var(--primary)">${esc(a.title)} ${!a.published ? '<span class="chip amber">ฉบับร่าง</span>' : ""}</div>
    <div style="font-size:12.5px;color:var(--gray-600);margin:6px 0">${esc(a.summary || "")}</div>
    <div style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--gray-400)"><span class="chip">${esc(a.category?.name || "-")}</span><span>👁 ${a.views} ครั้ง</span>${a._count?.attachments ? `<span>📎 ${a._count.attachments} ไฟล์</span>` : ""}</div>
  </div>`).join("") || '<div class="empty">ไม่พบบทความ</div>';
  const canWrite = State.user.role !== "USER";
  return {
    title: "Knowledge Base — คลังความรู้",
    html: `<div class="filter-bar"><input class="search-input" id="kb-q" placeholder="🔍 ค้นหาบทความ วิธีแก้ปัญหา..." value="${esc(params.q || "")}">
      ${canWrite ? `<button class="btn btn-primary btn-sm" data-nav="kb-edit">+ เขียนบทความ</button>` : ""}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px">${tiles}</div>
      <div class="card"><div class="card-header"><div class="card-title">บทความ (${data.total})</div></div>
      <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${list}</div></div>`,
    after: () => { document.getElementById("kb-q").onkeydown = (e) => { if (e.key === "Enter") navigate("kb", { q: val("kb-q") }); }; },
  };
};
Pages["kb-article"] = async ({ id }) => {
  const a = await api.get("/kb/articles/" + id);
  const canWrite = State.user.role !== "USER";
  return {
    title: a.title,
    html: `<div class="card" style="max-width:820px"><div class="card-body">
      <div style="font-size:12px;color:var(--gray-500)"><span class="link clickable" data-nav="kb">← คลังความรู้</span> / ${esc(a.category?.name || "")}</div>
      <h1 style="font-size:22px;margin:10px 0">${esc(a.title)}</h1>
      <div style="display:flex;gap:8px;font-size:11.5px;color:var(--gray-400);margin-bottom:16px">${(a.tags || "").split(",").filter(Boolean).map((t) => `<span class="chip">${esc(t.trim())}</span>`).join("")} <span>👁 ${a.views} ครั้ง</span> <span>โดย ${esc(a.author?.fullName || "")}</span></div>
      <div style="font-size:14px;line-height:1.8;white-space:pre-wrap;border-top:1px solid var(--gray-200);padding-top:16px">${esc(a.body)}</div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--gray-200)">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px">
          <div style="font-size:13px;font-weight:700">ไฟล์แนบ (${(a.attachments || []).length})</div>
          ${canWrite ? `<label class="btn btn-ghost btn-sm" style="cursor:pointer">📎 แนบ PDF/รูปภาพ<input type="file" id="kb-att-file" accept="image/*,.pdf,application/pdf" multiple style="display:none"></label>` : ""}
        </div>
        <div id="kb-attachments">${kbAttachmentsHtml(a.attachments || [], canWrite, a.id)}</div>
      </div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--gray-200);font-size:13px;color:var(--gray-500)">บทความนี้ช่วยได้ไหม? <button class="btn btn-ghost btn-sm" ${callAttr("toast", "ขอบคุณสำหรับ feedback!")}>👍 ใช่</button> <button class="btn btn-ghost btn-sm" data-nav="ticket-new">👎 แจ้ง IT</button></div>
    </div></div>`,
    after: () => {
      const input = document.getElementById("kb-att-file");
      if (input) input.onchange = async () => {
        const files = [...input.files];
        if (!files.length) return;
        try {
          await kbUploadFiles(a.id, files);
          toast("แนบไฟล์แล้ว", "success");
          navigate("kb-article", { id: a.id });
        } catch (e) { toast(e.message, "error"); }
      };
    },
  };
};
Pages["kb-edit"] = async () => {
  await loadMeta();
  const cats = await api.get("/kb/categories");
  return {
    title: "เขียนบทความใหม่",
    html: `<div class="card card-narrow"><div class="card-header"><div class="card-title">📝 เขียนบทความ Knowledge Base</div></div>
      <div class="card-body"><div class="form-grid">
        <div class="form-group full"><label>หัวข้อ <span class="req">*</span></label><input id="kb-title" placeholder="เช่น วิธีตั้งค่า VPN"></div>
        <div class="form-group"><label>หมวดหมู่</label><select id="kb-cat"><option value="">— เลือก —</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
        <div class="form-group"><label>Tags (คั่นด้วย ,)</label><input id="kb-tags" placeholder="vpn, network"></div>
        <div class="form-group full"><label>สรุปย่อ</label><input id="kb-summary" placeholder="สรุป 1 บรรทัด"></div>
        <div class="form-group full"><label>เนื้อหา <span class="req">*</span></label><textarea id="kb-body" style="min-height:200px"></textarea></div>
        <div class="form-group full"><label>ไฟล์แนบ PDF / รูปภาพ</label><input type="file" id="kb-files" accept="image/*,.pdf,application/pdf" multiple><div style="font-size:11.5px;color:var(--gray-500);margin-top:4px">รองรับ PNG, JPG, GIF, WEBP, PDF ขนาดตามที่ระบบกำหนด</div></div>
        <div class="form-group full"><label style="display:flex;gap:6px;font-weight:400"><input type="checkbox" id="kb-pub" style="width:auto" checked> เผยแพร่ทันที</label></div>
      </div></div>
      <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" data-nav="kb">ยกเลิก</button><button class="btn btn-primary" id="kb-save">💾 บันทึก</button></div></div>`,
    after: () => {
      document.getElementById("kb-save").onclick = async () => {
        const body = { title: val("kb-title"), body: val("kb-body"), summary: val("kb-summary") || undefined, tags: val("kb-tags") || undefined, categoryId: val("kb-cat") ? Number(val("kb-cat")) : undefined, published: document.getElementById("kb-pub").checked };
        if (!body.title || !body.body) return toast("กรุณากรอกหัวข้อและเนื้อหา", "error");
        const files = [...document.getElementById("kb-files").files];
        try {
          const r = await api.post("/kb/articles", body);
          if (files.length) await kbUploadFiles(r.id, files);
          toast("บันทึกบทความแล้ว", "success");
          navigate("kb-article", { id: r.id });
        } catch (e) { toast(e.message, "error"); }
      };
    },
  };
};

function kbAttachmentsHtml(items, canDelete, articleId) {
  if (!items.length) return '<div class="empty" style="padding:14px">ยังไม่มีไฟล์แนบ</div>';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
    ${items.map((a) => {
      const url = `/uploads/${encodeURIComponent(a.filePath)}`;
      const isImage = (a.mimeType || "").startsWith("image/");
      return `<div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px;display:flex;gap:10px;align-items:center;min-width:0">
        <a href="${url}" target="_blank" style="width:56px;height:56px;border-radius:6px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto;text-decoration:none">
          ${isImage ? `<img src="${url}" alt="${esc(a.fileName)}" style="width:100%;height:100%;object-fit:cover">` : '<span style="font-weight:700;color:var(--danger)">PDF</span>'}
        </a>
        <div style="min-width:0;flex:1">
          <a href="${url}" target="_blank" class="link" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.fileName)}</a>
          <div style="font-size:11.5px;color:var(--gray-500)">${fmtFileSize(a.fileSize)}</div>
        </div>
        ${canDelete ? `<button class="btn btn-ghost btn-sm" ${callAttr("kbDeleteAttachment", articleId,a.id)}>ลบ</button>` : ""}
      </div>`;
    }).join("")}
  </div>`;
}

async function kbUploadFiles(articleId, files) {
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    await api.upload(`/kb/articles/${articleId}/attachments`, fd);
  }
}

async function kbDeleteAttachment(articleId, attId) {
  if (!confirm("ยืนยันลบไฟล์แนบนี้?")) return;
  try {
    await api.del(`/kb/articles/${articleId}/attachments/${attId}`);
    toast("ลบไฟล์แนบแล้ว", "success");
    navigate("kb-article", { id: articleId });
  } catch (e) { toast(e.message, "error"); }
}

// ═══════════════ SOFTWARE LICENSE ═══════════════
Pages.licenses = async () => {
  const items = await api.get("/procurement/licenses");
  const edit = canEdit();
  const rows = items.map((l) => {
    const pct = l.totalSeats ? Math.round((l.usedSeats / l.totalSeats) * 100) : 0;
    const col = pct >= 90 ? "var(--danger)" : pct >= 70 ? "var(--warning)" : "var(--success)";
    return `<tr>
      <td><div style="font-weight:500">${esc(l.name)}</div><div style="font-size:11.5px;color:var(--gray-500)">${esc(l.publisher || "")}</div></td>
      <td style="min-width:140px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${l.usedSeats}/${l.totalSeats} seats</span><span style="color:${col};font-weight:600">${pct}%</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${col}"></div></div></td>
      <td>${l.availableSeats} ว่าง</td><td style="font-size:12px">${fmtDate(l.expiry)}</td><td style="font-size:12px">${licenseBillingCell(l)}</td><td>${fmtMoney(l.cost)}</td>
      ${edit ? `<td><button class="btn btn-ghost btn-sm" ${callAttr("licenseForm", { id: l.id, name: l.name, publisher: l.publisher, licenseKey: l.licenseKey, vendorId: l.vendorId, totalSeats: l.totalSeats, expiry: toDateInputValue(l.expiry), cost: l.cost, notes: l.notes, billingCycle: l.billingCycle, nextBillingDate: toDateInputValue(l.nextBillingDate), billingAmount: l.billingAmount, remindDaysBefore: l.remindDaysBefore })}>แก้ไข</button></td>` : ""}</tr>`;
  }).join("") || `<tr><td colspan="${edit ? 7 : 6}"><div class="empty">ยังไม่มี license</div></td></tr>`;
  return {
    title: "Software License",
    html: `<div class="card"><div class="card-header"><div class="card-title">License ทั้งหมด (${items.length})</div>
      ${edit ? `<button class="btn btn-primary btn-sm" id="l-new">+ เพิ่ม License</button>` : ""}</div>
      <div class="table-wrap"><table><thead><tr><th>ซอฟต์แวร์</th><th>การใช้งาน (Seats)</th><th>คงเหลือ</th><th>หมดอายุ</th><th>ชำระถัดไป</th><th>มูลค่า</th>${edit ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div></div>`,
    after: () => { if (edit) document.getElementById("l-new").onclick = () => licenseForm(); },
  };
};
function licenseBillingCell(l) {
  if (!l.billingCycle || l.billingCycle === "NONE" || !l.nextBillingDate) return '<span class="muted">-</span>';
  const cycle = l.billingCycle === "YEARLY" ? "รายปี" : "รายเดือน";
  const ymd = new Date().toLocaleDateString("en-CA");
  const days = Math.round((new Date(String(l.nextBillingDate).slice(0, 10)) - new Date(ymd)) / 86400000);
  const soon = days <= (l.remindDaysBefore ?? 3);
  const amount = l.billingAmount != null ? ` · ${fmtMoney(l.billingAmount)}` : "";
  return `<div style="${soon ? "color:var(--danger);font-weight:600" : ""}">${fmtDate(l.nextBillingDate)}</div><div class="muted" style="font-size:11px">💳 ${cycle}${amount}${soon ? ` · อีก ${days} วัน` : ""}</div>`;
}
async function licenseForm(l) {
  const vendors = await api.get("/procurement/vendors");
  const vopts = [{ value: "", label: "— ไม่ระบุ —" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))];
  const overlay = formModal({
    title: l ? "แก้ไข License" : "เพิ่ม License",
    fields: [
      { key: "name", label: "ชื่อซอฟต์แวร์", req: true, full: true },
      { key: "publisher", label: "ผู้ผลิต" },
      { key: "vendorId", label: "ผู้จำหน่าย", type: "select", options: vopts },
      { key: "totalSeats", label: "จำนวน Seats", type: "number", req: true },
      { key: "licenseKey", label: "License Key", full: true },
      { key: "expiry", label: "วันหมดอายุ", type: "date" },
      { key: "cost", label: "มูลค่า (บาท)", type: "number" },
      { key: "billingCycle", label: "รอบชำระเงิน", type: "select", options: [{ value: "NONE", label: "— ไม่แจ้งเตือน —" }, { value: "MONTHLY", label: "รายเดือน" }, { value: "YEARLY", label: "รายปี" }], default: "NONE" },
      { key: "nextBillingDate", label: "วันชำระครั้งถัดไป", type: "date" },
      { key: "billingAmount", label: "ยอดชำระต่อรอบ (บาท)", type: "number" },
      { key: "remindDaysBefore", label: "แจ้งเตือนล่วงหน้า (วัน)", type: "number", default: 3 },
      { key: "notes", label: "หมายเหตุ", type: "textarea" },
    ],
    values: l || {},
    onSubmit: async (data) => {
      if (l) await api.patch("/procurement/licenses/" + l.id, data);
      else await api.post("/procurement/licenses", data);
      toast("บันทึก License แล้ว", "success"); navigate("licenses");
    },
  });
  if (l) {
    const footer = overlay.querySelector("#fm-cancel")?.parentElement;
    if (footer) {
      const del = document.createElement("button");
      del.className = "btn btn-danger";
      del.style.marginRight = "auto";
      del.textContent = "ลบ";
      del.onclick = async () => {
        const ok = await licenseDelete(l.id, l.name);
        if (ok) overlay.remove();
      };
      footer.prepend(del);
    }
  }
}

async function licenseDelete(id, name) {
  if (!confirm(`ยืนยันลบ License "${name || id}"?\nข้อมูลนี้จะถูกลบออกจากฐานข้อมูลจริง`)) return false;
  try {
    await api.del("/procurement/licenses/" + id);
    toast("ลบ License แล้ว", "success");
    navigate("licenses");
    return true;
  } catch (e) {
    toast(e.message, "error");
    return false;
  }
}

// ═══════════════ VENDORS ═══════════════
const VENDOR_FIELDS = [
  { key: "name", label: "ชื่อบริษัท", req: true, full: true },
  { key: "contactName", label: "ผู้ติดต่อ" },
  { key: "phone", label: "โทรศัพท์" },
  { key: "email", label: "อีเมล" },
  { key: "taxId", label: "เลขผู้เสียภาษี" },
  { key: "address", label: "ที่อยู่", type: "textarea" },
  { key: "notes", label: "หมายเหตุ", type: "textarea" },
];
const canEdit = () => ["ADMIN", "AGENT"].includes(State.user.role);
Pages.vendors = async () => {
  const items = await api.get("/procurement/vendors");
  const edit = canEdit();
  const rows = items.map((v) => `<tr>
    <td style="font-weight:500">${esc(v.name)}</td><td>${esc(v.contactName || "—")}</td><td style="font-size:12px">${esc(v.phone || "—")}</td><td style="font-size:12px">${esc(v.email || "—")}</td>
    <td><span class="chip blue">${v._count?.assets ?? 0} assets</span></td><td><span class="chip">${v._count?.contracts ?? 0} สัญญา</span></td>
    ${edit ? `<td><button class="btn btn-ghost btn-sm" ${callAttr("vendorForm", v)}>แก้ไข</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="${edit ? 7 : 6}"><div class="empty">ยังไม่มีผู้จำหน่าย</div></td></tr>`;
  return {
    title: "ผู้จำหน่าย (Vendors)",
    html: `<div class="card"><div class="card-header"><div class="card-title">ผู้จำหน่ายทั้งหมด (${items.length})</div>
      ${edit ? `<button class="btn btn-primary btn-sm" id="v-new">+ เพิ่มผู้จำหน่าย</button>` : ""}</div>
      <div class="table-wrap"><table><thead><tr><th>ชื่อบริษัท</th><th>ผู้ติดต่อ</th><th>โทรศัพท์</th><th>อีเมล</th><th>ทรัพย์สิน</th><th>สัญญา</th>${edit ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div></div>`,
    after: () => { if (edit) document.getElementById("v-new").onclick = () => vendorForm(); },
  };
};
function vendorForm(v) {
  formModal({
    title: v ? "แก้ไขผู้จำหน่าย" : "เพิ่มผู้จำหน่าย", fields: VENDOR_FIELDS, values: v || {},
    onSubmit: async (data) => {
      if (v) await api.patch("/procurement/vendors/" + v.id, data);
      else await api.post("/procurement/vendors", data);
      toast("บันทึกผู้จำหน่ายแล้ว", "success"); navigate("vendors");
    },
  });
}

// ═══════════════ CONTRACTS ═══════════════
const CONTRACT_TYPE = { WARRANTY: "ประกัน", MAINTENANCE: "สัญญา MA", SUBSCRIPTION: "Subscription", LEASE: "เช่า", SUPPORT: "Support" };
Pages.contracts = async () => {
  const items = await api.get("/procurement/contracts");
  const edit = canEdit();
  const rows = items.map((c) => `<tr>
    <td class="link">${esc(c.contractNo)}</td><td>${esc(c.name)}</td><td><span class="chip">${CONTRACT_TYPE[c.type] || c.type}</span></td>
    <td>${esc(c.vendor?.name || "—")}</td><td style="font-size:12px;color:var(--warning);font-weight:600">${fmtDate(c.endDate)}</td><td>${fmtMoney(c.value)}</td>
    ${edit ? `<td><button class="btn btn-ghost btn-sm" ${callAttr("contractForm", { id: c.id, contractNo: c.contractNo, name: c.name, type: c.type, vendorId: c.vendorId, startDate: toDateInputValue(c.startDate), endDate: toDateInputValue(c.endDate), value: c.value, autoRenew: c.autoRenew, notes: c.notes })}>แก้ไข</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="${edit ? 7 : 6}"><div class="empty">ยังไม่มีสัญญา</div></td></tr>`;
  return {
    title: "สัญญา / ประกัน (Contracts)",
    html: `<div class="card"><div class="card-header"><div class="card-title">สัญญาทั้งหมด (${items.length})</div>
      ${edit ? `<button class="btn btn-primary btn-sm" id="c-new">+ เพิ่มสัญญา</button>` : ""}</div>
      <div class="table-wrap"><table><thead><tr><th>เลขที่สัญญา</th><th>ชื่อสัญญา</th><th>ประเภท</th><th>ผู้จำหน่าย</th><th>สิ้นสุด</th><th>มูลค่า</th>${edit ? "<th></th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div></div>`,
    after: () => { if (edit) document.getElementById("c-new").onclick = () => contractForm(); },
  };
};
async function contractForm(c) {
  const vendors = await api.get("/procurement/vendors");
  const vopts = [{ value: "", label: "— ไม่ระบุ —" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))];
  const topts = Object.entries(CONTRACT_TYPE).map(([k, v]) => ({ value: k, label: v }));
  formModal({
    title: c ? "แก้ไขสัญญา" : "เพิ่มสัญญา",
    fields: [
      { key: "contractNo", label: "เลขที่สัญญา", req: true },
      { key: "name", label: "ชื่อสัญญา", req: true },
      { key: "type", label: "ประเภท", type: "select", req: true, options: topts },
      { key: "vendorId", label: "ผู้จำหน่าย", type: "select", options: vopts },
      { key: "startDate", label: "วันเริ่ม", type: "date", req: true },
      { key: "endDate", label: "วันสิ้นสุด", type: "date", req: true },
      { key: "value", label: "มูลค่า (บาท)", type: "number" },
      { key: "autoRenew", label: "ต่ออายุอัตโนมัติ", type: "checkbox" },
      { key: "notes", label: "หมายเหตุ", type: "textarea" },
    ],
    values: c || {},
    onSubmit: async (data) => {
      if (c) await api.patch("/procurement/contracts/" + c.id, data);
      else await api.post("/procurement/contracts", data);
      toast("บันทึกสัญญาแล้ว", "success"); navigate("contracts");
    },
  });
}

// ═══════════════ REPORTS ═══════════════
Pages.reports = async () => {
  const d = await api.get("/reports/summary");
  // ทุกกราฟในหน้านี้เป็นชุดข้อมูลเดียว (จำนวนงาน) จึงใช้สีเดียวกันทั้งหมด
  // เดิมกำหนดสีต่างกันต่อการ์ด ทำให้ดูเหมือนสีมีความหมาย ทั้งที่ไม่มี
  const bar = (rows) => {
    const total = rows.reduce((s, r) => s + r.count, 0) || 1;
    return rows.map((r) => { const p = Math.round((r.count / total) * 100); return `<div class="bar-row"><div class="bar-head"><span>${esc(r.key)}</span><span class="v">${r.count} <span style="color:var(--gray-400);font-weight:500">(${p}%)</span></span></div><div class="bar-track"><div class="bar-fill" style="width:${p}%"></div></div></div>`; }).join("") || '<div class="empty">ไม่มีข้อมูล</div>';
  };
  return {
    title: "รายงาน & วิเคราะห์",
    html: `<div class="filter-bar">
        <a class="btn btn-ghost btn-sm" href="/api/reports/tickets.csv">📥 Export Ticket (CSV)</a>
        <a class="btn btn-ghost btn-sm" href="/api/reports/assets.csv">📥 Export Asset (CSV)</a>
      </div>
      <div class="kpi-grid">
        ${kpiCard("blue", "🎫", d.total, "Ticket ทั้งหมด")}
        ${kpiCard("green", "🎯", d.slaCompliance + "%", "SLA แก้ไขเสร็จ")}
        ${kpiCard("red", "⏱️", d.responseCompliance == null ? "—" : d.responseCompliance + "%", `SLA ตอบรับ (${d.responseMeasured ?? 0} งาน)`)}
        ${kpiCard("yellow", "⭐", d.satisfactionAvg ?? "—", `คะแนนพึงพอใจเฉลี่ย (${d.satisfactionCount} รีวิว)`)}
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">📊 แยกตามประเภท</div></div><div class="card-body">${bar(d.byType.map((r) => ({ key: r.key === "INCIDENT" ? "🔧 แจ้งซ่อม" : "🛒 คำขอบริการ", count: r.count })))}</div></div>
        <div class="card"><div class="card-header"><div class="card-title">👷 ภาระงานเจ้าหน้าที่</div></div><div class="card-body">${bar(d.byAgent)}</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">🏷️ แยกตามหมวดหมู่</div></div><div class="card-body">${bar(d.byCategory)}</div></div>
        <div class="card"><div class="card-header"><div class="card-title">⬆ แยกตามความสำคัญ</div></div><div class="card-body">${bar(d.byPriority.map((r) => ({ key: PRIORITY[r.key] || r.key, count: r.count })))}</div></div>
      </div>`,
  };
};

// ═══════════════ MY ACCOUNT (เปลี่ยนรหัส + 2FA) ═══════════════
Pages.account = async () => {
  const me = await api.get("/auth/me");
  const u = me.user;
  const on = u.totpEnabled;
  return {
    title: "บัญชีของฉัน",
    html: `<div class="grid-2">
      <div class="card"><div class="card-header"><div class="card-title">🔑 เปลี่ยนรหัสผ่าน</div></div>
        <div class="card-body">
          <div class="form-group full"><label>รหัสผ่านปัจจุบัน</label><input type="password" id="cp-cur"></div>
          <div class="form-group full"><label>รหัสผ่านใหม่</label><input type="password" id="cp-new"></div>
          <div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">อย่างน้อย 8 ตัว มีพิมพ์ใหญ่ พิมพ์เล็ก และตัวเลข</div>
          <button class="btn btn-primary btn-sm" id="cp-save">บันทึกรหัสผ่าน</button>
        </div></div>
      <div class="card"><div class="card-header"><div class="card-title">🔐 ยืนยันตัวตน 2 ชั้น (2FA)</div>
        <span class="chip ${on ? "green" : ""}">${on ? "เปิดใช้งาน" : "ปิดอยู่"}</span></div>
        <div class="card-body" id="tfa-body">
          ${on
            ? `<div style="color:var(--gray-500);font-size:13px;margin-bottom:12px">บัญชีของคุณได้รับการป้องกันด้วยรหัสยืนยัน 2 ชั้น</div>
               <div class="form-group full"><label>รหัส 6 หลักจากแอป (เพื่อปิด)</label><input type="text" id="tfa-token" maxlength="6" inputmode="numeric" placeholder="123456"></div>
               <button class="btn btn-ghost btn-sm" id="tfa-disable">ปิด 2FA</button>`
            : `<div style="color:var(--gray-500);font-size:13px;margin-bottom:12px">เพิ่มความปลอดภัยด้วยแอป Authenticator (Google/Microsoft Authenticator)</div>
               <button class="btn btn-primary btn-sm" id="tfa-setup">เริ่มตั้งค่า 2FA</button>`}
        </div></div>
      ${u.role === "ADMIN" ? "" : telegramChatCard(u)}
      <div class="card"><div class="card-header"><div class="card-title">📧 แจ้งเตือนผ่าน Email</div>
        <span class="chip ${u.emailNotify ? "green" : ""}">${u.emailNotify ? "เปิดใช้งาน" : "ปิดอยู่"}</span></div>
        <div class="card-body">
          <div style="font-size:13px;color:var(--gray-500);margin-bottom:10px">รับแจ้งเตือน ticket/อนุมัติ เข้าอีเมล <b>${esc(u.email)}</b></div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" id="em-toggle">${u.emailNotify ? "ปิดการแจ้งเตือน" : "เปิดการแจ้งเตือน"}</button>
            <button class="btn btn-ghost btn-sm" id="em-test">ส่งอีเมลทดสอบ</button>
          </div>
        </div></div>
    </div>`,
    after: () => {
      document.getElementById("cp-save").onclick = async () => {
        try {
          await api.post("/auth/change-password", { currentPassword: val("cp-cur"), newPassword: val("cp-new") });
          toast("เปลี่ยนรหัสผ่านแล้ว", "success");
          document.getElementById("cp-cur").value = ""; document.getElementById("cp-new").value = "";
        } catch (e) { toast(e.details ? e.details.map((d) => d.message).join(", ") : e.message, "error"); }
      };
      const setup = document.getElementById("tfa-setup");
      if (setup) setup.onclick = async () => {
        try {
          const { secret, otpauth } = await api.post("/auth/2fa/setup", {});
          const body = document.getElementById("tfa-body");
          body.innerHTML = `<div style="font-size:13px;margin-bottom:8px">1. เพิ่มในแอป Authenticator โดยพิมพ์ key นี้ (หรือสแกน):</div>
            <div style="font-family:var(--font-mono);font-size:15px;font-weight:700;background:var(--gray-50);padding:10px;border-radius:8px;text-align:center;letter-spacing:2px;margin-bottom:6px;word-break:break-all">${esc(secret)}</div>
            <div style="font-size:11px;color:var(--gray-400);margin-bottom:12px;word-break:break-all">${esc(otpauth)}</div>
            <div class="form-group full"><label>2. กรอกรหัส 6 หลักเพื่อยืนยัน</label><input type="text" id="tfa-token" maxlength="6" inputmode="numeric" placeholder="123456"></div>
            <button class="btn btn-primary btn-sm" id="tfa-enable">ยืนยันเปิดใช้งาน</button>`;
          document.getElementById("tfa-enable").onclick = async () => {
            try { await api.post("/auth/2fa/enable", { token: val("tfa-token") }); toast("เปิด 2FA แล้ว", "success"); navigate("account"); }
            catch (e) { toast(e.message, "error"); }
          };
        } catch (e) { toast(e.message, "error"); }
      };
      const dis = document.getElementById("tfa-disable");
      if (dis) dis.onclick = async () => {
        try { await api.post("/auth/2fa/disable", { token: val("tfa-token") }); toast("ปิด 2FA แล้ว", "success"); navigate("account"); }
        catch (e) { toast(e.message, "error"); }
      };
      bindTelegramChat("account");
      document.getElementById("em-toggle").onclick = async () => {
        try { await api.post("/auth/email-notify", { enabled: !u.emailNotify }); toast("บันทึกการตั้งค่าแล้ว", "success"); navigate("account"); }
        catch (e) { toast(e.message, "error"); }
      };
      document.getElementById("em-test").onclick = async () => {
        try { await api.post("/auth/email-notify/test", {}); toast("ส่งอีเมลทดสอบแล้ว — เช็คอีเมลของคุณ", "success"); }
        catch (e) { toast(e.message, "error"); }
      };
    },
  };
};

// ผูก Telegram Chat ID ของผู้ใช้เอง — ใช้ร่วมกันระหว่างหน้า "บัญชีของฉัน" (ผู้ใช้ทั่วไป) และ "ตั้งค่าระบบ" (ADMIN)
function telegramChatInputs(u) {
  return `<div style="font-size:13px;color:var(--gray-500);margin-bottom:10px">รับแจ้งเตือน ticket/อนุมัติ เข้า Telegram ของคุณ<br>
      วิธีหา Chat ID: เปิด Telegram ค้นหา <b>@userinfobot</b> แล้วกด Start → คัดลอกเลข Id มาวาง (กลุ่มจะขึ้นต้นด้วย - และต้องเพิ่มบอทเข้ากลุ่มก่อน)</div>
    <div class="form-group full"><label>Telegram Chat ID ของคุณ</label><input type="text" id="tg-chat" value="${esc(u.telegramChatId || "")}" placeholder="เช่น 123456789"></div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary btn-sm" id="tg-chat-save">บันทึก Chat ID</button>
      <button class="btn btn-ghost btn-sm" id="tg-test">ส่งข้อความทดสอบ</button>
    </div>`;
}
function telegramChatCard(u) {
  return `<div class="card"><div class="card-header"><div class="card-title">📲 แจ้งเตือนผ่าน Telegram</div>
    <span class="chip ${u.telegramChatId ? "green" : ""}">${u.telegramChatId ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อม"}</span></div>
    <div class="card-body">${telegramChatInputs(u)}</div></div>`;
}
function bindTelegramChat(page) {
  // ADMIN ไม่มีการ์ดนี้ในหน้า "บัญชีของฉัน" (ย้ายไปอยู่หน้าตั้งค่าระบบ)
  if (!document.getElementById("tg-chat-save")) return;
  document.getElementById("tg-chat-save").onclick = async () => {
    try { const r = await api.post("/auth/telegram", { chatId: val("tg-chat") }); toast(r.linked ? "เชื่อม Telegram แล้ว" : "ยกเลิกการเชื่อมแล้ว", "success"); navigate(page); }
    catch (e) { toast(e.message, "error"); }
  };
  document.getElementById("tg-test").onclick = async () => {
    try { await api.post("/auth/telegram/test", {}); toast("ส่งข้อความทดสอบแล้ว — เช็ค Telegram", "success"); }
    catch (e) { toast(e.message, "error"); }
  };
}

// ═══════════════ SLA POLICY (ในหน้าตั้งค่า) ═══════════════
const SLA_PRIO_DOT = { CRITICAL: "red", HIGH: "orange", MEDIUM: "yellow", LOW: "green" };
// นาทีทำการ → ข้อความ เช่น 90 → "1 ชม. 30 นาที"
function fmtWorkMinutes(m) {
  const h = Math.floor(m / 60), r = m % 60;
  return [h ? `${h} ชม.` : "", r ? `${r} นาที` : ""].filter(Boolean).join(" ") || "0 นาที";
}
function slaPolicyCard(data, canAdmin) {
  const prio = (p) => `<span class="priority-dot ${SLA_PRIO_DOT[p]}"></span>${esc(PRIORITY[p] || p)}`;
  const cell = (r, key) => canAdmin
    ? `<input type="number" min="1" step="1" class="sla-min" style="width:90px" data-key="${key}" value="${r[key]}"> <span class="muted" style="font-size:11px">${fmtWorkMinutes(r[key])}</span>`
    : fmtWorkMinutes(r[key]);
  const row = (r, isDefault) => `<tr data-sla-row data-category="${r.categoryId ?? ""}" data-priority="${r.priority}">
      ${isDefault ? "" : `<td>${esc(r.category?.icon || "")} ${esc(r.category?.name || "")}</td>`}
      <td>${prio(r.priority)}</td><td>${cell(r, "responseMinutes")}</td><td>${cell(r, "resolveMinutes")}</td>
      ${canAdmin ? `<td style="white-space:nowrap"><button class="btn btn-primary btn-sm sla-save">บันทึก</button>${isDefault ? "" : ` <button class="btn btn-ghost btn-sm sla-del" data-id="${r.id}">ลบ</button>`}</td>` : ""}
    </tr>`;
  const overrides = data.overrides.length
    ? `<div class="table-wrap"><table><thead><tr><th>หมวดหมู่</th><th>ความสำคัญ</th><th>ตอบรับ (นาที)</th><th>แก้ไขเสร็จ (นาที)</th>${canAdmin ? "<th></th>" : ""}</tr></thead>
        <tbody>${data.overrides.map((r) => row(r, false)).join("")}</tbody></table></div>`
    : '<div class="empty" style="padding:12px">ยังไม่มี — ทุกหมวดใช้ค่าเริ่มต้นด้านบน</div>';
  const addForm = canAdmin ? `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:12px 16px;border-top:1px solid var(--gray-100)">
      <select id="sla-new-cat" class="filter"><option value="">— หมวดหมู่ —</option>${META.categories.map((c) => `<option value="${c.id}">${esc(c.icon || "")} ${esc(c.name)}</option>`).join("")}</select>
      <select id="sla-new-prio" class="filter">${Object.keys(SLA_PRIO_DOT).map((p) => `<option value="${p}">${esc(PRIORITY[p])}</option>`).join("")}</select>
      <input id="sla-new-resp" type="number" min="1" placeholder="ตอบรับ (นาที)" style="width:120px">
      <input id="sla-new-res" type="number" min="1" placeholder="แก้ไข (นาที)" style="width:120px">
      <button class="btn btn-primary btn-sm" id="sla-add">+ เพิ่ม</button></div>` : "";
  return `<div class="card">
    <div class="card-header"><div class="card-title">⏱️ SLA Policy</div></div>
    <div style="font-size:12px;color:var(--gray-500);padding:10px 16px 0">นับเป็นนาทีในเวลาทำการ · มีผลกับ Ticket ที่สร้างหรือเปลี่ยนความสำคัญหลังบันทึก</div>
    <div class="table-wrap"><table><thead><tr><th>ความสำคัญ (ค่าเริ่มต้น)</th><th>ตอบรับ</th><th>แก้ไขเสร็จ</th>${canAdmin ? "<th></th>" : ""}</tr></thead>
      <tbody>${data.defaults.map((r) => row(r, true)).join("")}</tbody></table></div>
    <div style="font-weight:600;font-size:13px;padding:14px 16px 4px">กำหนดเฉพาะหมวดหมู่</div>
    ${overrides}${addForm}
  </div>`;
}
function bindSlaPolicyCard() {
  const save = async (body) => {
    await api.put("/admin/sla-policies", body);
    toast("บันทึก SLA แล้ว", "success");
    navigate("settings", {}, { history: "replace" });
  };
  document.querySelectorAll("[data-sla-row] .sla-save").forEach((btn) => {
    btn.onclick = async () => {
      const tr = btn.closest("[data-sla-row]");
      const num = (k) => Number(tr.querySelector(`[data-key="${k}"]`).value);
      btn.disabled = true;
      try {
        await save({ categoryId: tr.dataset.category ? Number(tr.dataset.category) : null, priority: tr.dataset.priority, responseMinutes: num("responseMinutes"), resolveMinutes: num("resolveMinutes") });
      } catch (e) { toast(e.message, "error"); btn.disabled = false; }
    };
  });
  document.querySelectorAll(".sla-del").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("ลบ SLA เฉพาะหมวดนี้? หมวดนี้จะกลับไปใช้ค่าเริ่มต้น")) return;
      try { await api.del("/admin/sla-policies/" + btn.dataset.id); toast("ลบแล้ว", "success"); navigate("settings", {}, { history: "replace" }); }
      catch (e) { toast(e.message, "error"); }
    };
  });
  const add = document.getElementById("sla-add");
  if (add) add.onclick = async () => {
    if (!val("sla-new-cat")) return toast("กรุณาเลือกหมวดหมู่", "error");
    try {
      await save({ categoryId: Number(val("sla-new-cat")), priority: val("sla-new-prio"), responseMinutes: Number(val("sla-new-resp")), resolveMinutes: Number(val("sla-new-res")) });
    } catch (e) { toast(e.message, "error"); }
  };
}

// ═══════════════ SETTINGS ═══════════════
Pages.settings = async () => {
  await loadMeta();
  const [hours, locations, departments, slaData] = await Promise.all([api.get("/admin/business-hours"), api.get("/admin/locations"), api.get("/admin/departments"), api.get("/admin/sla-policies")]);
  const canAdmin = State.user.role === "ADMIN";
  const slaCard = slaPolicyCard(slaData, canAdmin);
  const departmentRows = departments.map((d) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px">
      <span>🏢 ${esc(d.name)}</span>
      <span style="display:flex;align-items:center;gap:6px">
        <span class="chip">${d._count?.users ?? 0} users</span>
        <span class="chip">${d._count?.assets ?? 0} assets</span>
        ${canAdmin ? `<button class="btn btn-ghost btn-sm dept-edit" data-id="${d.id}" data-name="${esc(d.name)}">แก้ไข</button>
        <button class="btn btn-ghost btn-sm dept-del" data-id="${d.id}" data-name="${esc(d.name)}">ลบ</button>` : ""}
      </span>
    </div>`).join("") || '<div class="empty">ยังไม่มีแผนก</div>';

  let tgCard = "";
  if (canAdmin) {
    const [tg, me] = await Promise.all([api.get("/admin/telegram-config"), api.get("/auth/me")]);
    const srcLabel = { web: "ตั้งจากเมนูนี้", env: "ตั้งจากไฟล์ .env", none: "ยังไม่ได้ตั้งค่า" }[tg.source];
    tgCard = `<div class="card">
      <div class="card-header"><div class="card-title">📲 Telegram Bot</div>
        <span class="chip ${tg.enabled && tg.tokenSet ? "green" : ""}">${tg.enabled && tg.tokenSet ? "เปิดใช้งาน" : "ปิดอยู่"}</span></div>
      <div class="card-body">
        <div style="font-size:13px;color:var(--gray-500);margin-bottom:10px">Token จาก @BotFather — เก็บแบบเข้ารหัสในฐานข้อมูล มีผลทันทีโดยไม่ต้องรีสตาร์ท<br>
          สถานะ token: ${tg.tokenSet ? `<b>${esc(tg.tokenHint)}</b> (${srcLabel})` : srcLabel}</div>
        <div class="form-group full"><label>Bot Token ใหม่</label><input type="password" id="tg-token" autocomplete="off" placeholder="${tg.tokenSet ? "เว้นว่างไว้ = ไม่เปลี่ยน token" : "123456789:AAH..."}"></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:10px 0"><input type="checkbox" id="tg-enabled" ${tg.enabled ? "checked" : ""}> เปิดการแจ้งเตือนผ่าน Telegram</label>
        <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="tg-save">💾 บันทึก</button>
          ${tg.source === "web" ? '<button class="btn btn-ghost btn-sm" id="tg-clear">ลบ token ที่ตั้งจากเมนูนี้</button>' : ""}</div>
        <hr style="border:0;border-top:1px solid var(--gray-200);margin:16px 0">
        ${telegramChatInputs(me.user)}
      </div></div>`;
  }

  let rbacCard = "";
  let rbacData = null;
  if (canAdmin) {
    rbacData = await api.get("/rbac/matrix");
    const ROLE_LABEL = { MANAGER: "หัวหน้างาน", AGENT: "เจ้าหน้าที่ IT", USER: "ผู้ใช้ทั่วไป" };
    rbacCard = `<div class="card">
      <div class="card-header"><div class="card-title">🔐 จัดการสิทธิ์เมนู (RBAC)</div></div>
      <div class="card-body">
        <div style="font-size:13px;color:var(--gray-500);margin-bottom:10px">เลือกเมนูที่แต่ละบทบาทสามารถเข้าถึงได้ — ADMIN เข้าถึงได้ทุกเมนูเสมอ</div>
        <div class="table-wrap"><table><thead><tr><th>เมนู</th>${rbacData.roles.map((r) => `<th style="text-align:center">${esc(ROLE_LABEL[r] || r)}</th>`).join("")}</tr></thead>
          <tbody>${rbacData.items.map((m) => `<tr><td>${esc(m.label)}</td>${rbacData.roles.map((r) => `<td style="text-align:center"><input type="checkbox" data-rbac-key="${m.key}" data-rbac-role="${r}" ${m.roles[r] ? "checked" : ""}></td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
        <div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="rbac-save">💾 บันทึกสิทธิ์</button></div>
      </div></div>`;
  }

  return {
    title: "ตั้งค่าระบบ",
    html: `<div class="grid-2">
      ${slaCard}
      <div class="card"><div class="card-header"><div class="card-title">🕐 เวลาทำการ</div></div><div class="table-wrap"><table><thead><tr><th>วัน</th><th>สถานะ</th><th>เวลา</th></tr></thead><tbody>${hours.map((h) => `<tr><td>${esc(h.dayName)}</td><td>${h.isWorking ? '<span class="chip green">ทำการ</span>' : '<span class="chip">หยุด</span>'}</td><td>${h.isWorking ? `${h.startTime} - ${h.endTime}` : "—"}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="card"><div class="card-header"><div class="card-title">🏷️ หมวดหมู่ปัญหา</div></div><div class="card-body" style="display:flex;flex-wrap:wrap;gap:8px">${META.categories.map((c) => `<span class="chip blue">${esc(c.icon || "")} ${esc(c.name)}</span>`).join("")}</div></div>
      <div class="card"><div class="card-header"><div class="card-title">📍 สถานที่ / สาขา</div></div><div class="card-body" style="display:flex;flex-direction:column;gap:8px">${locations.map((l) => `<div style="display:flex;justify-content:space-between;font-size:13px"><span>📍 ${esc(l.name)}</span><span class="chip">${l._count?.assets ?? 0} assets</span></div>`).join("") || '<div class="empty">ยังไม่มีสถานที่</div>'}</div></div>
      <div class="card">
        <div class="card-header"><div class="card-title">🏢 แผนก</div>${canAdmin ? '<button class="btn btn-primary btn-sm" id="dept-add">+ เพิ่มแผนก</button>' : ""}</div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px">${departmentRows}</div>
      </div>
      ${tgCard}
      ${rbacCard}
    </div>`,
    after: () => {
      if (canAdmin) bindSlaPolicyCard();
      const tgSave = document.getElementById("tg-save");
      if (tgSave) {
        bindTelegramChat("settings");
        tgSave.onclick = async () => {
          const body = { enabled: document.getElementById("tg-enabled").checked };
          const token = val("tg-token");
          if (token) body.token = token;
          try {
            const r = await submitBtn("tg-save", () => api.put("/admin/telegram-config", body));
            toast(r.botUsername ? `บันทึกแล้ว — เชื่อมกับบอท @${r.botUsername}` : "บันทึกการตั้งค่า Telegram แล้ว", "success");
            navigate("settings");
          } catch (e) { toast(e.message, "error"); }
        };
        const tgClear = document.getElementById("tg-clear");
        if (tgClear) tgClear.onclick = async () => {
          if (!confirm("ลบ token ที่ตั้งจากเมนูนี้? (ระบบจะกลับไปใช้ค่าใน .env ถ้ามี)")) return;
          try { await api.put("/admin/telegram-config", { token: "" }); toast("ลบ token แล้ว", "success"); navigate("settings"); }
          catch (e) { toast(e.message, "error"); }
        };
      }
      const openDeptForm = (dept = null) => {
        const overlay = modal(`
          <div class="card-header"><div class="card-title">${dept ? "แก้ไขแผนก" : "เพิ่มแผนก"}</div></div>
          <div class="card-body">
            <div class="form-group"><label>ชื่อแผนก <span class="req">*</span></label><input id="dept-name" value="${esc(dept?.name || "")}" placeholder="เช่น HR, IT, บัญชี/การเงิน"></div>
          </div>
          <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
            <button class="btn btn-ghost" id="dept-cancel">ยกเลิก</button>
            <button class="btn btn-primary" id="dept-save">บันทึก</button>
          </div>`);
        document.getElementById("dept-cancel").onclick = () => overlay.remove();
        document.getElementById("dept-save").onclick = async () => {
          const name = val("dept-name");
          if (!name) return toast("กรุณากรอกชื่อแผนก", "error");
          try {
            if (dept) await api.patch("/admin/departments/" + dept.id, { name });
            else await api.post("/admin/departments", { name });
            META = EMPTY_META();
            toast("บันทึกแผนกแล้ว", "success");
            overlay.remove();
            navigate("settings");
          } catch (e) { toast(e.message, "error"); }
        };
      };
      const addDept = document.getElementById("dept-add");
      if (addDept) addDept.onclick = () => openDeptForm();
      document.querySelectorAll(".dept-edit").forEach((btn) => {
        btn.onclick = () => openDeptForm({ id: btn.dataset.id, name: btn.dataset.name });
      });
      document.querySelectorAll(".dept-del").forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm(`ลบแผนก "${btn.dataset.name}" ?`)) return;
          try {
            await api.del("/admin/departments/" + btn.dataset.id);
            META = EMPTY_META();
            toast("ลบแผนกแล้ว", "success");
            navigate("settings");
          } catch (e) { toast(e.message, "error"); }
        };
      });
      const btn = document.getElementById("rbac-save");
      if (!btn) return;
      btn.onclick = async () => {
        const changes = [];
        document.querySelectorAll("[data-rbac-key]").forEach((el) => {
          changes.push({ role: el.dataset.rbacRole, menuKey: el.dataset.rbacKey, allowed: el.checked });
        });
        try {
          await submitBtn("rbac-save", () => api.put("/rbac/matrix", { changes }));
          toast("บันทึกสิทธิ์เรียบร้อย", "success");
        } catch (e) { toast(e.message, "error"); }
      };
    },
  };
};

// ═══════════════ AUDIT LOG ═══════════════
Pages.audit = async (params = {}) => {
  const query = {
    page: params.page || 1,
    pageSize: 20,
    q: params.q || "",
    action: params.action || "",
    entityType: params.entityType || "",
    dateFrom: params.dateFrom || "",
    dateTo: params.dateTo || "",
  };
  const data = await api.get("/admin/audit" + qs(query));
  const rows = data.items.map((a) => `<tr>
    <td style="font-size:12px;color:var(--gray-500);white-space:nowrap">${fmtThaiDateTime(a.createdAt)}</td>
    <td>${esc(a.user?.fullName || "ระบบ")}</td>
    <td><span class="chip">${esc(auditActionLabel(a.action))}</span></td>
    <td>${esc(auditDescription(a))}</td>
    <td style="font-family:var(--font-mono);font-size:12px;color:var(--gray-500)">${esc(a.ipAddress || "—")}</td>
    <td><button class="btn btn-ghost btn-sm audit-detail-btn" data-id="${a.id}">รายละเอียด</button></td>
  </tr>`).join("") || '<tr><td colspan="6"><div class="empty">ไม่พบ Log ตามเงื่อนไข</div></td></tr>';
  return {
    title: "Audit Log — บันทึกการใช้งาน",
    html: `<div class="filter-bar">
        <input class="search-input" id="audit-q" placeholder="ค้นหา ผู้ใช้, action, IP, รายละเอียด..." value="${esc(query.q)}">
        <input class="filter" type="date" id="audit-from" value="${esc(query.dateFrom)}">
        <input class="filter" type="date" id="audit-to" value="${esc(query.dateTo)}">
        <input class="filter" id="audit-action" placeholder="Action เช่น DELETE_ASSET" value="${esc(query.action)}">
        <select class="filter" id="audit-entity">
          <option value="">ทุกประเภท</option>
          ${["Asset", "User", "Ticket", "Team", "RolePermission", "Problem", "Change", "KbArticle", "Vendor"].map((x) => `<option value="${x}" ${query.entityType === x ? "selected" : ""}>${x}</option>`).join("")}
        </select>
        <button class="btn btn-primary btn-sm" id="audit-apply">ค้นหา</button>
        <button class="btn btn-ghost btn-sm" id="audit-clear">ล้าง</button>
        <button class="btn btn-ghost btn-sm" id="audit-export">Export CSV</button>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">บันทึกการใช้งาน (${data.total}) <span style="font-weight:400;color:var(--gray-500)">แสดงหน้า ${data.page} ครั้งละ ${data.pageSize} รายการ</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>ใครทำอะไร</th><th>IP</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      ${pagination(data, "audit", query)}</div>`,
    after: () => {
      const readQuery = () => ({
        q: val("audit-q"),
        dateFrom: val("audit-from"),
        dateTo: val("audit-to"),
        action: val("audit-action"),
        entityType: val("audit-entity"),
        page: 1,
      });
      document.getElementById("audit-apply").onclick = () => navigate("audit", readQuery());
      document.getElementById("audit-clear").onclick = () => navigate("audit");
      document.getElementById("audit-export").onclick = () => {
        const exportQuery = { ...query };
        delete exportQuery.page;
        delete exportQuery.pageSize;
        window.location.href = "/api/admin/audit/export" + qs(exportQuery);
      };
      ["audit-q", "audit-action"].forEach((id) => {
        document.getElementById(id).onkeydown = (e) => { if (e.key === "Enter") navigate("audit", readQuery()); };
      });
      document.querySelectorAll(".audit-detail-btn").forEach((btn) => {
        btn.onclick = () => auditDetailModal(data.items.find((a) => a.id === Number(btn.dataset.id)));
      });
    },
  };
};

// ─────── helpers ───────
function fmtThaiDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  });
}

const AUDIT_ACTION_LABEL = {
  LOGIN: "เข้าสู่ระบบ",
  LOGIN_FAILED: "เข้าสู่ระบบไม่สำเร็จ",
  SELF_REGISTER: "ลงทะเบียนเอง",
  CHANGE_PASSWORD: "เปลี่ยนรหัสผ่าน",
  RESET_USER_PASSWORD: "รีเซ็ตรหัสผ่านผู้ใช้",
  CREATE_ASSET: "เพิ่มทรัพย์สิน",
  UPDATE_ASSET: "แก้ไขทรัพย์สิน",
  DELETE_ASSET: "ลบทรัพย์สิน",
  IMPORT_ASSETS: "นำเข้าทรัพย์สิน",
  ADD_ASSET_RELATION: "เพิ่มความสัมพันธ์ทรัพย์สิน",
  ADD_ASSET_USER_RELATION: "ผูกทรัพย์สินกับผู้ใช้",
  REMOVE_ASSET_USER_RELATION: "ลบความสัมพันธ์ผู้ใช้",
  STOCKTAKE_SEEN: "ตรวจนับทรัพย์สิน",
  CREATE_USER: "เพิ่มผู้ใช้",
  UPDATE_USER: "แก้ไขผู้ใช้",
  UPDATE_RBAC: "แก้ไขสิทธิ์เมนู",
  CREATE_TICKET: "สร้าง Ticket",
  UPDATE_TICKET: "แก้ไข Ticket",
  UPDATE_SLA_POLICY: "แก้ไข SLA Policy",
  DELETE_SLA_POLICY: "ลบ SLA Policy",
  ADD_COMMENT: "เพิ่มความคิดเห็น",
};

function auditActionLabel(action) {
  return AUDIT_ACTION_LABEL[action] || action;
}

function auditTarget(a) {
  return `${a.entityType || "รายการ"}${a.entityId ? ` #${a.entityId}` : ""}`;
}

function auditDetailObject(a) {
  if (a.detailObject !== undefined) return a.detailObject;
  if (!a.detail) return null;
  try { return JSON.parse(a.detail); } catch { return a.detail; }
}

function auditDetailText(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (detail.assetTag) return `Asset ID: ${detail.assetTag}`;
  if (detail.ticketNo) return `Ticket: ${detail.ticketNo}`;
  if (detail.changeNo) return `Change: ${detail.changeNo}`;
  if (detail.problemNo) return `Problem: ${detail.problemNo}`;
  if (detail.created != null || detail.updated != null || detail.failed != null) {
    return `สร้าง ${detail.created ?? 0}, แก้ไข ${detail.updated ?? 0}, ผิดพลาด ${detail.failed ?? 0}`;
  }
  if (detail.changes) return `แก้ไขฟิลด์: ${Object.keys(detail.changes).join(", ")}`;
  return Object.entries(detail).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
}

function auditDescription(a) {
  const actor = a.user?.fullName || "ระบบ";
  const detail = auditDetailText(auditDetailObject(a));
  return `${actor} ${auditActionLabel(a.action)} ${auditTarget(a)}${detail ? ` (${detail})` : ""}`;
}

function auditDetailModal(a) {
  const detail = auditDetailObject(a);
  const detailText = detail ? (typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)) : "—";
  const overlay = modal(`<div class="card-header"><div class="card-title">รายละเอียด Audit Log</div></div>
    <div class="card-body">
      <dl class="dl">
        <dt>เวลา</dt><dd>${esc(fmtThaiDateTime(a.createdAt))}</dd>
        <dt>ผู้ใช้</dt><dd>${esc(a.user?.fullName || "ระบบ")}</dd>
        <dt>Action</dt><dd><span class="chip">${esc(a.action)}</span> ${esc(auditActionLabel(a.action))}</dd>
        <dt>รายการ</dt><dd>${esc(auditTarget(a))}</dd>
        <dt>IP</dt><dd style="font-family:var(--font-mono)">${esc(a.ipAddress || "—")}</dd>
      </dl>
      <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin:16px 0 8px">ใครทำอะไร</div>
      <div style="font-size:13px;margin-bottom:12px">${esc(auditDescription(a))}</div>
      <div style="font-size:12px;font-weight:700;color:var(--gray-500);text-transform:uppercase;margin-bottom:8px">รายละเอียดดิบ</div>
      <pre style="white-space:pre-wrap;word-break:break-word;background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:12px;font-size:12px">${esc(detailText)}</pre>
    </div>
    <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;justify-content:flex-end">
      <button class="btn btn-primary" id="audit-detail-close">ปิด</button>
    </div>`);
  overlay.querySelector("#audit-detail-close").onclick = () => overlay.remove();
}

function kpiCard(color, icon, val, label) {
  return `<div class="kpi-card"><div class="kpi-icon ${color}">${icon}</div><div><div class="kpi-val">${val}</div><div class="kpi-label">${esc(label)}</div></div></div>`;
}
// ── Dashboard wow helpers ──
const STATUS_COLOR = { NEW:"#3b82f6", ASSIGNED:"#6366f1", IN_PROGRESS:"#d97706", PENDING:"#ec4899",
  RESOLVED:"#16a34a", CLOSED:"#94a3b8", CANCELLED:"#cbd5e1", AWAITING_APPROVAL:"#f59e0b",
  IN_USE:"#16a34a", IN_STOCK:"#3b82f6", REPAIR:"#dc2626", LOANED:"#d97706", RETIRED:"#94a3b8", DISPOSED:"#1f2937" };
// สีระดับความรุนแรง — ใช้เป็นจุดเล็กคู่ข้อความเสมอ ไม่ให้สีสื่อความหมายลำพัง
const PRIORITY_COLOR = { CRITICAL: "#d03b3b", HIGH: "#eb6834", MEDIUM: "#eda100", LOW: "#0ca30c" };
// กราฟทุกใบเป็นชุดข้อมูลเดียว (จำนวน) จึงใช้สีเดียวกันหมด สีจึงไม่ถูกตีความว่าเป็นหมวดหมู่
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#1baf7a";
// กลุ่มสถานะที่ใช้กรองจากการ์ด Dashboard — ต้องตรงกับที่ /api/dashboard นับ
const STATUS_GROUP_OPEN = "NEW,ASSIGNED,IN_PROGRESS,PENDING";
const STATUS_GROUP_DONE = "RESOLVED,CLOSED";
// attribute คลิกไปหน้ารายการแจ้งซ่อมพร้อมตัวกรอง (ส่งเดือน/ปีของ Dashboard ไปด้วย)
function ticketsLink(filter, month, year) {
  return `role="link" tabindex="0" ${navAttr("tickets", { ...filter, month: String(month), year: String(year) })} title="คลิกเพื่อดูรายการ"`;
}
function modernKpiCard(variant, label, value, sub, pct, linkAttrs = "") {
  const safePct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return `<div class="modern-kpi ${variant}${linkAttrs ? " is-link" : ""}" ${linkAttrs}>
    <div class="mk-top"><span>${esc(label)}</span><b>${safePct}%</b></div>
    <div class="mk-value">${value}</div>
    <div class="mk-sub">${esc(sub)}</div>
    <div class="mk-track"><span style="width:${safePct}%"></span></div>
  </div>`;
}
function slaGauge(percent, breached) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const r = 58;
  const c = 2 * Math.PI * r;
  const dash = `${(p / 100) * c} ${c}`;
  const color = p >= 95 ? "#0ca30c" : p >= 80 ? "#eda100" : "#d03b3b";
  return `<div class="sla-gauge">
    <svg viewBox="0 0 160 160" class="sla-svg" aria-label="SLA ${p}%">
      <circle cx="80" cy="80" r="${r}" class="gauge-bg"></circle>
      <circle cx="80" cy="80" r="${r}" class="gauge-fg" stroke="${color}" stroke-dasharray="${dash}"></circle>
      <text x="80" y="78" text-anchor="middle" class="gauge-num">${p}%</text>
      <text x="80" y="98" text-anchor="middle" class="gauge-sub">SLA KPI</text>
    </svg>
    <div class="gauge-meta">
      <div><b>${breached}</b><span>งานเกิน SLA</span></div>
      <div><b>4 ชม.</b><span>เป้าหมายบริการ</span></div>
    </div>
  </div>`;
}
function repairTrendChart(rows) {
  const weeks = [];
  for (let i = 0; i < rows.length; i += 7) {
    const days = rows.slice(i, i + 7);
    weeks.push({
      label: `${i + 1}-${i + days.length}`,
      created: days.reduce((sum, row) => sum + (Number(row.created) || 0), 0),
      resolved: days.reduce((sum, row) => sum + (Number(row.resolved) || 0), 0),
    });
  }
  const total = weeks.reduce((sum, week) => sum + week.created, 0);
  const resolved = weeks.reduce((sum, week) => sum + week.resolved, 0);
  const heading = `<div class="repair-trend-head"><h4>งานแจ้งซ่อมรายสัปดาห์</h4><p>สถานะล่าสุดของงาน แบ่งตามวันที่แจ้งซ่อม</p></div>`;
  if (!total) return `<div class="repair-trend">${heading}<div class="repair-trend-empty">ไม่มีงานแจ้งซ่อมในเดือนที่เลือก</div></div>`;
  const step = Math.max(1, Math.ceil(Math.max(...weeks.map((week) => Math.max(week.created, week.resolved))) / 4));
  const ceiling = step * 4;
  const description = (week) => `วันที่ ${week.label}: แจ้งซ่อม ${week.created} งาน / ซ่อมเสร็จแล้ว ${week.resolved} งาน`;
  const peak = weeks.reduce((best, week) => week.created > best.created ? week : best);
  return `<div class="repair-trend">
    ${heading}
    <div class="repair-trend-legend">
      <span><i class="repair-blue"></i>แจ้งซ่อม <b>${total}</b> งาน</span>
      <span><i class="repair-green"></i>ซ่อมเสร็จแล้ว <b>${resolved}</b> งาน</span>
    </div>
    <div class="repair-trend-unit">จำนวนงาน</div>
    <div class="repair-trend-plot">
      <div class="repair-trend-grid" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<div style="bottom:${i * 25}%"><span>${step * i}</span></div>`).join("")}</div>
      <div class="repair-trend-columns" style="grid-template-columns:repeat(${weeks.length},minmax(0,1fr))">
        ${weeks.map((week) => `<button type="button" class="repair-week${week === peak ? " is-active" : ""}" aria-label="${esc(description(week))}" title="${esc(description(week))}">
          <span class="repair-week-bars" aria-hidden="true">
            <span class="repair-bar repair-blue" style="height:${week.created / ceiling * 100}%">${week.created ? `<b>${week.created}</b>` : ""}</span>
            <span class="repair-bar repair-green" style="height:${week.resolved / ceiling * 100}%">${week.resolved ? `<b>${week.resolved}</b>` : ""}</span>
          </span>
          <span class="repair-week-label" aria-hidden="true">${week.label}</span>
        </button>`).join("")}
      </div>
    </div>
    <div class="repair-trend-axis">วันที่แจ้งซ่อม</div>
    <div class="repair-trend-detail" id="repair-trend-detail" aria-live="polite">${esc(description(peak))}</div>
  </div>`;
}
function priorityChart(rows) {
  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;
  if (!rows.length) return '<div class="empty">ยังไม่มีข้อมูล</div>';
  return `<div class="priority-stack">${rows.map((r) => {
    const pct = Math.round((r.count / total) * 100);
    // จุดสีบอกระดับความรุนแรง ส่วนแท่งเป็นจำนวนงาน (ชุดข้อมูลเดียว) จึงใช้สีเดียวจาก CSS
    return `<div class="priority-line"><div><span style="background:${r.color}"></span>${esc(r.label)}</div><b>${r.count}</b></div>
      <div class="priority-track"><i style="width:${pct}%"></i></div>`;
  }).join("")}</div>`;
}
function statCard(variant, icon, val, label, trend) {
  return `<div class="stat-card v-${variant}"><span class="blob b1"></span><span class="blob b2"></span>
    <div class="stat-top"><span class="stat-ic">${icon}</span>${trend ? `<span class="stat-trend">${trend}</span>` : ""}</div>
    <div class="stat-val">${val}</div><div class="stat-label">${esc(label)}</div></div>`;
}
function barRow(label, count, pct) {
  return `<div class="bar-row"><div class="bar-head"><span>${esc(label)}</span><span class="v">${count} <span style="color:var(--gray-400);font-weight:500">(${pct}%)</span></span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
}
function donutChart(segments, centerNum, centerSub) {
  const total = segments.reduce((s, x) => s + x.count, 0) || 1;
  const R = 56, C = 2 * Math.PI * R; let offset = 0;
  const arcs = segments.filter(s => s.count > 0).map((s) => {
    const len = (s.count / total) * C, dash = `${len} ${C - len}`, o = -offset; offset += len;
    return `<circle class="seg" cx="75" cy="75" r="${R}" fill="none" stroke="${s.color}" stroke-width="22"
      stroke-dasharray="${dash}" stroke-dashoffset="${o}" stroke-linecap="butt" transform="rotate(-90 75 75)"></circle>`;
  }).join("");
  const legend = segments.map((s) => `<div class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${esc(s.label)}<span class="lc">${s.count}</span></div>`).join("");
  return `<div class="donut-wrap"><svg viewBox="0 0 150 150" width="170" height="170" class="donut">
    <circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--gray-100)" stroke-width="22"></circle>${arcs}
    <text x="75" y="72" text-anchor="middle" class="donut-num">${centerNum}</text>
    <text x="75" y="90" text-anchor="middle" class="donut-sub">${esc(centerSub)}</text></svg>
    <div class="legend">${legend}</div></div>`;
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "สวัสดีตอนเช้า" : h < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น"; }
function fmtFileSize(b) { if (b == null) return ""; if (b < 1024) return b + " B"; if (b < 1048576) return (b / 1024).toFixed(1) + " KB"; return (b / 1048576).toFixed(1) + " MB"; }
function kv(k, v) { return `<div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">${esc(k)}</span><span style="font-weight:500">${esc(v || "—")}</span></div>`; }
function labelHtml(text, req) { return `<label>${esc(text)}${req ? ' <span class="req">*</span>' : ""}</label>`; }
function field(id, label, value, req, ph) { return `<div class="form-group">${labelHtml(label, req)}<input id="${id}" value="${esc(value)}" placeholder="${esc(ph || "")}"></div>`; }
function val(id) { return document.getElementById(id)?.value.trim() || ""; }
function pagination(data, route, query) {
  const pages = Math.ceil(data.total / data.pageSize) || 1;
  if (pages <= 1) return `<div class="pagination"><span style="font-size:12px;color:var(--gray-500)">ทั้งหมด ${data.total} รายการ</span></div>`;
  const current = Number(data.page) || 1;
  const start = Math.max(1, current - 2);
  const end = Math.min(pages, current + 2);
  const pageButtons = [];
  if (start > 1) {
    pageButtons.push(`<button class="btn btn-ghost btn-sm" ${navAttr(route, { ...query, page: 1 })}>1</button>`);
    if (start > 2) pageButtons.push(`<span style="padding:4px 2px;color:var(--gray-400)">...</span>`);
  }
  for (let p = start; p <= end; p += 1) {
    pageButtons.push(`<button class="btn ${p === current ? "btn-primary" : "btn-ghost"} btn-sm" ${p === current ? "disabled" : ""} ${navAttr(route, { ...query, page: p })}>${p}</button>`);
  }
  if (end < pages) {
    if (end < pages - 1) pageButtons.push(`<span style="padding:4px 2px;color:var(--gray-400)">...</span>`);
    pageButtons.push(`<button class="btn btn-ghost btn-sm" ${navAttr(route, { ...query, page: pages })}>${pages}</button>`);
  }
  return `<div class="pagination"><span style="font-size:12px;color:var(--gray-500)">หน้า ${data.page} / ${pages} (${data.total} รายการ)</span>
    <div style="display:flex;gap:6px">
      <button class="btn btn-ghost btn-sm" ${data.page <= 1 ? "disabled" : ""} ${navAttr(route, { ...query, page: data.page - 1 })}>←</button>
      ${pageButtons.join("")}
      <button class="btn btn-ghost btn-sm" ${data.page >= pages ? "disabled" : ""} ${navAttr(route, { ...query, page: data.page + 1 })}>→</button>
    </div></div>`;
}
async function submitBtn(id, fn) {
  const btn = document.getElementById(id); btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}

// ─────── Generic modal form (add/edit) ───────
// fields: [{key,label,type,req,full,ph,options,default}]  type: text|number|date|select|textarea|checkbox|password
function formModal({ title, fields, values = {}, submitLabel = "💾 บันทึก", onSubmit }) {
  const body = fields.map((f) => {
    const v = values[f.key] != null ? values[f.key] : (f.default != null ? f.default : "");
    const full = f.full ? "full" : "";
    if (f.type === "select")
      return `<div class="form-group ${full}">${labelHtml(f.label, f.req)}<select id="fm-${f.key}">${f.options.map((o) => `<option value="${esc(o.value)}" ${String(v) === String(o.value) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></div>`;
    if (f.type === "textarea")
      return `<div class="form-group full">${labelHtml(f.label, f.req)}<textarea id="fm-${f.key}" placeholder="${esc(f.ph || "")}">${esc(v)}</textarea></div>`;
    if (f.type === "checkbox")
      return `<div class="form-group full"><label style="display:flex;gap:6px;font-weight:400"><input type="checkbox" id="fm-${f.key}" style="width:auto" ${v ? "checked" : ""}> ${esc(f.label)}</label></div>`;
    const t = f.type === "date" ? "date" : f.type === "number" ? "number" : f.type === "password" ? "password" : "text";
    const autocomplete = f.type === "password" ? ' autocomplete="new-password"' : "";
    return `<div class="form-group ${full}">${labelHtml(f.label, f.req)}<input id="fm-${f.key}" type="${t}" value="${esc(v)}" placeholder="${esc(f.ph || "")}"${autocomplete}></div>`;
  }).join("");
  const overlay = modal(`<div class="card-header"><div class="card-title">${esc(title)}</div></div>
    <div class="card-body"><div class="form-grid">${body}</div></div>
    <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" id="fm-cancel">ยกเลิก</button><button class="btn btn-primary" id="fm-save">${submitLabel}</button></div>`);
  overlay.querySelector("#fm-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#fm-save").onclick = async () => {
    const data = {};
    for (const f of fields) {
      const el = document.getElementById("fm-" + f.key);
      if (!el) continue;
      let value = f.type === "checkbox" ? el.checked : el.value.trim();
      if (f.req && (value === "" || value == null)) return toast("กรุณากรอก: " + f.label, "error");
      if (f.type !== "checkbox" && value === "") value = undefined;
      data[f.key] = value;
    }
    const btn = overlay.querySelector("#fm-save"); btn.disabled = true;
    try { await onSubmit(data); overlay.remove(); }
    catch (e) { toast(e.message, "error"); btn.disabled = false; }
  };
  return overlay;
}

function userForm(u) {
  const dopts = [{ value: "", label: "— ไม่ระบุ —" }, ...(META.departments || []).map((d) => ({ value: d.id, label: d.name }))];
  const ropts = Object.entries(ROLE).map(([k, v]) => ({ value: k, label: v }));
  const fields = [
    { key: "fullName", label: "ชื่อ-นามสกุล", req: true, full: true },
    { key: "email", label: "อีเมล", req: true },
    ...(!u ? [{ key: "password", label: "รหัสผ่าน", type: "password", req: true }] : []),
    { key: "role", label: "บทบาท", type: "select", options: ropts, default: "USER" },
    { key: "departmentId", label: "แผนก", type: "select", options: dopts },
    { key: "phone", label: "โทรศัพท์" },
    { key: "jobTitle", label: "ตำแหน่ง" },
  ];
  const overlay = formModal({
    title: u ? "แก้ไขผู้ใช้งาน" : "เพิ่มผู้ใช้งาน",
    fields,
    values: u || {},
    onSubmit: async (data) => {
      if (u) await api.patch("/users/" + u.id, data);
      else await api.post("/users", data);
      toast("บันทึกผู้ใช้งานแล้ว", "success");
      navigate("users");
    },
  });
  if (u) {
    const footer = overlay.querySelector("#fm-cancel")?.parentElement;
    if (footer) {
      const left = document.createElement("div");
      left.style.cssText = "display:flex;gap:8px;margin-right:auto";

      const reset = document.createElement("button");
      reset.className = "btn btn-ghost";
      reset.textContent = "กำหนดรหัสผ่าน";
      reset.onclick = async () => {
        const ok = await resetUserPassword(u.id, u.fullName || u.email);
        if (ok) overlay.remove();
      };
      left.appendChild(reset);

      if (u.id !== State.user.id) {
        const del = document.createElement("button");
        del.className = "btn btn-danger";
        del.textContent = "ลบ";
        del.onclick = async () => {
          const ok = await deleteUser(u.id, u.fullName || u.email);
          if (ok) overlay.remove();
        };
        left.appendChild(del);
      }

      footer.prepend(left);
    }
  }
}

async function resetUserPassword(id, name) {
  return new Promise((resolve) => {
    const overlay = modal(`<div class="card-header"><div class="card-title">กำหนดรหัสผ่านใหม่</div></div>
      <div class="card-body">
        <div style="font-size:13px;color:var(--gray-500);margin-bottom:12px">ผู้ใช้: <b>${esc(name || id)}</b></div>
        <div class="form-group full"><label>รหัสผ่านใหม่ <span class="req">*</span></label><input id="admin-new-password" type="password" autocomplete="new-password"></div>
        <div class="form-group full"><label>ยืนยันรหัสผ่าน <span class="req">*</span></label><input id="admin-confirm-password" type="password" autocomplete="new-password"></div>
        <label style="display:flex;gap:6px;align-items:center;font-weight:400;font-size:13px;color:var(--gray-600)">
          <input type="checkbox" id="admin-show-password" style="width:auto"> แสดงรหัสผ่าน
        </label>
        <div style="font-size:12px;color:var(--gray-500);margin-top:4px">รหัสผ่านต้องยาวอย่างน้อย 8 ตัว มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข</div>
      </div>
      <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" id="reset-cancel">ยกเลิก</button>
        <button class="btn btn-primary" id="reset-save">บันทึกรหัสผ่าน</button>
      </div>`);
    const passwordEl = overlay.querySelector("#admin-new-password");
    const confirmEl = overlay.querySelector("#admin-confirm-password");
    const showPasswordEl = overlay.querySelector("#admin-show-password");
    const save = overlay.querySelector("#reset-save");

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector("#reset-cancel").onclick = () => close(false);
    showPasswordEl.onchange = () => {
      const type = showPasswordEl.checked ? "text" : "password";
      passwordEl.type = type;
      confirmEl.type = type;
    };
    passwordEl.focus();
    save.onclick = async () => {
      const password = passwordEl.value;
      const confirm = confirmEl.value;
      if (!password) return toast("กรุณากรอกรหัสผ่านใหม่", "error");
      if (password !== confirm) return toast("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน", "error");
      save.disabled = true;
      try {
        const result = await api.post(`/users/${id}/reset-password`, { password });
        toast("กำหนดรหัสผ่านแล้ว", "success");
        showResetPasswordModal(name || id, result.password);
        navigate("users");
        close(true);
      } catch (e) {
        toast(e.details ? e.details.map((d) => d.message).join(", ") : e.message, "error");
        save.disabled = false;
      }
    };
    confirmEl.onkeydown = (e) => { if (e.key === "Enter") save.click(); };
    passwordEl.onkeydown = (e) => { if (e.key === "Enter") confirmEl.focus(); };
  });
}

function showResetPasswordModal(name, password) {
  const overlay = modal(`<div class="card-header"><div class="card-title">รหัสผ่านใหม่</div></div>
    <div class="card-body">
      <div style="font-size:13px;color:var(--gray-500);margin-bottom:10px">ส่งรหัสนี้ให้ ${esc(name)} แล้วแนะนำให้ผู้ใช้เปลี่ยนรหัสผ่านหลังเข้าสู่ระบบ</div>
      <div class="form-group full"><label>รหัสผ่านใหม่</label><input id="reset-password-value" type="text" readonly value="${esc(password)}" style="font-family:var(--font-mono);font-weight:700"></div>
      <div style="font-size:12px;color:var(--warning);margin-top:4px">ระบบจะไม่สามารถแสดงรหัสผ่านเดิมหรือรหัสนี้ย้อนหลังได้</div>
    </div>
    <div style="padding:16px 20px;border-top:1px solid var(--gray-200);display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-ghost" id="reset-copy">คัดลอก</button>
      <button class="btn btn-primary" id="reset-close">ปิด</button>
    </div>`);
  const input = overlay.querySelector("#reset-password-value");
  input.focus();
  input.select();
  overlay.querySelector("#reset-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(password);
    } catch {
      input.select();
      document.execCommand("copy");
    }
    toast("คัดลอกรหัสผ่านแล้ว", "success");
  };
  overlay.querySelector("#reset-close").onclick = () => overlay.remove();
}

async function deleteUser(id, name) {
  if (!confirm(`ยืนยันลบผู้ใช้งาน "${name || id}"?\n\nระบบจะลบออกจากฐานข้อมูลจริง ถ้ามีประวัติงานสำคัญผูกอยู่ระบบจะแจ้งเตือนและไม่ลบ`)) return false;
  try {
    await api.del("/users/" + id);
    toast("ลบผู้ใช้งานแล้ว", "success");
    navigate("users");
    return true;
  } catch (e) {
    toast(e.message, "error");
    return false;
  }
}
