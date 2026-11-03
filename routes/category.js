'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const cache = require('../lib/cache');
const { CCS_CATEGORIES, INDUSTRY_CATEGORIES } = require('../data/classifications');

// 标准分类总览页（统一后全部来自 standards 表）
router.get('/category', (req, res) => {
  // 分类计数：进程内缓存 5 分钟（防雪崩抖动内置在 cache 里）
  const { ccsStats, industryStats } = cache.get('category:overview', 5 * 60 * 1000, () => ({
    ccsStats: db.getCcsStats(),
    industryStats: db.getIndustryStats(),
  }));

  res.render('category', {
    title: '标准分类 - 工标网',
    ccsStats,
    industryStats,
  });
});

// 中标分类下的标准列表
router.get('/category/ccs/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = 20;
  const name = CCS_CATEGORIES.find((c) => c.code === code)?.name || code;

  const total = db.db.prepare(
    "SELECT COUNT(*) AS c FROM standards WHERE substr(ccs_code,1,1) = ?"
  ).get(code).c;
  const rows = db.db.prepare(
    `SELECT id, std_number, title, status, yearOf(std_number) AS year
     FROM standards WHERE substr(ccs_code,1,1) = ?
     ORDER BY yearOf(std_number) DESC, std_number DESC LIMIT ? OFFSET ?`
  ).all(code, pageSize, (page - 1) * pageSize);

  res.render('category_list', {
    title: `${code} ${name} 分类标准 - 工标网`,
    label: `${code} ${name}`,
    rows, total, page, pageSize,
    totalPages: Math.ceil(total / pageSize),
    baseUrl: `/category/ccs/${code}`,
  });
});

// 行业分类下的标准列表
router.get('/category/industry/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = 20;
  const name = INDUSTRY_CATEGORIES.find((c) => c.code === code)?.name || code;

  const total = db.db.prepare(
    "SELECT COUNT(*) AS c FROM standards WHERE std_number LIKE ?"
  ).get(`${code}%`).c;
  const rows = db.db.prepare(
    `SELECT id, std_number, title, status, yearOf(std_number) AS year
     FROM standards WHERE std_number LIKE ?
     ORDER BY yearOf(std_number) DESC, std_number DESC LIMIT ? OFFSET ?`
  ).all(`${code}%`, pageSize, (page - 1) * pageSize);

  res.render('category_list', {
    title: `${code} ${name} 行业标准 - 工标网`,
    label: `${code} ${name}`,
    rows, total, page, pageSize,
    totalPages: Math.ceil(total / pageSize),
    baseUrl: `/category/industry/${code}`,
  });
});

// 新标准：每个中标分类 + 每个行业分类，取标准编号年份最新的前 10 条
router.get('/new', (req, res) => {
  const ccsName = {};
  CCS_CATEGORIES.forEach((c) => { ccsName[c.code] = c.name; });
  const indName = {};
  INDUSTRY_CATEGORIES.forEach((c) => { indName[c.code] = c.name; });

  const ccsGroups = db.getLatestStandardsByCcs(10).map((g) => ({ ...g, name: ccsName[g.code] || g.code }));

  const indCodes = new Set(INDUSTRY_CATEGORIES.map((c) => c.code));
  const indGroups = db.getLatestStandardsByIndustry(10)
    .filter((g) => indCodes.has(g.code))
    .map((g) => ({ ...g, name: indName[g.code] || g.code }));

  res.render('new_standards', {
    title: '新标准 - 工标网',
    ccsGroups,
    indGroups,
  });
});

module.exports = router;
