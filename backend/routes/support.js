const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { supabaseAdmin } = require('../supabase/client');

// ============================================================
// USER: Send a support message
// ============================================================
router.post('/support/send', verifyToken, async (req, res) => {
  console.log('📩 Received support message request');
  console.log('📦 Request body:', req.body);
  console.log('👤 User ID from token:', req.user.id);

  const { message } = req.body;
  const userId = req.user.id;

  // Validate message
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

  if (userError) {
    console.error('❌ User fetch error:', userError);
    return res.status(404).json({ message: 'User not found. Error: ' + userError.message });
  }

  if (!user) {
    console.error('❌ User not found for ID:', userId);
    return res.status(404).json({ message: 'User not found.' });
  }

  console.log(`✅ User found: ${user.email}`);

  // Insert message - use all columns that exist
  console.log('💾 Inserting support message into support_messages');
  const { data, error } = await supabaseAdmin
    .from('support_messages')
    .insert({
      user_id: userId,
      email: user.email,
      message: message.trim(),
      is_read: false,
      status: 'open',
      priority: 'normal'
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
  res.status(201).json({
    message: 'Message sent successfully.',
    data: data
  });
});

// ============================================================
// USER: Get user's own support messages (with replies)
// ============================================================
router.get('/support/my-messages', verifyToken, async (req, res) => {
  const userId = req.user.id;
  console.log(`📥 Fetching messages for user ${userId}`);

  const { data, error } = await supabaseAdmin
    .from('support_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Fetch error:', error);
    return res.status(500).json({ message: 'Failed to fetch messages. Error: ' + error.message });
  }

  // Mark messages as read when user views them
  await supabaseAdmin
    .from('support_messages')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  console.log(`✅ Found ${data.length} messages for user ${userId}`);
  res.json({ messages: data });
});

// ============================================================
// ADMIN: Get all support messages (with user details)
// ============================================================
router.get('/admin/support/messages', verifyToken, async (req, res) => {
  console.log('📥 Admin fetching all support messages');
  console.log('👤 Admin user ID:', req.user.id);

  // Verify admin
  const { data: user, error: adminCheck } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', req.user.id)
    .single();

  if (adminCheck) {
    console.error('❌ Admin check error:', adminCheck);
    return res.status(403).json({ message: 'Admin access required.' });
  }

  if (!user) {
    console.error('❌ User not found for admin check');
    return res.status(403).json({ message: 'Admin access required.' });
  }

  // Allow both admin@gmail.com and katejackson00001@gmail.com
  const adminEmails = ['admin@gmail.com', 'katejackson00001@gmail.com'];
  if (!adminEmails.includes(user.email)) {
    console.log('❌ Admin access denied for:', user.email);
    return res.status(403).json({ message: 'Admin access required.' });
  }

  console.log('✅ Admin access granted for:', user.email);

  const { data, error } = await supabaseAdmin
    .from('support_messages')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Admin fetch error:', error);
    return res.status(500).json({ message: 'Failed to fetch messages. Error: ' + error.message });
  }

  console.log(`✅ Found ${data.length} total messages`);

  // Fetch user names for each message
  const userIds = [...new Set(data.map(m => m.user_id).filter(Boolean))];
  let userMap = {};

  if (userIds.length > 0) {
    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, first_name, last_name, email')
      .in('id', userIds);

    if (!userError && users) {
      users.forEach(u => {
        userMap[u.id] = `${u.first_name} ${u.last_name} (${u.email})`;
      });
    }
  }

  const messagesWithUser = data.map(m => ({
    ...m,
    userDisplay: userMap[m.user_id] || m.email || 'Unknown User'
  }));

  res.json({ messages: messagesWithUser });
});

// ============================================================
// ADMIN: Reply to a support message
// ============================================================
router.post('/admin/support/reply', verifyToken, async (req, res) => {
  console.log('📩 Admin reply request');
  const { messageId, reply } = req.body;
  console.log('📦 Message ID:', messageId);
  console.log('📦 Reply:', reply);

  // Verify admin
  const { data: user, error: adminCheck } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', req.user.id)
    .single();

  if (adminCheck || !user) {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  const adminEmails = ['admin@gmail.com', 'katejackson00001@gmail.com'];
  if (!adminEmails.includes(user.email)) {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  if (!messageId || !reply || reply.trim().length < 1) {
    return res.status(400).json({ message: 'Reply is required.' });
  }

  const { data, error } = await supabaseAdmin
    .from('support_messages')
    .update({
      reply: reply.trim(),
      updated_at: new Date().toISOString(),
      is_read: true
    })
    .eq('id', messageId)
    .select('id, user_id, email, message, reply')
    .single();

  if (error) {
    console.error('❌ Reply error:', error);
    return res.status(500).json({ message: 'Failed to send reply. Error: ' + error.message });
  }

  console.log('✅ Reply sent for message ID:', messageId);
  res.json({
    message: 'Reply sent successfully.',
    data: data
  });
});

module.exports = router;
