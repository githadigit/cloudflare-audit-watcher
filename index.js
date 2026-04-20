import "dotenv/config";
import fs from "fs";
import { Resend } from "resend";
import nodemailer from "nodemailer";

const {
  CF_API_KEY,
  CF_EMAIL,
  CF_ACCOUNT_ID,

  MAIL_ENABLED,
  MAIL_PROVIDER,
  MAIL_FROM,
  ALERT_EMAILS,

  RESEND_API_KEY,

  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,

  SLACK_ENABLED,
  SLACK_WEBHOOK,
} = process.env;

// ===== VALIDATION =====
if (!CF_API_KEY || !CF_EMAIL || !CF_ACCOUNT_ID) {
  console.error("Cloudflare env eksik");
  process.exit(1);
}

if (MAIL_ENABLED === "true") {
  if (!MAIL_FROM) {
    console.error("MAIL_FROM eksik");
    process.exit(1);
  }

  if (!ALERT_EMAILS) {
    console.error("ALERT_EMAILS eksik");
    process.exit(1);
  }

  if (MAIL_PROVIDER === "smtp") {
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      console.error("SMTP config eksik");
      process.exit(1);
    }
  } else if (MAIL_PROVIDER === "resend") {
    if (!RESEND_API_KEY) {
      console.error("Resend config eksik");
      process.exit(1);
    }
  } else {
    console.error("MAIL_PROVIDER sadece 'resend' veya 'smtp' olabilir");
    process.exit(1);
  }
}

// ===== MAIL SETUP =====
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const smtpTransport =
  MAIL_PROVIDER === "smtp"
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT || 587),
        secure: SMTP_SECURE === "true",
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      })
    : null;

// ===== CONFIG =====
const STATE_FILE = "./state.json";
const INTERVAL = 30000;
const TIME_BUFFER_MS = 5000;

// ===== LOGGER =====
async function log(level, ...args) {
  const msg = args.join(" ");
  console.log(`[${level}]`, msg);

  if (SLACK_ENABLED === "true" && ["ALERT", "ERROR"].includes(level)) {
    try {
      await fetch(SLACK_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `[${level}] ${msg}` }),
      });
    } catch (err) {
      console.error("Slack log error:", err.message);
    }
  }
}

// ===== STATE =====
function getState() {
  if (!fs.existsSync(STATE_FILE)) {
    log("INFO", "state oluşturuluyor");
    return {
      lastTs: new Date(Date.now() - 60000).toISOString(),
      seenIds: [],
    };
  }

  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ===== FETCH =====
async function fetchLogs(since, until) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/audit_logs?since=${since}&until=${until}&per_page=50`;

  const res = await fetch(url, {
    headers: {
      "X-Auth-Email": CF_EMAIL,
      "X-Auth-Key": CF_API_KEY,
    },
  });

  if (!res.ok) {
    await log("ERROR", "API error:", res.status);
    return [];
  }

  const data = await res.json();
  return data.result || [];
}

// ===== HELPERS =====
function isDnsEvent(ev) {
  return ev.resource?.type === "dns.record";
}

function shouldSendMail(ev) {
  return ["update", "create", "delete"].includes(ev.action?.type);
}

// ===== FORMATTERS =====
function formatEvent(ev) {
  const user = ev.actor?.email || "unknown";
  const action = ev.action?.type || "unknown";
  const zone = ev.metadata?.zone_name || "unknown";
  const time = ev.when || "unknown";

  const recordName =
    ev.newValueJson?.name || ev.oldValueJson?.name || "unknown";

  const recordType =
    ev.newValueJson?.type || ev.oldValueJson?.type || "unknown";

  const before = ev.oldValueJson?.content;
  const after = ev.newValueJson?.content;

  let valueBlock = "";

  if (before && after && before !== after) {
    valueBlock = `<b>Old:</b> ${before}<br><b>New:</b> ${after}<br>`;
  } else if (!before && after) {
    valueBlock = `<b>New:</b> ${after}<br>`;
  } else if (after) {
    valueBlock = `<b>Value:</b> ${after}<br>`;
  }

  return `
    <div style="font-family:Arial, sans-serif; font-size:14px;">
      <b>DNS ${action.toUpperCase()}</b><br><br>
      <b>User:</b> ${user}<br>
      <b>Zone:</b> ${zone}<br>
      <b>Record:</b> ${recordName}<br>
      <b>Type:</b> ${recordType}<br><br>
      ${valueBlock}
      <b>Time:</b> ${time}
    </div>
  `;
}

function formatSlackEvent(ev) {
  const user = ev.actor?.email || "unknown";
  const action = ev.action?.type || "unknown";
  const zone = ev.metadata?.zone_name || "unknown";
  const record = ev.newValueJson?.name || ev.oldValueJson?.name || "unknown";
  const before = ev.oldValueJson?.content;
  const after = ev.newValueJson?.content;

  let value = "";

  if (before && after && before !== after) {
    value = `Old: ${before} → New: ${after}`;
  } else if (!before && after) {
    value = `New: ${after}`;
  } else if (after) {
    value = `Value: ${after}`;
  }

  return `DNS ${action.toUpperCase()}
User: ${user}
Zone: ${zone}
Record: ${record}
${value}`;
}

// ===== MAIL =====
async function sendMail(html) {
  if (MAIL_ENABLED !== "true") return;

  await log("INFO", "Mail gönderiliyor...");

  try {
    const recipients = ALERT_EMAILS.split(",").map((x) => x.trim());

    if (MAIL_PROVIDER === "smtp") {
      if (!smtpTransport) {
        throw new Error("SMTP transport oluşturulamadı");
      }

      await smtpTransport.sendMail({
        from: MAIL_FROM,
        to: recipients,
        subject: "DNS Değişikliği Bildirimi",
        html,
        envelope: {
          from: SMTP_USER,
          to: recipients,
        },
      });

      await log("ALERT", "SMTP mail gönderildi");
      return;
    }

    if (!resend) {
      throw new Error("Resend client oluşturulamadı");
    }

    await resend.emails.send({
      from: MAIL_FROM,
      to: recipients,
      subject: "DNS Değişikliği Bildirimi",
      html,
    });

    await log("ALERT", "Resend mail gönderildi");
  } catch (err) {
    await log("ERROR", "Mail error:", err.message);
  }
}

// ===== MAIN =====
async function run() {
  try {
    const state = getState();
    const now = new Date(Date.now() - TIME_BUFFER_MS).toISOString();

    await log("INFO", "CHECK:", new Date().toLocaleString());

    const logs = await fetchLogs(state.lastTs, now);

    await log("INFO", "logs:", logs.length);

    const events = [];

    for (const ev of logs) {
      if (state.seenIds.includes(ev.id)) continue;

      if (isDnsEvent(ev) && shouldSendMail(ev)) {
        await log("ALERT", formatSlackEvent(ev));
        events.push(ev);
      }

      state.seenIds.push(ev.id);
    }

    if (events.length > 0) {
      await sendMail(events.map(formatEvent).join("<hr>"));
    } else {
      await log("INFO", "no mail-worthy event");
    }

    state.lastTs = now;
    state.seenIds = state.seenIds.slice(-200);

    saveState(state);
  } catch (err) {
    await log("ERROR", err.message);
  }
}

setInterval(run, INTERVAL);
run();
