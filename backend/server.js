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
const supportRoutes = require('./routes/support');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CORS CONFIGURATION – Allow ALL origins (no restrictions)
// ============================================================
app.use(cors({
  origin: '*',  // Allow any domain to access your API
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url} from ${req.headers.origin || 'unknown'}`);
  next();
});

// ============================================================
// ROUTES
// ============================================================
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', withdrawRoutes);
app.use('/api', transactionsRoutes);
app.use('/api', investRoutes);
app.use('/api', supportRoutes);

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ============================================================
// CATCH‑ALL FOR UNDEFINED ROUTES
// ============================================================
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 CORS: All origins allowed`);
  console.log(`📦 Routes loaded: auth, user, admin, withdraw, transactions, invest, support`);
});
