const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../supabase/client');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ---------- Helper: generate 6-digit OTP ----------
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ---------- Helper: send OTP email ----------
const sendOTPEmail = async (email, otp) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'FX SMARTBULL <noreply@yourdomain.com>',
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

// ---------- Register step 1: send OTP ----------
router.post('/register', async (req, res) => {
  const { email, firstName, lastName, phone, country } = req.body;

  // Validation
  if (!email || !firstName || !lastName) {
    return res.status(400).json({ message: 'Email, first name, and last name are required.' });
  }

  // Check if email already exists (and verified)
  const { data: existingUser, error: checkError } = await supabaseAdmin
    .from('users')
    .select('email, verified')
    .eq('email', email)
    .maybeSingle();

  if (existingUser) {
    if (existingUser.verified) {
      return res.status(409).json({ message: 'Email already registered.' });
    }
    // If not verified, we allow re-sending OTP but we'll overwrite old OTP
  }

  // Generate OTP
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Store or update OTP in database
  const { error: upsertError } = await supabaseAdmin
    .from('otp_codes')
    .upsert({
      email,
      code: otp,
      expires_at: expiresAt.toISOString()
    }, { onConflict: 'email' });

  if (upsertError) {
    console.error('OTP upsert error:', upsertError);
    return res.status(500).json({ message: 'Failed to generate OTP. Please try again.' });
  }

  // Send OTP email
  const sent = await sendOTPEmail(email, otp);
  if (!sent) {
    return res.status(500).json({ message: 'Failed to send OTP email. Please try again later.' });
  }

  // Store temporary registration data (optional: you can store in session or just rely on email for verification)
  // We'll pass firstName, lastName, phone, country in the next step (verify-otp) to finalize creation.

  res.status(200).json({ message: 'OTP sent to your email.' });
});

// ---------- Register step 2: verify OTP and create account ----------
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

// ---------- Login ----------
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

module.exports = router;