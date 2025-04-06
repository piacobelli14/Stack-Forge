const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');

require('dotenv').config();

const s3Client = new S3Client({
region: process.env.AWS_REGION,
credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
},
});
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

module.exports = { s3Client, storage, upload, PutObjectCommand };