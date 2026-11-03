'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { ANNOUNCEMENT_CATEGORIES } = require('../data/classifications');

// 标准公告列表
router.get('/announcement', (req, res) => {
  const category = req.query.category || '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = 20;
  const result = db.listContent('announcements', { category, page, pageSize });

  // 各分类最新一条（右侧展示）
  const byCategory = {};
  for (const c of ANNOUNCEMENT_CATEGORIES) {
    const rows = db.db.prepare(
      'SELECT id, title, publish_date FROM announcements WHERE category = ? ORDER BY publish_date DESC, id DESC LIMIT 8'
    ).all(c);
    byCategory[c] = rows;
  }

  res.render('announcement_list', {
    title: '标准公告 - 工标网',
    result, category,
    totalPages: Math.ceil(result.total / pageSize),
    categories: ANNOUNCEMENT_CATEGORIES,
    byCategory,
  });
});

// 公告详情
router.get('/announcement/:id', (req, res) => {
  const a = db.getContent('announcements', parseInt(req.params.id, 10));
  if (!a) return res.status(404).render('404', { title: '公告不存在' });
  let standards = [];
  try { standards = JSON.parse(a.standards_json || '[]'); } catch (e) { standards = []; }
  res.render('announcement_detail', { title: `${a.title} - 工标网`, a, standards });
});

// 标准动态（新闻）列表
router.get('/news', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = 20;
  const result = db.listContent('news', { page, pageSize });
  res.render('news_list', {
    title: '标准动态 - 工标网',
    result,
    totalPages: Math.ceil(result.total / pageSize),
  });
});

// 动态详情
router.get('/news/:id', (req, res) => {
  const n = db.getContent('news', parseInt(req.params.id, 10));
  if (!n) return res.status(404).render('404', { title: '内容不存在' });
  res.render('news_detail', { title: `${n.title} - 工标网`, n });
});

module.exports = router;
