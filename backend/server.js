require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import all route modules
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const withdrawRoutes = require('./routes/withdraw');
const transactionsRoutes = require('./routes/transactions');
const investRoutes = require('./routes/invest');
// const supportRoutes = require('./routes/support'); // ← COMMENTED OUT

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
const allowedOrigins = [
  'http://localhost:5500',
  'http://localhost:3000',
  'https://resplendent-platypus-de88a4.netlify.app',
  'https://precious-cobbler-0a0716.netlify.app',
  'https://driplord-001-github-io.onrender.com',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('❌ Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', withdrawRoutes);
app.use('/api', transactionsRoutes);
app.use('/api', investRoutes);
// app.use('/api', supportRoutes); // ← COMMENTED OUT

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`📦 Routes loaded: auth, user, admin, withdraw, transactions, invest`);
});
