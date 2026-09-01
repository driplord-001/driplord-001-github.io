const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

router.post('/support/send', verifyToken, async (req, res) => {
  console.log('📩 Received support message request');
  console.log('📦 Request body:', req.body);
  console.log('👤 User ID:', req.user.id);

  const { message } = req.body;
  const userId = req.user.id;

  if (!message || message.trim().length < 3) {
    console.log('❌ Message too short');
    return res.status(400).json({ message: 'Message must be at least 3 characters.' });
  }

  // Get user email
  console.log(`👤 Fetching user ${userId} email`);
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    console.error('❌ User fetch error:', userError);
    return res.status(404).json({ message: 'User not found. Error: ' + (userError?.message || 'No user') });
  }

  console.log(`✅ User found: ${user.email}`);

  // Insert message
  console.log('💾 Inserting support message into support_messages');
  const { data, error } = await supabaseAdmin
    .from('support_messages')
    .insert({
      user_id: userId,
      email: user.email,
      message: message.trim(),
      is_read: false
    })
    .select('id, created_at')
    .single();

  if (error) {
    console.error('❌ Insert error:', error);
    console.error('❌ Error details:', JSON.stringify(error, null, 2));
    return res.status(500).json({ 
      message: 'Failed to send message. Database error: ' + error.message,
      details: error
    });
  }

  console.log('✅ Message inserted, ID:', data.id);
  res.status(201).json({ message: 'Message sent successfully.', data });
});

// ... other routes (my-messages, admin messages, reply) stay the same ...
// Make sure they also have detailed logging.

module.exports = router;
