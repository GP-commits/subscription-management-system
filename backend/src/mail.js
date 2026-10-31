import nodemailer from 'nodemailer';
import { id } from './db.js';
export function queueEmail(db, to, subject, html, now) {
  const mailId = id();
  db.prepare('INSERT INTO outbox(id,recipient,subject,html,created_at) VALUES(?,?,?,?,?)').run(
    mailId,
    to,
    subject,
    html,
    now.toISOString(),
  );
  return mailId;
}
export function createMailer(
  db,
  { production = false, smtp = {}, from = 'Brightloop <billing@localhost>' } = {},
) {
  const transport = smtp.host
    ? nodemailer.createTransport({
        host: smtp.host,
        port: Number(smtp.port || 587),
        secure: Number(smtp.port) === 465,
        requireTLS: production && Number(smtp.port) !== 465,
        disableFileAccess: true,
        disableUrlAccess: true,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
        ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
      })
    : null;
  if (production && !transport)
    throw new Error('Production requires SMTP_HOST and mail delivery configuration.');
  let busy = false;
  return {
    configured: !!transport,
    async flush() {
      if (busy || !transport) return;
      busy = true;
      try {
        for (const item of db
          .prepare(
            "SELECT * FROM outbox WHERE status IN ('Pending','Failed') AND attempts<5 ORDER BY created_at LIMIT 50",
          )
          .all()) {
          try {
            await transport.sendMail({
              from,
              to: item.recipient,
              subject: item.subject,
              html: item.html,
              messageId: `<${item.id}@brightloop.local>`,
            });
            db.prepare(
              "UPDATE outbox SET status='Sent',error=NULL,attempts=attempts+1 WHERE id=?",
            ).run(item.id);
          } catch {
            db.prepare(
              "UPDATE outbox SET status='Failed',error='SMTP delivery failed; check server mail configuration.',attempts=attempts+1 WHERE id=?",
            ).run(item.id);
          }
        }
      } finally {
        busy = false;
      }
    },
    close() {
      transport?.close();
    },
  };
}
