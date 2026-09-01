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
// CORS CONFIGURATION – Allow your frontend domains
// ============================================================
const allowedOrigins = [
  'http://localhost:5500',
  'http://localhost:3000',
  'https://resplendent-platypus-de88a4.netlify.app',
  'https://precious-cobbler-0a0716.netlify.app',
  'https://driplord-001-github-io.onrender.com',
  'https://adorable-sprite-692f2f.netlify.app',
  'https://kimzzy-static-site.netlify.app',   // ✅ Your new frontend
  process.env.FRONTEND_URL                     // fallback from environment
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl)
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

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all incoming requests with details
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  console.log('📦 Headers:', req.headers);
  if (req.body && Object.keys(req.body).length) {
    console.log('📦 Body:', req.body);
  }
  next();
});

// ============================================================
// DEBUG / DIAGNOSTIC ENDPOINTS
// ============================================================

// 1. Basic debug – returns request info and tests CORS
app.get('/api/debug', (req, res) => {
  res.json({
    message: 'Backend is reachable!',
    headers: req.headers,
    origin: req.headers.origin,
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });
});

// Also handle OPTIONS for CORS preflight
app.options('/api/debug', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

// 2. Check if support_messages table exists
app.get('/api/check-table', async (req, res) => {
  try {
    const { supabaseAdmin } = require('./supabase/client');
    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .select('id')
      .limit(1);
    if (error) {
      return res.json({ exists: false, error: error.message });
    }
    res.json({ exists: true, data });
  } catch (err) {
    res.json({ exists: false, error: err.message });
  }
});

// 3. Environment check (shows which env vars are set, without exposing secrets)
app.get('/api/env-check', (req, res) => {
  const envStatus = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    JWT_SECRET: !!process.env.JWT_SECRET,
    BREVO_API_KEY: !!process.env.BREVO_API_KEY,
    BREVO_FROM_EMAIL: !!process.env.BREVO_FROM_EMAIL,
    FRONTEND_URL: process.env.FRONTEND_URL || 'not set',
    NODE_ENV: process.env.NODE_ENV || 'development'
  };
  res.json(envStatus);
});

// ============================================================
// ROUTES
// ============================================================
app.use('/api', authRoutes);          // /api/login, /api/register, /api/verify-otp
app.use('/api', userRoutes);          // /api/me, /api/update-profile
app.use('/api/admin', adminRoutes);   // /api/admin/users, /api/admin/otps, /api/admin/users/:id/balance
app.use('/api', withdrawRoutes);      // /api/withdraw
app.use('/api', transactionsRoutes);  // /api/transactions
app.use('/api', investRoutes);        // /api/invest, /api/investments
app.use('/api', supportRoutes);       // /api/support/*, /api/admin/support/*

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
  console.log('❌ 404 - Route not found:', req.method, req.url);
  res.status(404).json({ message: 'Route not found' });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`📦 Routes loaded: auth, user, admin, withdraw, transactions, invest, support`);
  console.log(`🔧 Debug endpoints: /api/debug, /api/check-table, /api/env-check`);
  console.log(`🩺 Health: /api/health`);
});
