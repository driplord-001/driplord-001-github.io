const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../supabase/client');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ============================================================
// HELPERS
// ============================================================
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOTPEmail = async (email, otp) => {
  try {
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'FX SMARTBULL <onboarding@resend.dev>';
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [email],
      subject: 'Your FX SMARTBULL Verification Code',
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

// ============================================================
// REGISTER – step 1: send OTP
// ============================================================
router.post('/register', async (req, res) => {
  const { email, firstName, lastName, phone, country } = req.body;

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ message: 'Email, first name, and last name are required.' });
  }

  // Check if already verified
  const { data: existing, error: checkError } = await supabaseAdmin
    .from('users')
    .select('email, verified')
    .eq('email', email)
    .maybeSingle();

  if (existing && existing.verified) {
    return res.status(409).json({ message: 'Email already registered.' });
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
    console.error('OTP insert error:', insertError);
    return res.status(500).json({ message: 'Failed to generate OTP. Please try again.' });
  }

  // Send OTP email
  const sent = await sendOTPEmail(email, otp);
  if (!sent) {
    return res.status(500).json({ message: 'Failed to send OTP email. Please try again later.' });
  }

  res.status(200).json({ message: 'OTP sent to your email.' });
});

// ============================================================
// REGISTER – step 2: verify OTP and create account
// ============================================================
router.post('/verify-otp', async (req, res) => {
  const { email, otp, firstName, lastName, phone, country, password } = req.body;

  if (!email || !otp || !firstName || !lastName || !password) {
    return res.status(400).json({ message: 'Email, OTP, first name, last name, and password are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  // Verify OTP
  const { data: otpRecord, error: otpError } = await supabaseAdmin
    .from('otp_codes')
    .select('*')
    .eq('email', email)
    .eq('code', otp)
    .single();

  if (otpError || !otpRecord) {
    return res.status(400).json({ message: 'Invalid OTP.' });
  }

  if (new Date(otpRecord.expires_at) < new Date()) {
    return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
  }

  // Delete OTP after use
  await supabaseAdmin.from('otp_codes').delete().eq('email', email);

  // Check if user already exists (unverified)
  const { data: existingUser, error: userCheckError } = await supabaseAdmin
    .from('users')
    .select('id, verified')
    .eq('email', email)
    .maybeSingle();

  if (existingUser && existingUser.verified) {
    return res.status(409).json({ message: 'Email already registered.' });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  let userId;
  if (existingUser && !existingUser.verified) {
    // Update existing unverified user
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        country: country || null,
        password_hash: passwordHash,
        verified: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingUser.id)
      .select('id')
      .single();

    if (updateError || !updated) {
      console.error('Update user error:', updateError);
      return res.status(500).json({ message: 'Failed to update user. Please try again.' });
    }
    userId = updated.id;
  } else {
    // Create new user
    const { data: newUser, error: createError } = await supabaseAdmin
      .from('users')
      .insert({
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        country: country || null,
        password_hash: passwordHash,
        verified: true,
        balance: 0.00
      })
      .select('id')
      .single();

    if (createError || !newUser) {
      console.error('Create user error:', createError);
      return res.status(500).json({ message: 'Failed to create account. Please try again.' });
    }
    userId = newUser.id;
  }

  // Generate JWT
  const token = jwt.sign(
    { id: userId, email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    message: 'Account created successfully.',
    token,
    user: { id: userId, email, firstName, lastName }
  });
});

// ============================================================
// LOGIN
// ============================================================
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  // Fetch user
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, email, first_name, last_name, password_hash, verified')
    .eq('email', email)
    .maybeSingle();

  if (error || !user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  if (!user.verified) {
    return res.status(401).json({ message: 'Please verify your email first.' });
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  // Generate JWT
  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    message: 'Login successful.',
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name
    }
  });
});

// ============================================================
// TEMPORARY – Create admin user (remove after use)
// ============================================================
router.post('/create-admin', async (req, res) => {
  try {
    const email = 'admin@gmail.com';
    const password = '123456';
    const hash = await bcrypt.hash(password, 10);

    // Upsert admin
    const { data, error } = await supabaseAdmin
      .from('users')
      .upsert({
        email,
        first_name: 'Admin',
        last_name: 'User',
        password_hash: hash,
        verified: true,
        balance: 10000,
        created_at: new Date().toISOString()
      }, { onConflict: 'email' })
      .select('id')
      .single();

    if (error) throw error;
    res.json({ message: 'Admin created/updated successfully', admin: data });
  } catch (err) {
    console.error('Admin creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
