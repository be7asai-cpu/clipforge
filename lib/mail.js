/**
 * ClipForge mail — SMTP via nodemailer, with local outbox fallback.
 */
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const OUTBOX_DIR = path.join(__dirname, "..", "data", "auth", "outbox");

function ensureOutbox() {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      (process.env.SMTP_PASS || process.env.SMTP_PASSWORD)
  );
}

function mailFrom() {
  return (
    process.env.SMTP_FROM ||
    process.env.MAIL_FROM ||
    process.env.SMTP_USER ||
    "ClipForge <noreply@localhost>"
  );
}

function createTransport() {
  if (!smtpConfigured()) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === "1" ||
    process.env.SMTP_SECURE === "true" ||
    port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
    },
  });
}

/**
 * Save a copy of every outbound mail for debugging.
 * @returns {string} path to outbox file
 */
function writeOutbox({ to, subject, text, html, extra }) {
  ensureOutbox();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTo = String(to || "unknown").replace(/[^a-z0-9@._+-]/gi, "_");
  const file = path.join(OUTBOX_DIR, `${stamp}_${safeTo}.json`);
  const payload = {
    at: new Date().toISOString(),
    to,
    from: mailFrom(),
    subject,
    text,
    html,
    ...extra,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return file;
}

/**
 * Send email. Always writes outbox. Uses SMTP when configured.
 * @returns {{ ok: boolean, mode: 'smtp'|'outbox', messageId?: string, outboxPath: string, error?: string }}
 */
async function sendMail({ to, subject, text, html, extra }) {
  const outboxPath = writeOutbox({ to, subject, text, html, extra });
  const transport = createTransport();

  if (!transport) {
    console.log("");
    console.log("  [ClipForge mail] SMTP nie skonfigurowany — wiadomość w outbox:");
    console.log(`  ${outboxPath}`);
    if (extra?.activateUrl) {
      console.log(`  Link aktywacyjny: ${extra.activateUrl}`);
    }
    console.log("");
    return { ok: true, mode: "outbox", outboxPath };
  }

  try {
    const info = await transport.sendMail({
      from: mailFrom(),
      to,
      subject,
      text,
      html,
    });
    console.log(`[ClipForge mail] sent → ${to} (${info.messageId || "ok"})`);
    return {
      ok: true,
      mode: "smtp",
      messageId: info.messageId,
      outboxPath,
    };
  } catch (err) {
    console.error("[ClipForge mail] SMTP error:", err.message);
    return {
      ok: false,
      mode: "outbox",
      outboxPath,
      error: err.message,
    };
  }
}

async function sendActivationEmail({ to, name, activateUrl }) {
  const subject = "ClipForge — aktywuj konto";
  const greet = name ? `Cześć ${name},` : "Cześć,";
  const text = [
    greet,
    "",
    "Dziękujemy za rejestrację w ClipForge.",
    "Kliknij link, aby aktywować konto (ważny 24 godziny):",
    "",
    activateUrl,
    "",
    "Jeśli to nie Ty — zignoruj tę wiadomość.",
    "",
    "— ClipForge",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="pl">
<body style="margin:0;padding:0;background:#0e1924;font-family:Segoe UI,Arial,sans-serif;color:#b8d4e8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0e1924;padding:32px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#121e2b;border:1px solid #2a4560;border-radius:8px;padding:28px;">
        <tr><td>
          <div style="font-size:20px;font-weight:700;color:#7df9ff;letter-spacing:0.06em;">CLIPFORGE</div>
          <p style="margin:20px 0 8px;font-size:16px;color:#e0f7ff;">${escapeHtml(greet)}</p>
          <p style="margin:0 0 20px;line-height:1.5;color:#b8d4e8;">
            Dziękujemy za rejestrację. Kliknij przycisk poniżej, aby aktywować konto.
            Link jest ważny <strong>24 godziny</strong>.
          </p>
          <p style="text-align:center;margin:28px 0;">
            <a href="${escapeAttr(activateUrl)}"
               style="display:inline-block;background:linear-gradient(135deg,#00e5ff,#3db8ff);color:#061018;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:4px;">
              Aktywuj konto
            </a>
          </p>
          <p style="margin:0;font-size:12px;color:#5a7a94;line-height:1.45;word-break:break-all;">
            Jeśli przycisk nie działa, wklej ten link w przeglądarkę:<br/>
            <a href="${escapeAttr(activateUrl)}" style="color:#00e5ff;">${escapeHtml(activateUrl)}</a>
          </p>
          <p style="margin:24px 0 0;font-size:12px;color:#5a7a94;">
            Jeśli to nie Ty zakładałeś konto — zignoruj tę wiadomość.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return sendMail({
    to,
    subject,
    text,
    html,
    extra: { activateUrl, kind: "activation" },
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

module.exports = {
  sendMail,
  sendActivationEmail,
  smtpConfigured,
  OUTBOX_DIR,
};
