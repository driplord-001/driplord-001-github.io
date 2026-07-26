const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// Admin middleware (hardcoded email check)
const isAdmin = async (req, res, next) => {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', req.user.id)
    .single();

  if (error || !user) return res.status(403).json({ message: 'Access denied.' });
  if (user.email === 'admin@gmail.com') {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required.' });
  }
};

// Get all users
router.get('/users', verifyToken, isAdmin, async (req, res) => {
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('id, email, first_name, last_name, phone, country, balance, verified, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ message: 'Failed to fetch users.' });
  }

  res.json({ users });
});

// Get all OTP records
router.get('/otps', verifyToken, isAdmin, async (req, res) => {
  const { data: otps, error } = await supabaseAdmin
    .from('otp_codes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Admin OTPs error:', error);
    return res.status(500).json({ message: 'Failed to fetch OTPs.' });
  }

  res.json({ otps });
});

// Update user balance
router.patch('/users/:userId/balance', verifyToken, isAdmin, async (req, res) => {
  const { userId } = req.params;
  const { amount } = req.body;

  if (amount === undefined || isNaN(parseFloat(amount))) {
    return res.status(400).json({ message: 'Valid amount is required.' });
  }

  const newBalance = parseFloat(amount);
  const { data: updated, error } = await supabaseAdmin
    .from('users')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id, email, balance')
    .single();

  if (error) {
    console.error('Balance update error:', error);
    return res.status(500).json({ message: 'Failed to update balance.' });
  }

  res.json({ message: 'Balance updated successfully.', user: updated });
});

module.exports = router;
