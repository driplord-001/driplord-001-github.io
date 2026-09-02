require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import route modules
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
// FORCE CORS HEADERS – Must be FIRST (BEFORE any routes)
// ============================================================
app.use((req, res, next) => {
  // Allow your frontend
  res.header('Access-Control-Allow-Origin', 'https://fxsmartbull.netlify.app');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Handle preflight OPTIONS requests immediately
  if (req.method === 'OPTIONS') {
    console.log('✅ OPTIONS preflight handled for:', req.url);
    return res.sendStatus(200);
  }

  next();
});

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length) {
    console.log('📦 Body:', req.body);
  }
  next();
});

// ============================================================
// DEBUG ENDPOINTS
// ============================================================
app.get('/api/debug', (req, res) => {
  res.json({
    message: 'Backend is reachable!',
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/check-table', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./supabase/client');
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('id')
      .limit(1);
    if (error) return res.json({ exists: false, error: error.message });
    res.json({ exists: true, data });
  } catch (err) {
    res.json({ exists: false, error: err.message });
  }
});

app.get('/api/env-check', (req, res) => {
  res.json({
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    JWT_SECRET: !!process.env.JWT_SECRET,
    FRONTEND_URL: process.env.FRONTEND_URL || 'not set'
  });
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
// HEALTH
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// 404 HANDLER
// ============================================================
app.use((req, res) => {
  console.log('❌ 404:', req.method, req.url);
  res.status(404).json({ message: 'Route not found' });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📦 Routes loaded: auth, user, admin, withdraw, transactions, invest, support`);
});
