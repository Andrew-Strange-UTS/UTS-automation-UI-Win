// server/routes/secrets.js
const express = require('express');
const router = express.Router();
const secrets = require('../secrets');
// List names only
router.get('/', (req, res) => res.json({ secrets: secrets.listNames() }));
// Create new/update secret
router.post('/', (req, res) => {
  const { name, value } = req.body;
  if (!name || typeof value !== 'string') return res.status(400).json({ error: "Name and value required" });
  secrets.setSecret(name, value); return res.json({ ok: true });
});
// Update
router.put('/:name', (req, res) => {
  if (!req.body.value) return res.status(400).json({error:"Missing value"});
  secrets.setSecret(req.params.name, req.body.value); return res.json({ok:true});
});
// Delete
router.delete('/:name', (req, res) => {
  secrets.deleteSecret(req.params.name); return res.json({ok:true});
});
module.exports = router;

