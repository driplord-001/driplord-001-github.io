const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');
const axios = require('axios'); // for email

// ============================================================
// Admin middleware – checks for admin email
// ============================================================
const isAdmin = async (req, res, next) => {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', req.user.id)
    .single();

  if (error || !user) return res.status(403).json({ message: 'Access denied.' });
  // Allow both admin@gmail.com and katejackson00001@gmail.com
  if (user.email === 'admin@gmail.com' || user.email === 'katejackson00001@gmail.com') {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required.' });
  }
};

// ============================================================
// GET /admin/users – all users with online status
// ============================================================
router.get('/users', verifyToken, isAdmin, async (req, res) => {
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ message: 'Failed to fetch users.' });
  }

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const usersWithStatus = users.map(user => ({
    ...user,
    online: user.last_active ? new Date(user.last_active) > fiveMinutesAgo : false
  }));

  res.json({ users: usersWithStatus });
});

// ============================================================
// GET /admin/otps – all OTP records
// ============================================================
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

// ============================================================
// PATCH /admin/users/:userId/balance – update user balance
// ============================================================
router.patch('/users/:userId/balance', verifyToken, isAdmin, async (req, res) => {
  const { userId } = req.params;
  const { amount } = req.body;

  if (amount === undefined || isNaN(parseFloat(amount))) {
    return res.status(400).json({ message: 'Valid amount is required.' });
  }

  const newBalance = parseFloat(amount);

  const { data: user, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('balance')
    .eq('id', userId)
    .single();

  if (fetchError || !user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const oldBalance = parseFloat(user.balance || 0);
  const difference = newBalance - oldBalance;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('users')
    .update({ 
      balance: newBalance, 
      updated_at: new Date().toISOString() 
    })
    .eq('id', userId)
    .select('id, email, balance')
    .single();

  if (updateError) {
    console.error('Balance update error:', updateError);
    return res.status(500).json({ message: 'Failed to update balance.' });
  }

  if (difference !== 0) {
    const { error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: difference > 0 ? 'deposit' : 'withdrawal',
        amount: Math.abs(difference),
        method: 'admin',
        details: { note: `Balance adjusted by admin from ${oldBalance.toFixed(2)} to ${newBalance.toFixed(2)}` },
        status: 'completed'
      });

    if (txError) {
      console.error('Transaction log error:', txError);
    }
  }

  res.json({
    message: `Balance updated successfully (${difference > 0 ? '+' : ''}${difference.toFixed(2)}).`,
    user: updated
  });
});

// ============================================================
// NEW: GET /admin/transactions/pending – fetch pending withdrawals
// ============================================================
router.get('/admin/transactions/pending', verifyToken, isAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*, users(email, first_name, last_name)')
    .eq('type', 'withdrawal')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Fetch pending withdrawals error:', error);
    return res.status(500).json({ message: 'Failed to fetch pending withdrawals.' });
  }

  res.json({ transactions: data });
});

// ============================================================
// NEW: PATCH /admin/transactions/:transactionId/status – update status
// ============================================================
router.patch('/admin/transactions/:transactionId/status', verifyToken, isAdmin, async (req, res) => {
  const { transactionId } = req.params;
  const { status, admin_notes } = req.body;

  const validStatuses = ['pending', 'completed', 'failed', 'cancelled', 'draft'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
  }

  try {
    // Get the transaction with user details
    const { data: transaction, error: fetchError } = await supabaseAdmin
      .from('transactions')
      .select('*, users(email, first_name, last_name)')
      .eq('id', transactionId)
      .single();

    if (fetchError || !transaction) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    // Prepare update object
    const updates = {
      status,
      updated_at: new Date().toISOString(),
      admin_notes: admin_notes || transaction.admin_notes || null
    };

    // If completed/failed/cancelled, set processed_at
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      updates.processed_at = new Date().toISOString();
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('transactions')
      .update(updates)
      .eq('id', transactionId)
      .select('*, users(email, first_name, last_name)')
      .single();

    if (updateError) {
      console.error('Status update error:', updateError);
      return res.status(500).json({ message: 'Failed to update status.' });
    }

    // Send email notification if status is not draft or pending
    if (status !== 'draft' && status !== 'pending') {
      await sendTransactionStatusEmail(updated);
    }

    res.json({
      message: `Transaction status updated to ${status}`,
      transaction: updated
    });

  } catch (err) {
    console.error('Admin status update error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ============================================================
// Email helper for transaction status notifications
// ============================================================
const sendTransactionStatusEmail = async (transaction) => {
  try {
    const user = transaction.users;
    const { amount, method, status, id, admin_notes, details } = transaction;

    const statusMessages = {
      completed: {
        subject: '✅ Withdrawal Completed – Cresta Markets',
        color: '#00C853',
        icon: '✅',
        message: 'Your withdrawal has been successfully processed and funds have been sent.'
      },
      failed: {
        subject: '❌ Withdrawal Failed – Cresta Markets',
        color: '#FF3D57',
        icon: '❌',
        message: 'Your withdrawal request could not be processed. Please contact support.'
      },
      cancelled: {
        subject: '🚫 Withdrawal Cancelled – Cresta Markets',
        color: '#f59e0b',
        icon: '🚫',
        message: 'Your withdrawal request has been cancelled.'
      }
    };

    const statusInfo = statusMessages[status];
    if (!statusInfo) return false;

    const methodDisplay = method === 'crypto' ? 'Cryptocurrency' : 'Bank Transfer';
    const detailSummary = method === 'crypto'
      ? `Currency: ${details?.currency || 'BTC'}<br>Wallet: ${details?.walletAddress || 'N/A'}<br>Network: ${details?.network || 'N/A'}`
      : `Bank: ${details?.bankName || 'N/A'}<br>Account: ${details?.accountNumber || 'N/A'}<br>Holder: ${details?.accountHolder || 'N/A'}`;

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0A0A0A; color: #fff; padding: 30px; border-radius: 16px; border: 1px solid ${statusInfo.color};">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: ${statusInfo.color}; font-weight: 800; font-size: 28px; letter-spacing: 2px; margin: 0;">Cresta Markets</h1>
          <hr style="border-color: rgba(59,130,246,0.2);" />
        </div>
        <h2 style="color: ${statusInfo.color}; margin-top: 0;">${statusInfo.icon} Withdrawal ${status.charAt(0).toUpperCase() + status.slice(1)}</h2>
        <p style="color: #ddd;">Hello ${user?.first_name || 'Trader'},</p>
        <p style="color: #ddd;">${statusInfo.message}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; color: #fff;">
          <tr style="border-bottom: 1px solid rgba(59,130,246,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Amount</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${statusInfo.color};">$${parseFloat(amount).toFixed(2)}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(59,130,246,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Method</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600;">${methodDisplay}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(59,130,246,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Withdrawal ID</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600;">#${id}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(59,130,246,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Status</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${statusInfo.color};">${status.toUpperCase()}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(59,130,246,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Details</td>
            <td style="padding: 8px 0; text-align: right; font-size: 13px; color: #ccc;">${detailSummary}</td>
          </tr>
          ${admin_notes ? `
          <tr style="border-bottom: 1px solid rgba(59,130,246,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Admin Notes</td>
            <td style="padding: 8px 0; text-align: right; font-size: 13px; color: #f59e0b;">${admin_notes}</td>
          </tr>
          ` : ''}
        </table>
        <p style="color: #ddd;">If you have any questions, please contact our support team.</p>
        <hr style="border-color: rgba(59,130,246,0.1);" />
        <p style="color: #666; font-size: 12px; text-align: center;">This is an automated message. Do not reply.</p>
        <p style="color: #666; font-size: 12px; text-align: center;">© 2026 Cresta Markets. All rights reserved.</p>
      </div>
    `;

    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.BREVO_FROM_EMAIL || 'Cresta Markets <jimmydarts404@gmail.com>';
    const fromAddress = fromEmail.split('<')[1]?.replace('>', '') || fromEmail;

    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'Cresta Markets', email: fromAddress },
        to: [{ email: user.email }],
        subject: statusInfo.subject,
        htmlContent: emailHtml
      },
      {
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ Status email sent for transaction #${id}: ${status}`);
    return true;
  } catch (error) {
    console.error('Status email error:', error.response?.data || error.message);
    return false;
  }
};

module.exports = router;
