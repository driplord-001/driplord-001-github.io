const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper: generate OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Helper: send OTP email
const sendOTPEmail = async (email, otp) => {
  try {
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'FX SMARTBULL <onboarding@resend.dev>';
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [email],
      subject: 'Your FX SMARTBULL Verification Code (Admin)',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #0A0A0A; color: #D4AF37; padding: 30px; border-radius: 12px; border: 1px solid #D4AF37;">
          <h1 style="text-align: center;">FX SMARTBULL</h1>
          <p style="color: #ffffff;">Hello,</p>
          <p style="color: #ffffff;">Your verification code is:</p>
          <div style="text-align: center; font-size: 36px; font-weight: bold; letter-spacing: 4px; background: rgba(212,175,55,0.1); padding: 16px; border-radius: 8px; border: 1px solid #D4AF37; color: #D4AF37;">
            ${otp}
          </div>
          <p style="color: #ffffff; margin-top: 20px;">This code expires in 10 minutes.</p>
          <p style="color: #ffffff;">If you didn't request this, please ignore this email.</p>
        </div>
      `
    });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Email send error:', err);
    return false;
  }
};

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

// Send OTP to a specific email (admin only)
router.post('/send-otp', verifyToken, isAdmin, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  // Validate email format
  if (!email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ message: 'Invalid email address.' });
  }

  // Generate OTP
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // Delete existing OTP for this email
  await supabaseAdmin.from('otp_codes').delete().eq('email', email);

  // Insert new OTP
  const { error: insertError } = await supabaseAdmin
    .from('otp_codes')
    .insert({
      email,
      code: otp,
      expires_at: expiresAt.toISOString()
    });

  if (insertError) {
    console.error('Admin OTP insert error:', insertError);
    return res.status(500).json({ message: 'Failed to generate OTP.' });
  }

  // Send OTP email
  const sent = await sendOTPEmail(email, otp);
  if (!sent) {
    return res.status(500).json({ message: 'Failed to send OTP email.' });
  }

  res.json({ message: 'OTP sent successfully.', email });
});

module.exports = router;
