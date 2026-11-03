'use strict';

// 工标网爬虫入口
// 用法：node crawler/index.js [标准|公告|动态|全部]
// 配置见下方 CONFIG，按需调整抓取范围与数量。

const { crawlStandards } = require('./crawlStandards');
const { crawlAnnouncements, crawlNews } = require('./crawlContent');
const { crawlGbAnnouncements, crawlFilingAnnouncements } = require('./crawlGbAnnouncements');
const { crawlDomains, crawlCapabilityItems } = require('./crawlCma');
const { crawlStandardDetailsFromSpc } = require('./crawlSpc');
const { crawlOpenstd } = require('./crawlOpenstd');
const db = require('../db');

// ====== 抓取配置（可自行修改） ======
const CONFIG = {
  // 标准：按关键词搜索并抓取详情
  standards: {
    keywords: ['国家标准', '化工', '机械', '纺织', '建材'], // 搜索关键词
    pagesPerKeyword: 1,   // 每个关键词抓几页结果
    maxDetails: 40,       // 最多抓取多少个标准详情
  },
  // 公告（来自 全国标准信息公共服务平台 std.samr.gov.cn，共 547 条国家标准公告）
  announcements: { maxDetails: 0 }, // 0 = 全部抓取
  // 动态
  news: { maxDetails: 10 },
  // 能力项目（CMA 检验检测能力项目库）
  capability: {
    maxItems: 0,          // 0 = 全部抓取；>0 则限制条数
    pageSize: 500,
  },
  // 按标准编号补详情（库内缺发布日期/发布部门的标准，逐个去 spc.org.cn 搜编号抓详情）
  details: {
    maxDetails: 0,        // 每次最多补多少条；0 = 全部（数量很大，会抓很久）
  },
  // 国标原文 PDF（openstd.samr.gov.cn 全文公开系统，仅「现行/即将实施」GB 标准提供）
  pdf: {
    maxDetails: 0,        // 0 = 全部
  },
};

async function main() {
  const arg = process.argv[2] || '全部';
  const t0 = Date.now();
  console.log('==========================================');
  console.log('  工标网爬虫 开始');
  console.log(`  模式: ${arg}`);
  console.log('==========================================');

  let stdResult = { total: 0, ok: 0 };
  let annResult = { total: 0, ok: 0 };
  let newsResult = { total: 0, ok: 0 };
  let capResult = { total: 0, inserted: 0 };
  let detailResult = { total: 0, updated: 0, notFound: 0, noMatch: 0 };
  let pdfResult = { total: 0, updated: 0, noPdf: 0, notFound: 0, noMatch: 0 };

  try {
    if (arg === '标准' || arg === '全部') {
      stdResult = await crawlStandards(CONFIG.standards);
    }
    if (arg === '公告' || arg === '全部') {
      const gb = await crawlGbAnnouncements(CONFIG.announcements);
      const filing = await crawlFilingAnnouncements();
      annResult = { total: gb.total + filing.total, ok: gb.ok + filing.ok };
    }
    if (arg === '动态' || arg === '全部') {
      newsResult = await crawlNews(CONFIG.news);
    }
    if (arg === '能力项目' || arg === '全部') {
      await crawlDomains();
      capResult = await crawlCapabilityItems(CONFIG.capability);
    }
    if (arg === '详情') {
      detailResult = await crawlStandardDetailsFromSpc(CONFIG.details);
    }
    if (arg === 'PDF') {
      pdfResult = await crawlOpenstd(CONFIG.pdf);
    }
  } catch (e) {
    console.error('爬虫异常:', e.message);
  }

  const counts = db.getStandardCounts();
  const capTotal = db.getCapabilityTotal();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('==========================================');
  console.log(`  完成，耗时 ${secs}s`);
  console.log(`  标准: 抓取 ${stdResult.total}，新增 ${stdResult.ok}（库内共 ${counts.total} 条）`);
  console.log(`  公告: 抓取 ${annResult.total}，新增 ${annResult.ok}`);
  console.log(`  动态: 抓取 ${newsResult.total}，新增 ${newsResult.ok}`);
  console.log(`  能力项目: 抓取 ${capResult.total}，库内共 ${capTotal} 条`);
  console.log(`  详情: 补 ${detailResult.updated} 条，未搜索到 ${detailResult.notFound}，编号不匹配 ${detailResult.noMatch}`);
  console.log(`  原文PDF: 补 ${pdfResult.updated} 条（无PDF ${pdfResult.noPdf}），未搜索到 ${pdfResult.notFound}，编号不匹配 ${pdfResult.noMatch}`);
  console.log('==========================================');
}

main();
