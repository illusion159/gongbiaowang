'use strict';

// 增量更新：从行业标准信息服务平台（hbba.sacinfo.org.cn）抓最新标准，
// 按标准编号归一化后与库内比对去重，把新标准（含详情）补入库。
//
// 单独跑一次：  node crawler/crawlIncremental.js
// 每日自动执行：见 crawler/autoUpdate.js

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db');

const BASE = 'https://hbba.sacinfo.org.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DELAY = 500;

let lastReq = 0;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastReq + DELAY - now);
  if (wait) await sleep(wait);
  lastReq = Date.now();
}

// 归一化标准编号：去空白（含全角空格）+ 转大写
function normalize(s) {
  return String(s || '').replace(/[\s　]+/g, '').toUpperCase();
}

// 时间戳(毫秒) → YYYY-MM-DD
function tsToDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 解析 stdDetail 详情页，补 起草单位/起草人/简介/CCS/ICS/归口单位/代替 等字段
function parseHbbaDetail(html) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const grab = (label, ...stops) => {
    const i = text.indexOf(label);
    if (i < 0) return '';
    let v = text.slice(i + label.length).trim();
    for (const s of stops) {
      const j = v.indexOf(s);
      if (j >= 0) v = v.slice(0, j);
    }
    return v.trim();
  };
  return {
    title: grab('标准名称', '英文名称'),
    status: '', // 状态用搜索接口的 rec.status（干净），不从详情页抓
    publish_date: (grab('发布日期', '实施日期').match(/\d{4}-\d{1,2}-\d{1,2}/) || [''])[0],
    implement_date: (grab('实施日期', '制修订').match(/\d{4}-\d{1,2}-\d{1,2}/) || [''])[0],
    replace_info: grab('代替标准', '中国标准分类号'),
    ccs_code: (grab('中国标准分类号', '国际标准分类号').match(/[A-Z]\d{1,3}/) || [''])[0],
    ics_code: (grab('国际标准分类号', '技术归口').match(/\d{2}\.\d{3}/) || [''])[0],
    tech_committee: grab('技术归口', '批准发布部门'),
    publish_dept: grab('批准发布部门', '行业分类'),
    summary: grab('适用范围', '起草单位'),
    drafting_unit: grab('起草单位', '起草人'),
    drafters: grab('起草人', '版权'),
  };
}

async function fetchDetail(pk) {
  await throttle();
  const resp = await axios.get(`${BASE}/stdDetail/${pk}`, {
    headers: { 'User-Agent': UA, Referer: BASE + '/stdList' },
    timeout: 25000,
    maxRedirects: 5,
    responseType: 'text',
  });
  return resp.data;
}

async function crawlIncremental({ pages = 3, pageSize = 100, onProgress } = {}) {
  // 1. 库内现有编号（归一化）加载到 Set
  const existing = new Set(
    db.db.prepare('SELECT std_number FROM standards').all().map((r) => normalize(r.std_number))
  );

  // 2. 查最新标准（key 为空 = 全部最新，按日期倒序）
  const records = [];
  for (let p = 1; p <= pages; p++) {
    await throttle();
    const resp = await axios.post(
      `${BASE}/stdQueryList`,
      `key=&current=${p}&size=${pageSize}`,
      {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Referer: BASE + '/stdList',
        },
        timeout: 30000,
        maxRedirects: 5,
      }
    );
    const j = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    records.push(...(j.records || []));
    if (p >= (j.pages || 1)) break;
  }

  // 3. 按标准编号去重，筛出库里没有的新标准
  const newStds = records.filter((r) => !existing.has(normalize(r.code)));
  console.log(`查询最新标准 ${records.length} 条，其中新增 ${newStds.length} 条`);

  // 4. 抓详情 + 入库
  let added = 0;
  for (let i = 0; i < newStds.length; i++) {
    const rec = newStds[i];
    try {
      let detail = {};
      try {
        detail = parseHbbaDetail(await fetchDetail(rec.pk));
      } catch (e) {
        // 详情页失败就只用列表数据
      }
      const s = {
        std_number: normalize(rec.code),
        title: detail.title || rec.chName || '',
        status: rec.status || '现行',
        publish_date: detail.publish_date || tsToDate(rec.issueDate),
        implement_date: detail.implement_date || tsToDate(rec.actDate),
        publish_dept: detail.publish_dept || rec.chargeDept || '',
        tech_committee: detail.tech_committee || '',
        replace_info: detail.replace_info || rec.reviseStdCodes || '',
        ccs_code: detail.ccs_code || '',
        ics_code: detail.ics_code || '',
        summary: detail.summary || '',
        drafting_unit: detail.drafting_unit || '',
        drafters: detail.drafters || '',
        source_url: `${BASE}/stdDetail/${rec.pk}`,
      };
      const r = db.upsertStandard(s);
      if (r.created) added++;
      console.log(`  [${i + 1}/${newStds.length}] ${s.std_number} ${s.title} ${r.created ? '✓新增' : '-已存在'}`);
    } catch (e) {
      console.log(`  [${i + 1}/${newStds.length}] ${rec.code} ✗ ${e.message}`);
    }
    if (onProgress) onProgress(i + 1, newStds.length);
  }

  return { checked: records.length, newCount: newStds.length, added };
}

module.exports = { crawlIncremental, parseHbbaDetail, normalize };

if (require.main === module) {
  crawlIncremental()
    .then((r) => console.log('完成:', JSON.stringify(r)))
    .catch((e) => console.error('ERR:', e.message));
}
