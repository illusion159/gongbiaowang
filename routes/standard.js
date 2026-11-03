'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

// 标准详情
router.get('/standard/:id', (req, res) => {
  const std = db.getStandard(parseInt(req.params.id, 10));
  if (!std) {
    return res.status(404).render('404', { title: '标准不存在' });
  }

  // 相关标准：同中标分类（一级）或同 ICS 前缀
  let related = [];
  if (std.ccs_code) {
    const top = std.ccs_code.charAt(0);
    related = db.db.prepare(
      `SELECT id, std_number, title, status FROM standards
       WHERE ccs_code LIKE ? AND id != ? ORDER BY publish_date DESC LIMIT 10`
    ).all(`${top}%`, std.id);
  }
  if (related.length < 5 && std.ics_code) {
    const prefix = std.ics_code.split('.')[0];
    const extra = db.db.prepare(
      `SELECT id, std_number, title, status FROM standards
       WHERE ics_code LIKE ? AND id != ? ORDER BY publish_date DESC LIMIT 10`
    ).all(`${prefix}%`, std.id);
    const seen = new Set(related.map((r) => r.id));
    for (const r of extra) if (!seen.has(r.id)) related.push(r);
  }

  res.render('standard_detail', { title: `${std.std_number} ${std.title}`, std, related });
});

module.exports = router;
