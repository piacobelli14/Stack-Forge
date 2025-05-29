const jwt = require('jsonwebtoken');
const secretKey = process.env.JWT_SECRET_KEY || 'secret-key';

function authenticateToken(req, res, next) {
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, secretKey, (error, decoded) => {
    if (error) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ error: 'Access denied. Invalid token.' });
    } else {
      req.user = decoded;
      next();
    }
  });
}

module.exports = { authenticateToken };
