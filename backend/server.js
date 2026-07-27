require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const withdrawRoutes = require('./routes/withdraw'); // <-- NEW

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CORS CONFIGURATION – Allow your frontend domains
// ============================================================
const allowedOrigins = [
  'http://localhost:5500',
  'http://localhost:3000',
  'https://resplendent-platypus-de88a4.netlify.app',
  'https://precious-cobbler-0a0716.netlify.app', // your current frontend
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

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log incoming requests
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// ============================================================
// ROUTES
// ============================================================
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', withdrawRoutes); // <-- NEW withdrawal route

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Allowed origins: ${allowedOrigins.join(', ')}`);
});
