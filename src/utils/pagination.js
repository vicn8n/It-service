const { httpError } = require("./transaction");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// แปลง page/pageSize จาก query string ให้เป็นตัวเลขที่ Prisma รับได้
// ค่าที่ผิดรูป (เช่น ?page=abc) ต้องตอบ 400 ไม่ใช่ปล่อย NaN เข้า Prisma แล้ว 500
function parsePaging(query, { defaultPageSize = DEFAULT_PAGE_SIZE, maxPageSize = MAX_PAGE_SIZE } = {}) {
  const page = parsePositiveInt(query.page, 1, "page");
  const requested = parsePositiveInt(query.pageSize, defaultPageSize, "pageSize");
  const take = Math.min(requested, maxPageSize);
  return { page, take, skip: (page - 1) * take };
}

function parsePositiveInt(raw, fallback, field) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw httpError(400, `พารามิเตอร์ ${field} ต้องเป็นจำนวนเต็มบวก`);
  }
  return n;
}

module.exports = { parsePaging, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
