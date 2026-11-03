'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { STATUSES, ANNOUNCEMENT_CATEGORIES, CCS_CATEGORIES } = require('../data/classifications');

// 排序映射（参考 csres 高级查询 SortIndex）
const SORT_MAP = {
  1: { field: 'id', label: '默认' },
  2: { field: 'std_number', label: '标准编号' },
  3: { field: 'publish_date', label: '发布日期' },
  4: { field: 'implement_date', label: '实施日期' },
  5: { field: 'status', label: '状态' },
};

// 标准搜索（简单 + 高级共用）
router.get('/search', (req, res) => {
  const q = {
    keyword: req.query.keyword || '',
    std_number: req.query.std_number || '',
    title: req.query.title || '',
    title_eng: req.query.title_eng || '',
    replace_info: req.query.replace || '',
    adopt_info: req.query.adopt || '',
    ccs_code: req.query.ccs || '',
    ics_code: req.query.ics || '',
    drafting_unit: req.query.drafting || '',
    tech_committee: req.query.tc || '',
    publish_dept: req.query.dept || '',
    status: req.query.status || '',
  };
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize, 10) || 20);
  const sortIdx = SORT_MAP[req.query.sort] ? req.query.sort : '1';
  const sort = SORT_MAP[sortIdx];
  const way = req.query.way === 'asc' ? 'asc' : 'desc';

  const result = db.searchStandards(q, page, pageSize, sort.field, way);

  // 状态计数（不含状态筛选，供计数卡筛选用）
  const noStatus = { ...q, status: '' };
  const statusStats = db.searchStandards(noStatus, 1, 1, 'id', 'desc').stats;

  // 高级查询专用参数回显
  const advanced = req.query.advanced === '1';

  res.render('search', {
    title: `标准搜索 - ${q.keyword || ''}`,
    q, result, sort, sortIdx, way, statusStats,
    advanced,
    statuses: STATUSES,
    ccsList: CCS_CATEGORIES,
    isNotice: false,
    totalPages: Math.ceil(result.total / pageSize),
  });
});

// 高级查询表单页
router.get('/advanced', (req, res) => {
  res.render('advanced', {
    title: '高级查询 - 工标网',
    statuses: STATUSES,
    ccsList: CCS_CATEGORIES,
  });
});

// 公告搜索
router.get('/notice', (req, res) => {
  const keyword = req.query.keyword || '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = 20;
  const result = db.listContent('announcements', { keyword, page, pageSize });
  res.render('search', {
    title: `公告搜索 - ${keyword || ''}`,
    q: { keyword },
    result,
    sort: SORT_MAP[1],
    sortIdx: '1',
    way: 'desc',
    advanced: false,
    statuses: STATUSES,
    ccsList: CCS_CATEGORIES,
    isNotice: true,
    totalPages: Math.ceil(result.total / pageSize),
  });
});

module.exports = router;
