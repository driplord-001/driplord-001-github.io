const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

router.post('/withdraw', verifyToken, async (req, res) => {
  const { amount, method, details } = req.body;
  const userId = req.user.id;

  if (!amount || amount < 10) {
    return res.status(400).json({ message: 'Invalid amount (minimum $10).' });
  }
  if (!method || !['crypto', 'bank'].includes(method)) {
    return res.status(400).json({ message: 'Invalid withdrawal method.' });
  }

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('balance, email, first_name, last_name')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const currentBalance = parseFloat(user.balance || 0);
    if (amount > currentBalance) {
      return res.status(400).json({ message: 'Insufficient balance.' });
    }

    const newBalance = currentBalance - amount;
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ balance: newBalance })
      .eq('id', userId);

    if (updateError) {
      console.error('Balance update error:', updateError);
      return res.status(500).json({ message: 'Failed to update balance.' });
    }

    const { data: tx, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdrawal',
        amount: amount,
        method: method,
        details: details,
        status: 'pending'
      })
      .select('id')
      .single();

    if (txError) {
      await supabaseAdmin.from('users').update({ balance: currentBalance }).eq('id', userId);
      console.error('Transaction record error:', txError);
      return res.status(500).json({ message: 'Failed to create withdrawal record.' });
    }

    // ✅ NO EMAIL SENT HERE
    res.status(201).json({
      message: 'Withdrawal submitted successfully. Awaiting admin approval.',
      withdrawalId: tx.id,
      newBalance: newBalance
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;
