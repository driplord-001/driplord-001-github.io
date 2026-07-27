// routes/withdraw.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// POST /api/withdraw
router.post('/withdraw', verifyToken, async (req, res) => {
  const { amount, method, details } = req.body;
  const userId = req.user.id;

  // Validate
  if (!amount || amount < 10) {
    return res.status(400).json({ message: 'Invalid amount (minimum $10).' });
  }
  if (!method || !['crypto', 'bank'].includes(method)) {
    return res.status(400).json({ message: 'Invalid withdrawal method.' });
  }

  try {
    // Get current balance
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const currentBalance = parseFloat(user.balance || 0);
    if (amount > currentBalance) {
      return res.status(400).json({ message: 'Insufficient balance.' });
    }

    // Deduct balance
    const newBalance = currentBalance - amount;
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId);

    if (updateError) {
      console.error('Balance update error:', updateError);
      return res.status(500).json({ message: 'Failed to update balance.' });
    }

    // Record withdrawal (you need a 'withdrawals' table)
    const { data: withdrawal, error: wdError } = await supabaseAdmin
      .from('withdrawals')
      .insert({
        user_id: userId,
        amount: amount,
        method: method,
        details: details,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (wdError) {
      // Rollback balance
      await supabaseAdmin
        .from('users')
        .update({ balance: currentBalance })
        .eq('id', userId);
      console.error('Withdrawal record error:', wdError);
      return res.status(500).json({ message: 'Failed to create withdrawal record.' });
    }

    res.status(201).json({
      message: 'Withdrawal submitted successfully.',
      withdrawalId: withdrawal.id,
      newBalance: newBalance
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;
