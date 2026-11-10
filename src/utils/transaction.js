const prisma = require("../db");

// Retry serialization conflicts; never repeat external side effects in work().
async function inTransaction(work) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 });
    } catch (error) {
      if (error.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

module.exports = { inTransaction, httpError };
