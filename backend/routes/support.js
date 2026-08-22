const express = require('express');
const router = express.Router();

// Placeholder – add your support routes later
router.get('/test', (req, res) => {
  res.json({ message: 'Support routes are working' });
});

module.exports = router;
