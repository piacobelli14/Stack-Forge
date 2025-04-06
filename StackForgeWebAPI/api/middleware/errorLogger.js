const { pool } = require('../config/db');

const errorLogger = (req, res, next) => {
    res.on('finish', async () => {
        const statusCode = res.statusCode;

        if (statusCode >= 400) {
            const software = 'dinolabs_web_api'; 
            const route = req.originalUrl || req.url;
            const message = res.statusMessage || 'Error';
            const timestamp = new Date().toISOString();
            const ip_address = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;

            const insertErrorQuery = `
                INSERT INTO error_logs (software, route, status_code, message, timestamp, ip_address)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;

            try {
                await pool.query(insertErrorQuery, [
                    software,
                    route,
                    statusCode,
                    message,
                    timestamp,
                    ip_address,
                ]);
            } catch (dbError) {
                return; 
            }
        }
    });

    next();
};

module.exports = errorLogger;
