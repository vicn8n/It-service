const { z } = require("zod");

// นโยบายรหัสผ่าน: อย่างน้อย 8 ตัว, มีตัวพิมพ์ใหญ่ พิมพ์เล็ก และตัวเลข
const PASSWORD_MIN = 8;

function passwordIssues(pw) {
  const issues = [];
  if (!pw || pw.length < PASSWORD_MIN) issues.push(`ต้องยาวอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`);
  if (!/[a-z]/.test(pw)) issues.push("ต้องมีตัวพิมพ์เล็ก (a-z)");
  if (!/[A-Z]/.test(pw)) issues.push("ต้องมีตัวพิมพ์ใหญ่ (A-Z)");
  if (!/[0-9]/.test(pw)) issues.push("ต้องมีตัวเลข (0-9)");
  return issues;
}

// zod schema สำหรับ field รหัสผ่านที่ต้องผ่านนโยบาย
const strongPassword = z.string().superRefine((pw, ctx) => {
  for (const msg of passwordIssues(pw)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "รหัสผ่าน" + msg });
  }
});

module.exports = { PASSWORD_MIN, passwordIssues, strongPassword };
