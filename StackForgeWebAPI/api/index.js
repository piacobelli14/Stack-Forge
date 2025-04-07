const express = require('express');   
const cors = require('cors'); 
const path = require('path');
const compression = require('compression');
const bodyParser = require('body-parser'); 
const { pool } = require('./config/db');
const errorLogger = require('./middleware/errorLogger');
const authenticationRoutes = require('./routes/stackforge-authentication');
const profileRoutes = require('./routes/stackforge-profile');

require('dotenv').config();

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(compression());
app.use(cors({ 
  optionsSuccessStatus: 200, 
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type', 'Authorization'] 
}));
app.use(bodyParser.json({ limit: '1gb' }));
app.use(errorLogger);
app.use(authenticationRoutes);
app.use(profileRoutes);

app.set('trust proxy', 1);

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Server is running on port: ${port}.`);
});

const shutdown = () => {
  console.log('Received shutdown signal. Shutting down gracefully...');
  server.close(() => {
    console.log('Closed all remaining connections.');
    pool.end(() => {
      console.log('PostgreSQL pool has been closed.');
      process.exit(0); 
    });
  });
};

process.on('SIGINT', shutdown); 
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});