const prisma = require("../db");

const RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS || 90);
const DAY_MS = 24 * 60 * 60 * 1000;

async function purgeOldAuditLogs() {
  if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS <= 0) return;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
  const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (result.count) console.log(`[AUDIT] purged ${result.count} log(s) older than ${RETENTION_DAYS} days`);
}

function startAuditRetentionJob() {
  purgeOldAuditLogs().catch((err) => console.error("[AUDIT] purge failed:", err.message));
  setInterval(() => purgeOldAuditLogs().catch((err) => console.error("[AUDIT] purge failed:", err.message)), DAY_MS).unref();
}

module.exports = { startAuditRetentionJob, purgeOldAuditLogs };
