const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { smtpHost, smtpPort, smtpUser, smtpPassword, emailTransporter } = require('../config/smtp');
const { s3Client, storage, upload, PutObjectCommand } = require('../config/s3');
const { authenticateToken } = require('../middleware/auth');


require('dotenv').config();
secretKey = process.env.JWT_SECRET_KEY;

const router = express.Router();
