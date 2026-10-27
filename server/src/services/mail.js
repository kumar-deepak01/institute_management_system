const nodemailer = require('nodemailer');

function isEmailServiceConfigured() {
  if (process.env.BREVO_API_KEY && process.env.MAIL_FROM) {
    return true;
  }
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const mailFrom = process.env.MAIL_FROM;
  return Boolean(host && process.env.SMTP_PORT && Number.isInteger(port) && user && pass && mailFrom);
}

function buildEmailContent(otp) {
  const subject = 'Your My JEE Mentor password reset code';
  const text = `Your My JEE Mentor password reset code is ${otp}. It is valid for 10 minutes. If you did not request this, ignore this email.`;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #fed7aa; border-radius: 12px; padding: 28px; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
    <div style="margin-bottom: 20px;">
      <h2 style="color: #ea580c; margin: 0; font-size: 22px; font-weight: 700;">My JEE Mentor</h2>
      <p style="color: #64748b; font-size: 14px; margin: 4px 0 0 0;">Password Reset Verification</p>
    </div>
    <p style="color: #334155; font-size: 15px; line-height: 1.5; margin: 0 0 16px 0;">
      Use the one-time verification code below to reset your password:
    </p>
    <div style="background-color: #fff7ed; border: 2px dashed #fdba74; border-radius: 8px; padding: 18px; text-align: center; margin: 20px 0;">
      <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #ea580c;">${otp}</span>
    </div>
    <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0 0 12px 0;">
      This code is valid for <strong>10 minutes</strong> and can only be used once.
    </p>
    <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0; border-top: 1px solid #f1f5f9; padding-top: 14px;">
      If you did not request this, you can safely ignore this email. Your password will remain unchanged.
    </p>
  </div>
</body>
</html>`;
  return { subject, text, html };
}

async function sendViaBrevoHttp({ email, otp, apiKey, mailFrom, mailFromName }) {
  const { subject, text, html } = buildEmailContent(otp);
  const payload = {
    sender: {
      name: mailFromName,
      email: mailFrom,
    },
    to: [
      {
        email,
      },
    ],
    subject,
    textContent: text,
    htmlContent: html,
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000), // 10 second timeout
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.message || errJson.code || JSON.stringify(errJson);
    } catch (_) {
      try {
        errorDetail = await response.text();
      } catch (_) {
        errorDetail = 'Could not parse response body';
      }
    }
    console.error(`[Brevo API Error] HTTP ${response.status}: ${errorDetail}`);
    const error = new Error(`Brevo API responded with HTTP ${response.status}: ${errorDetail}`);
    error.status = response.status;
    error.code = 'BREVO_API_ERROR';
    throw error;
  }

  const result = await response.json().catch(() => ({}));
  const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
  console.log(`[Brevo API] Password reset email sent to ${maskedEmail} (MessageId: ${result.messageId || 'OK'})`);
  return result;
}

function createSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !process.env.SMTP_PORT || !Number.isInteger(port) || !user || !pass || !process.env.MAIL_FROM) {
    const error = new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM.');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: { user, pass },
  });
}

async function sendViaSmtp(email, otp) {
  const transporter = createSmtpTransport();
  const { subject, text, html } = buildEmailContent(otp);
  try {
    return await transporter.sendMail({
      from: process.env.MAIL_FROM_NAME
        ? `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`
        : process.env.MAIL_FROM,
      to: email,
      subject,
      text,
      html,
    });
  } finally {
    transporter.close();
  }
}

async function sendPasswordResetOtp(email, otp) {
  const brevoApiKey = (process.env.BREVO_API_KEY || '').trim();
  const mailFrom = (process.env.MAIL_FROM || '').trim();
  const mailFromName = (process.env.MAIL_FROM_NAME || 'My JEE Mentor').trim();

  if (brevoApiKey) {
    if (!mailFrom) {
      const error = new Error('MAIL_FROM environment variable is required when using BREVO_API_KEY.');
      error.code = 'MAIL_FROM_MISSING';
      console.error('[Brevo API Configuration Error] ' + error.message);
      throw error;
    }
    return sendViaBrevoHttp({ email, otp, apiKey: brevoApiKey, mailFrom, mailFromName });
  }

  // Fallback to SMTP if BREVO_API_KEY is not set
  return sendViaSmtp(email, otp);
}

module.exports = {
  sendPasswordResetOtp,
  isEmailServiceConfigured,
};
