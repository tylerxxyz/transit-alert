// Transactional email via Resend (https://resend.com). Requires RESEND_API_KEY
// to be set, and the sending domain (RESEND_FROM_EMAIL's domain, e.g.
// transit-alert.com) to be verified in the Resend dashboard — without both,
// sendEmail() logs a warning and no-ops rather than throwing, so registration
// and password-reset requests never fail just because email isn't configured
// yet.
const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "TransitAlert <noreply@transit-alert.com>";

let loggedMissingKey = false;

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (!loggedMissingKey) {
      loggedMissingKey = true;
      console.warn("[transitalert-mailer] RESEND_API_KEY is not set — emails will not be sent.");
    }
    return { sent: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(`[transitalert-mailer] Resend request failed (${response.status}): ${body}`);
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true };
  } catch (error) {
    console.warn(`[transitalert-mailer] Failed to send email: ${error instanceof Error ? error.message : error}`);
    return { sent: false, reason: "network_error" };
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function emailShell(title, bodyHtml) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#020617;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:32px 24px;color:#e2e8f0;">
      <p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#38bdf8;margin:0 0 8px;">TransitAlert</p>
      <h1 style="font-size:20px;margin:0 0 16px;color:#ffffff;">${title}</h1>
      ${bodyHtml}
      <p style="margin-top:32px;font-size:11px;color:#64748b;">TransitAlert is an independent project. We are not operated by, affiliated with, or endorsed by the Department of Transport and Planning, Transport Victoria, PTV, or Metro Trains Melbourne.</p>
    </div>
  </body>
</html>`;
}

export function sendWelcomeEmail(user) {
  const html = emailShell(
    `Welcome to TransitAlert, ${escapeHtml(user.username)}!`,
    `<p style="font-size:14px;line-height:1.6;">Thanks for signing up. TransitAlert gives you live Melbourne trains, trams, buses and V/Line services, real disruption alerts, and a journey planner built on real GTFS data.</p>
     <p style="font-size:14px;line-height:1.6;">Jump back in any time to track your services live.</p>`,
  );
  return sendEmail({
    to: user.email,
    subject: "Welcome to TransitAlert",
    html,
    text: `Welcome to TransitAlert, ${user.username}! Thanks for signing up — track live Melbourne trains, trams, buses and V/Line services any time.`,
  });
}

export function sendPasswordResetEmail(user, resetUrl) {
  const html = emailShell(
    "Reset your password",
    `<p style="font-size:14px;line-height:1.6;">We received a request to reset the password for your TransitAlert account (${escapeHtml(user.username)}).</p>
     <p style="margin:24px 0;"><a href="${escapeHtml(resetUrl)}" style="background:#0ea5e9;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Reset password</a></p>
     <p style="font-size:13px;line-height:1.6;color:#94a3b8;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
  );
  return sendEmail({
    to: user.email,
    subject: "Reset your TransitAlert password",
    html,
    text: `Reset your TransitAlert password: ${resetUrl} (expires in 1 hour). If you didn't request this, ignore this email.`,
  });
}
