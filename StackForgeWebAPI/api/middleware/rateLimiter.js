const rateLimit = require('express-rate-limit');

/**
* @param {number|null} minutes
* @param {number} maxAttempts 
* @returns {function}
*/

const rateLimiter = (minutes = null, maxAttempts) => {
    const options = {
        max: maxAttempts,
        message: (req) => `Rate limit exceeded: ${req.originalUrl}. Please try again in ${minutes} minutes.`,
        standardHeaders: true,
        legacyHeaders: false,
    };

    if (minutes !== null) {
        options.windowMs = minutes * 60 * 1000; 
    }

    return rateLimit(options);
};

const authRateLimitExceededHandler = (req, res) => {
    res.status(429).json({
        error: true,
        message: `Rate limit exceeded. Please try again in ${minutes} minutes.`,
    });
};

module.exports = { rateLimiter, authRateLimitExceededHandler };
