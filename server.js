'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');
const { STATUSES, ANNOUNCEMENT_CATEGORIES, INDUSTRY_CATEGORIES } = require('./data/classifications');

const app = express();
const PORT = process.env.PORT || 3000;

// 视图与静态资源
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// 全站共享模板变量
app.use((req, res, next) => {
  res.locals.statuses = STATUSES;
  res.locals.announcementCategories = ANNOUNCEMENT_CATEGORIES;
  res.locals.industryCategories = INDUSTRY_CATEGORIES;
  res.locals.path = req.path;
  res.locals.query = req.query;
  next();
});

// 路由
app.use('/', require('./routes/home'));
app.use('/', require('./routes/search'));
app.use('/', require('./routes/standard'));
app.use('/', require('./routes/category'));
app.use('/', require('./routes/content'));
app.use('/', require('./routes/pdf'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: '页面不存在' });
});

app.listen(PORT, () => {
  const counts = db.getStandardCounts();
  console.log('==========================================');
  console.log('  工标网（标准查询门户）已启动');
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`  标准数量: ${counts.total} 条`);
  console.log('  爬虫命令: npm run crawl');
  console.log('==========================================');
});
