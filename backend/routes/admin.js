const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');
const axios = require('axios');

// ============================================================
// Admin Middleware
// ============================================================
const isAdmin = async (req, res, next) => {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', req.user.id)
    .single();

  if (error || !user) return res.status(403).json({ message: 'Access denied.' });
  if (user.email === 'admin@gmail.com' || user.email === 'katejackson00001@gmail.com') {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required.' });
  }
};

// ============================================================
// GET /admin/users – All users with online status
// ============================================================
router.get('/users', verifyToken, isAdmin, async (req, res) => {
  console.log('📥 Fetching all users...');
  try {
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const usersWithStatus = users.map(user => ({
      ...user,
      online: user.last_active ? new Date(user.last_active) > fiveMinutesAgo : false
    }));

    console.log(`✅ Found ${usersWithStatus.length} users`);
    res.json({ users: usersWithStatus });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ message: 'Failed to fetch users.' });
  }
});

// ============================================================
// GET /admin/otps – All OTP records
// ============================================================
router.get('/otps', verifyToken, isAdmin, async (req, res) => {
  console.log('📥 Fetching all OTPs...');
  try {
    const { data: otps, error } = await supabaseAdmin
      .from('otp_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    console.log(`✅ Found ${otps.length} OTPs`);
    res.json({ otps });
  } catch (err) {
    console.error('Admin OTPs error:', err);
    res.status(500).json({ message: 'Failed to fetch OTPs.' });
  }
});

// ============================================================
// PATCH /admin/users/:userId/balance – Update balance
// ============================================================
router.patch('/users/:userId/balance', verifyToken, isAdmin, async (req, res) => {
  const { userId } = req.params;
  const { amount } = req.body;

  if (amount === undefined || isNaN(parseFloat(amount))) {
    return res.status(400).json({ message: 'Valid amount is required.' });
  }

  const newBalance = parseFloat(amount);
  try {
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
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, email, balance')
      .single();

    if (updateError) throw updateError;

    if (difference !== 0) {
      await supabaseAdmin
        .from('transactions')
        .insert({
          user_id: userId,
          type: difference > 0 ? 'deposit' : 'withdrawal',
          amount: Math.abs(difference),
          method: 'admin',
          details: { note: `Balance adjusted by admin from ${oldBalance.toFixed(2)} to ${newBalance.toFixed(2)}` },
          status: 'completed'
        });
    }

    res.json({
      message: `Balance updated successfully (${difference > 0 ? '+' : ''}${difference.toFixed(2)}).`,
      user: updated
    });
  } catch (err) {
    console.error('Balance update error:', err);
    res.status(500).json({ message: 'Failed to update balance.' });
  }
});

// ============================================================
// GET /admin/transactions/pending – Pending withdrawals
// ============================================================
router.get('/transactions/pending', verifyToken, isAdmin, async (req, res) => {
  console.log('📥 Fetching pending withdrawals...');
  try {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*, users(email, first_name, last_name)')
      .eq('type', 'withdrawal')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    console.log(`✅ Found ${data.length} pending withdrawals`);
    res.json({ transactions: data });
  } catch (err) {
    console.error('Fetch pending withdrawals error:', err);
    res.status(500).json({ message: 'Failed to fetch pending withdrawals.' });
  }
});

// ============================================================
// GET /admin/transactions/all – All transactions
// ============================================================
router.get('/transactions/all', verifyToken, isAdmin, async (req, res) => {
  console.log('📥 Fetching all transactions...');
  try {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*, users(email, first_name, last_name)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    console.log(`✅ Found ${data.length} total transactions`);
    res.json({ transactions: data });
  } catch (err) {
    console.error('Fetch all transactions error:', err);
    res.status(500).json({ message: 'Failed to fetch transactions.' });
  }
});

// ============================================================
// PATCH /admin/transactions/:transactionId/status – Update status & send email
// ============================================================
router.patch('/transactions/:transactionId/status', verifyToken, isAdmin, async (req, res) => {
  const { transactionId } = req.params;
  const { status, admin_notes } = req.body;

  const validStatuses = ['pending', 'completed', 'failed', 'cancelled', 'draft'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status.' });
  }

  try {
    const { data: transaction, error: fetchError } = await supabaseAdmin
      .from('transactions')
      .select('*, users(email, first_name, last_name)')
      .eq('id', transactionId)
      .single();

    if (fetchError || !transaction) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    const updates = {
      status,
      updated_at: new Date().toISOString(),
      admin_notes: admin_notes || transaction.admin_notes || null
    };

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
      return res.status(500).json({ message: 'Failed to update status. Error: ' + updateError.message });
    }

    // Send email for all statuses EXCEPT draft
    if (status !== 'draft') {
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
// EMAIL HELPER – FXSmartbull branding
// ============================================================
const sendTransactionStatusEmail = async (transaction) => {
  try {
    const user = transaction.users;
    const { amount, method, status, id, admin_notes, details } = transaction;

    const statusMessages = {
      pending: {
        subject: '⏳ Withdrawal Pending Review – FXSmartbull',
        color: '#f59e0b',
        icon: '⏳',
        message: 'Your withdrawal request is now pending admin review.'
      },
      completed: {
        subject: '✅ Withdrawal Completed – FXSmartbull',
        color: '#00C853',
        icon: '✅',
        message: 'Your withdrawal has been successfully processed and funds have been sent.'
      },
      failed: {
        subject: '❌ Withdrawal Failed – FXSmartbull',
        color: '#FF3D57',
        icon: '❌',
        message: 'Your withdrawal request could not be processed. Please contact support.'
      },
      cancelled: {
        subject: '🚫 Withdrawal Cancelled – FXSmartbull',
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
          <h1 style="color: ${statusInfo.color}; font-weight: 800; font-size: 28px; letter-spacing: 2px; margin: 0;">FXSmartbull</h1>
          <hr style="border-color: rgba(212,175,55,0.2);" />
        </div>
        <h2 style="color: ${statusInfo.color}; margin-top: 0;">${statusInfo.icon} Withdrawal ${status.charAt(0).toUpperCase() + status.slice(1)}</h2>
        <p style="color: #ddd;">Hello ${user?.first_name || 'Trader'},</p>
        <p style="color: #ddd;">${statusInfo.message}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; color: #fff;">
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Amount</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${statusInfo.color};">$${parseFloat(amount).toFixed(2)}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Method</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600;">${methodDisplay}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Withdrawal ID</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600;">#${id}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Status</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${statusInfo.color};">${status.toUpperCase()}</td>
          </tr>
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Details</td>
            <td style="padding: 8px 0; text-align: right; font-size: 13px; color: #ccc;">${detailSummary}</td>
          </tr>
          ${admin_notes ? `
          <tr style="border-bottom: 1px solid rgba(212,175,55,0.2);">
            <td style="padding: 8px 0; color: #aaa;">Admin Notes</td>
            <td style="padding: 8px 0; text-align: right; font-size: 13px; color: #f59e0b;">${admin_notes}</td>
          </tr>
          ` : ''}
        </table>
        <p style="color: #ddd;">If you have any questions, please contact our support team.</p>
        <hr style="border-color: rgba(212,175,55,0.1);" />
        <p style="color: #666; font-size: 12px; text-align: center;">This is an automated message. Do not reply.</p>
        <p style="color: #666; font-size: 12px; text-align: center;">© 2026 FXSmartbull. All rights reserved.</p>
      </div>
    `;

    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.BREVO_FROM_EMAIL || 'FXSmartbull <jimmydarts404@gmail.com>';
    const fromAddress = fromEmail.split('<')[1]?.replace('>', '') || fromEmail;

    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'FXSmartbull', email: fromAddress },
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
