'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const cache = require('../lib/cache');

// 解析 YYYY-M-D 为「本地」日期（避免 new Date("YYYY-MM-DD") 按 UTC 解析导致的时区偏移）
function parseDate(s) {
  const m = String(s || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

// 首页
router.get('/', (req, res) => {
  // 慢变数据（统计/分类计数/最新列表）：进程内缓存 5 分钟，防雪崩抖动内置在 cache 里
  const home = cache.get('home:overview', 5 * 60 * 1000, () => ({
    counts: db.getStandardCounts(),
    latestAnnouncements: db.db.prepare(
      'SELECT id, title, publish_date FROM announcements ORDER BY publish_date DESC, id DESC LIMIT 8'
    ).all(),
    latestStandards: db.db.prepare(
      'SELECT id, std_number, title, status, publish_date FROM standards ORDER BY publish_date DESC, id DESC LIMIT 20'
    ).all(),
    ccsStats: db.getCcsStats(),
    industryStats: db.getIndustryStats(),
  }));

  // 快变数据：即将实施提醒，每次请求实时计算（绝不缓存，保证动态更新）
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcomingAll = db.db.prepare(
    "SELECT id, std_number, title, implement_date FROM standards WHERE status = '即将实施' AND implement_date IS NOT NULL AND implement_date != ''"
  ).all()
    .map((s) => ({ ...s, daysLeft: Math.round((parseDate(s.implement_date) - today) / 86400000) }))
    .filter((s) => s.daysLeft >= 0 && s.daysLeft <= 60)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const upcomingTotal = upcomingAll.length;
  const upcoming = upcomingAll.slice(0, 10);

  res.render('index', {
    title: '工标网 · 标准查询',
    ...home,
    upcoming,
    upcomingTotal,
  });
});

module.exports = router;
