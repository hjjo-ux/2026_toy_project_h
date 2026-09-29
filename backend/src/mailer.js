import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

// SMTP 설정이 .env 에 없으면 메일 발송 기능만 조용히 꺼둡니다 — 로컬 개발 중
// 다른 기능(이력 조회 등)까지 같이 막히면 안 되기 때문입니다.
const enabled = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);

const transporter = enabled
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    })
  : null;

if (!enabled) {
  console.warn("[mailer] SMTP 설정이 없어 메일 발송 기능이 비활성화되어 있습니다 (.env 확인)");
}

export const mailerEnabled = enabled;

export async function sendMail({ to, subject, text, html }) {
  if (!enabled) {
    console.warn("[mailer] 발송 건너뜀(SMTP 미설정):", subject, "->", to);
    return { skipped: true };
  }
  return transporter.sendMail({ from: MAIL_FROM, to, subject, text, html });
}
