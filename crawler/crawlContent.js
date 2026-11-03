'use strict';

const { fetchGBK, absUrl, BASE } = require('./fetch');
const { extractNoticeIds, extractInfoIds, parseContentDetail } = require('./parse');
const db = require('../db');

function log(msg) {
  console.log(msg);
}

// 抓取标准公告（列表 /notice/index.jsp → 详情 /notice/N.html）
async function crawlAnnouncements({ maxDetails = 15, category = '' } = {}) {
  const listUrl = `${BASE}/notice/index.jsp`;
  log(`抓取公告列表: ${listUrl}`);
  let html;
  try {
    html = await fetchGBK(listUrl);
  } catch (e) {
    log(`  ✗ 列表抓取失败: ${e.message}`);
    return { total: 0, ok: 0 };
  }
  const ids = extractNoticeIds(html);
  log(`  发现 ${ids.length} 条公告，最多抓取 ${maxDetails} 个`);

  let ok = 0;
  const targets = ids.slice(0, maxDetails);
  for (let i = 0; i < targets.length; i++) {
    const id = targets[i];
    const url = `${BASE}/notice/${id}.html`;
    try {
      const h = await fetchGBK(url);
      const c = parseContentDetail(h);
      c.source_url = url;
      c.category = category || classify(c.title);
      c.standards_json = JSON.stringify(c.standards || []);
      delete c.standards;
      const r = db.upsertContent('announcements', c);
      ok += r.created ? 1 : 0;
      log(`  [${i + 1}/${targets.length}] ${c.title} ${r.created ? '✓新增' : '-已存在'}`);
    } catch (e) {
      log(`  [${i + 1}/${targets.length}] id=${id} ✗ ${e.message}`);
    }
  }
  return { total: targets.length, ok };
}

// 抓取标准动态（列表 /info/index.jsp → 详情 /info/N.html）
async function crawlNews({ maxDetails = 15 } = {}) {
  const listUrl = `${BASE}/info/index.jsp`;
  log(`抓取动态列表: ${listUrl}`);
  let html;
  try {
    html = await fetchGBK(listUrl);
  } catch (e) {
    log(`  ✗ 列表抓取失败: ${e.message}`);
    return { total: 0, ok: 0 };
  }
  const ids = extractInfoIds(html);
  // 去重并过滤掉纯公告（/info 也可能混有公告类），此处保留全部
  log(`  发现 ${ids.length} 条动态，最多抓取 ${maxDetails} 个`);

  let ok = 0;
  const targets = ids.slice(0, maxDetails);
  for (let i = 0; i < targets.length; i++) {
    const id = targets[i];
    const url = `${BASE}/info/${id}.html`;
    try {
      const h = await fetchGBK(url);
      const c = parseContentDetail(h);
      c.source_url = url;
      c.category = classify(c.title);
      const r = db.upsertContent('news', c);
      ok += r.created ? 1 : 0;
      log(`  [${i + 1}/${targets.length}] ${c.title} ${r.created ? '✓新增' : '-已存在'}`);
    } catch (e) {
      log(`  [${i + 1}/${targets.length}] id=${id} ✗ ${e.message}`);
    }
  }
  return { total: targets.length, ok };
}

// 根据标题粗分类
function classify(title) {
  if (title.includes('国家标准批准发布')) return '国家标准批准发布公告';
  if (title.includes('行业标准') && title.includes('备案')) return '行业标准备案公告';
  if (title.includes('地方标准') && title.includes('备案')) return '地方标准备案公告';
  if (title.includes('废止')) return '地方公告';
  return '标准动态';
}

module.exports = { crawlAnnouncements, crawlNews };
