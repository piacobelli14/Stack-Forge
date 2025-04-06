const nodemailer = require('nodemailer');
const smtpHost = process.env.SMTP_HOST || 'host';
const smtpPort = process.env.SMTP_PORT || 800;
const smtpUser = process.env.SMTP_USER || 'user';
const smtpPassword = process.env.SMTP_PASSWORD || 'password';

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: false,
  auth: {
    user: smtpUser,
    pass: smtpPassword
  },
  tls: {
    ciphers: 'SSLv3'
  }
});

module.exports = { emailTransporter: transporter };
