const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/routes/dashboard.js"), "utf8");
const fixtures = [
  ["2026-08-31T16:59:59Z", "CLOSED", 1, false],
  ["2026-08-31T17:00:00Z", "CLOSED", 1, true],
  ["2026-09-30T16:59:59Z", "NEW", 2, false],
  ["2026-09-30T17:00:00Z", "CLOSED", 1, false],
].map(([createdAt, status, requesterId, slaBreached]) => ({
  createdAt: new Date(createdAt), status, requesterId, slaBreached,
  categoryId: 1, priority: "MEDIUM",
}));

async function dashboard(query, user = { role: "ADMIN", id: 1 }) {
  const routes = {};
  const calls = [];
  const matching = (where) => {
    calls.push(where);
    return fixtures.filter((row) =>
      row.createdAt >= where.createdAt.gte && row.createdAt < where.createdAt.lt &&
      (!where.requesterId || row.requesterId === where.requesterId) &&
      (!where.status?.in || where.status.in.includes(row.status)) &&
      (where.slaBreached === undefined || row.slaBreached === where.slaBreached));
  };
  const prisma = {
    ticket: {
      count: async ({ where }) => matching(where).length,
      groupBy: async ({ where, by: [key] }) => {
        const groups = new Map();
        matching(where).forEach((row) => groups.set(row[key], (groups.get(row[key]) || 0) + 1));
        return [...groups].map(([value, count]) => ({ [key]: value, _count: count }));
      },
      findMany: async ({ where }) => matching(where),
    },
    category: { findMany: async () => [{ id: 1, name: "Hardware" }] },
  };
  vm.runInNewContext(source, {
    require: (id) => {
      // handler คือ argument สุดท้ายเสมอ — ตัวกลางก่อนหน้า (เช่น requireRole) ไม่เกี่ยวกับเทสต์นี้
      if (id === "express") return { Router: () => ({ use() {}, get: (url, ...rest) => { routes[url] = rest[rest.length - 1]; } }) };
      if (id === "../db") return prisma;
      if (id === "../middleware/auth") return { authenticate() {}, requireRole: () => function guard() {} };
      if (id === "../middleware/error") return { asyncHandler: (fn) => fn };
      throw new Error(`Unexpected module: ${id}`);
    },
    module: { exports: {} },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await routes["/helpdesk"]({ query, user }, res);
  return { ...res, calls };
}

test("all monthly totals and trend respect Bangkok month boundaries", async () => {
  const { body, calls } = await dashboard({ month: "9", year: "2026" });
  assert.equal(body.kpi.total, 2);
  assert.equal(body.kpi.open, 1);
  assert.equal(body.kpi.resolved, 1);
  assert.equal(body.kpi.breached, 1);
  assert.equal(body.kpi.slaCompliance, 50);
  for (const key of ["byCategory", "byStatus", "byPriority"]) {
    assert.equal(body[key].reduce((sum, row) => sum + row.count, 0), 2);
  }
  assert.equal(body.trend.length, 30);
  assert.equal(body.trend[0].created, 1);
  assert.equal(body.trend[29].created, 1);
  assert.equal(body.trend.reduce((sum, row) => sum + row.resolved, 0), 1);
  assert.equal(calls.length, 8);
  for (const where of calls) {
    assert.equal(where.createdAt.gte.toISOString(), "2026-08-31T17:00:00.000Z");
    assert.equal(where.createdAt.lt.toISOString(), "2026-09-30T17:00:00.000Z");
  }
});

test("USER sees only their own monthly data", async () => {
  const { body, calls } = await dashboard({ month: "9", year: "2026" }, { role: "USER", id: 2 });
  assert.equal(body.kpi.total, 1);
  assert.equal(body.kpi.resolved, 0);
  assert.equal(body.kpi.breached, 0);
  assert.ok(calls.every((where) => where.requesterId === 2));
});

test("Buddhist year, leap February, empty month, and December rollover", async () => {
  const thai = await dashboard({ month: "9", year: "2569" });
  assert.equal(thai.body.period.year, 2026);
  assert.equal(thai.body.kpi.total, 2);
  for (const [year, days] of [[2024, 29], [2026, 28]]) {
    const { body } = await dashboard({ month: "2", year: String(year) });
    assert.equal(body.trend.length, days);
    assert.equal(body.kpi.total, 0);
    assert.ok(body.trend.every((row) => row.created === 0));
  }
  const december = await dashboard({ month: "12", year: "2026" });
  assert.equal(december.calls[0].createdAt.lt.toISOString(), "2026-12-31T17:00:00.000Z");
});

test("invalid month/year rejected before querying database", async () => {
  for (const query of [{ month: "13" }, { month: "0" }, { month: "1.5" }, { year: "oops" }, { year: "1800" }]) {
    const result = await dashboard(query);
    assert.equal(result.code, 400);
    assert.equal(result.calls.length, 0);
  }
});

test("omitting filters defaults to the current Bangkok month", async () => {
  const { body } = await dashboard({});
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "numeric",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  assert.equal(body.period.month, Number(parts.month));
  assert.equal(body.period.year, Number(parts.year));
});
