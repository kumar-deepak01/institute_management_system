const nodemailer = require('nodemailer');

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !process.env.SMTP_PORT || !Number.isInteger(port) || !user || !pass || !process.env.MAIL_FROM) {
    const error = new Error('Password reset email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM.');
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }
  return nodemailer.createTransport({ host, port, secure: port === 465, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, auth: { user, pass } });
}

async function sendPasswordResetOtp(email, otp) {
  const transporter = createTransport();
  try { await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'My JEE Mentor password reset code',
    text: `Your My JEE Mentor password reset code is ${otp}. It is valid for 10 minutes. If you did not request this, ignore this email.`,
    html: '<div style="font-family:Arial,sans-serif;color:#172554;max-width:560px;margin:auto"><h1 style="color:#245ce5">My JEE Mentor</h1><p>Use this one-time code to reset your password:</p><p style="font-size:30px;letter-spacing:8px;font-weight:bold">' + otp + '</p><p>This code is valid for 10 minutes. If you did not request it, you can ignore this email.</p></div>',
  }); } finally { transporter.close(); }
}

module.exports = { sendPasswordResetOtp };
