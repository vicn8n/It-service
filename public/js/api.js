// API client — ห่อ fetch ให้ใช้ cookie auth และ handle error
const api = {
  async request(method, path, body, isForm = false) {
    const opts = { method, credentials: "same-origin", headers: {} };
    if (method !== "GET") {
      // CSRF double-submit — server ออก cookie "csrf" ให้ตั้งแต่ GET แรก
      const m = document.cookie.match(/(?:^|;\s*)csrf=([a-f0-9]+)/);
      if (m) opts.headers["X-CSRF-Token"] = m[1];
    }
    if (body && !isForm) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    } else if (isForm) {
      opts.body = body; // FormData
    }
    const res = await fetch("/api" + path, opts);
    if (res.status === 401 && !path.startsWith("/auth")) {
      window.dispatchEvent(new CustomEvent("unauthorized"));
      throw new Error("กรุณาเข้าสู่ระบบ");
    }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
    if (!res.ok) {
      const msg = data?.error || `เกิดข้อผิดพลาด (${res.status})`;
      const err = new Error(msg);
      err.details = data?.details;
      throw err;
    }
    return data;
  },
  get: (p) => api.request("GET", p),
  post: (p, b) => api.request("POST", p, b),
  patch: (p, b) => api.request("PATCH", p, b),
  put: (p, b) => api.request("PUT", p, b),
  del: (p) => api.request("DELETE", p),
  upload: (p, formData) => api.request("POST", p, formData, true),
};

// query string helper
function qs(params) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const s = new URLSearchParams(clean).toString();
  return s ? "?" + s : "";
}
