import type { Email } from "./send";
import { COMMUNITY_WHATSAPP_URL } from "@/lib/constants";

/**
 * Plain black-and-white transactional emails. Every template returns both
 * HTML and a text part (better deliverability, readable in any client).
 */

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px">
<tr><td style="padding:24px 24px 0;font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:14px">P2P.LK</td></tr>
<tr><td style="padding:16px 24px 24px">
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e5e5e5;font-size:12px;color:#737373">You're getting this because of an account on P2P.LK. If this wasn't you, ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (s: string) => `<p style="font-size:14px;line-height:1.55;margin:0 0 12px">${s}</p>`;
const btn = (href: string, label: string) =>
  `<p style="margin:16px 0"><a href="${esc(href)}" style="display:inline-block;background:#171717;color:#fafafa;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600">${esc(label)}</a></p>`;
const code = (c: string) =>
  `<p style="font-family:ui-monospace,Menlo,monospace;font-size:28px;letter-spacing:6px;font-weight:700;margin:8px 0 16px">${esc(c)}</p>`;

export function verifyEmail(to: string, otp: string, link: string): Email {
  return {
    to,
    subject: `${otp} is your P2P.LK verification code`,
    html: layout(
      "Confirm your email",
      p("Enter this code on P2P.LK to confirm your email address. It expires in 10 minutes.") +
        code(otp) +
        p("Or open this link on the same device:") +
        btn(link, "Confirm email"),
    ),
    text: `Your P2P.LK verification code is ${otp} (expires in 10 minutes).\n\nOr open: ${link}`,
  };
}

export function resetPassword(to: string, otp: string): Email {
  return {
    to,
    subject: `${otp} is your P2P.LK password reset code`,
    html: layout(
      "Reset your password",
      p("Enter this code on P2P.LK to choose a new password. It expires in 10 minutes.") + code(otp),
    ),
    text: `Your P2P.LK password reset code is ${otp} (expires in 10 minutes).`,
  };
}

export function changeEmailCode(to: string, otp: string): Email {
  return {
    to,
    subject: `${otp} confirms your new P2P.LK email`,
    html: layout("Confirm your new email", p("Enter this code on P2P.LK to switch your account to this address.") + code(otp)),
    text: `Your P2P.LK email change code is ${otp}.`,
  };
}

export function underReview(to: string, name: string): Email {
  return {
    to,
    subject: "Your P2P.LK account is under review",
    html: layout(
      `Thanks, ${name}`,
      p("Your email is confirmed. An admin will review your merchant details — usually within one working day — and we'll email you as soon as it's done.") +
        p("Meanwhile, join our WhatsApp community for market updates and announcements:") +
        btn(COMMUNITY_WHATSAPP_URL, "Join the WhatsApp community"),
    ),
    text: `Thanks, ${name}. Your email is confirmed. An admin will review your account and email you when it's done.\n\nJoin our WhatsApp community for updates: ${COMMUNITY_WHATSAPP_URL}`,
  };
}

export function adminNewMember(to: string, m: { name: string; merchantName: string; email: string }, link: string): Email {
  return {
    to,
    subject: `New member to review: ${m.merchantName}`,
    html: layout(
      "New member waiting for review",
      p(`<b>${esc(m.name)}</b> (${esc(m.merchantName)}) · ${esc(m.email)}`) + btn(link, "Open review queue"),
    ),
    text: `New member waiting for review: ${m.name} (${m.merchantName}) ${m.email}\n${link}`,
  };
}

export function approved(to: string, name: string, link: string): Email {
  return {
    to,
    subject: "You're approved — welcome to P2P.LK",
    html: layout(
      `Welcome, ${name}`,
      p("Your account is approved. Your dashboard, server-side alerts, reports and full history are now unlocked.") +
        btn(link, "Open my dashboard") +
        p(`Community updates on WhatsApp: <a href="${esc(COMMUNITY_WHATSAPP_URL)}">join the group</a>.`),
    ),
    text: `Welcome, ${name}. Your P2P.LK account is approved: ${link}\n\nJoin our WhatsApp community for updates: ${COMMUNITY_WHATSAPP_URL}`,
  };
}

export function rejected(to: string, name: string, note: string | null): Email {
  return {
    to,
    subject: "About your P2P.LK account",
    html: layout(
      `Hi ${name}`,
      p("We couldn't approve your account this time.") +
        (note ? p(`Reviewer's note: <i>${esc(note)}</i>`) : "") +
        p("You can still use all public market pages. Reply to this email if you think this is a mistake."),
    ),
    text: `Hi ${name}, we couldn't approve your P2P.LK account.${note ? ` Note: ${note}` : ""}`,
  };
}

export function alertFired(
  to: string,
  items: { label: string; detail: string }[],
  link: string,
): Email {
  const list = items.map((i) => `<li style="margin:0 0 6px"><b>${esc(i.label)}</b> — ${esc(i.detail)}</li>`).join("");
  return {
    kind: "alert",
    to,
    subject: items.length === 1 ? `Alert: ${items[0].label}` : `${items.length} P2P.LK alerts fired`,
    html: layout(
      items.length === 1 ? "Your alert fired" : "Your alerts fired",
      `<ul style="font-size:14px;line-height:1.5;padding-left:18px;margin:0 0 12px">${list}</ul>` + btn(link, "Open alerts"),
    ),
    text: items.map((i) => `• ${i.label} — ${i.detail}`).join("\n") + `\n\n${link}`,
  };
}
