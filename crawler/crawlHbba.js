'use strict';

// 从 行业标准信息服务平台（hbba.sacinfo.org.cn）批量补行业标准的发布日期/实施日期。
// 该平台覆盖行业标准（FZ/JB/QB/NB/SH/NY/SC/GA…），但不含工程建设标准（JGJ/CJJ/GB50xxx）。
// 接口：POST /stdQueryList，表单 current/size/key；返回 records[] 含 code/chName/issueDate/actDate/chargeDept/pk。
// 日期字段为 epoch 毫秒。

const axios = require('axios');
const db = require('../db');

const BASE = 'https://hbba.sacinfo.org.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DELAY = 600; // 请求间隔（毫秒）

let lastRequest = 0;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 规范化：统一横线（— – － → -）、去空格、转大写
function normalize(n) {
  return String(n || '').replace(/[—–－‐]/g, '-').replace(/\s+/g, '').toUpperCase();
}

// 生成搜索关键字：去掉年号与修改单后缀，并在字母前缀后补一个空格以匹配站点格式
// "JB/T10491.2-2004" -> "JB/T 10491.2"；"GB/T 48351-2026/XG1-2026" -> "GB/T 48351"
function searchKey(n) {
  let s = String(n || '').trim();
  s = s.replace(/\s*\/\s*(?:XG|ZG|AMD|Amd|Cor|A)\d+[:\-,\d]*\s*$/i, ''); // 去修改单
  s = s.replace(/[—\-:]\s*\d{4}\s*$/i, ''); // 去年号
  s = s.replace(/^([A-Z]{1,4}\s*\/\s*[A-Z]?)(\d)/, (m, p, d) => p.trim() + ' ' + d); // 前缀后补空格
  return s.trim();
}

function msToDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function searchHbba(key) {
  const now = Date.now();
  const wait = Math.max(0, lastRequest + DELAY - now);
  if (wait) await sleep(wait);
  lastRequest = Date.now();
  const resp = await axios.post(
    `${BASE}/stdQueryList`,
    new URLSearchParams({ current: '1', size: '60', key }).toString(),
    {
      headers: {
        'User-Agent': UA,
        Referer: `${BASE}/stdList`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 25000,
      maxRedirects: 5,
      responseType: 'text',
    }
  );
  return JSON.parse(resp.data);
}

async function crawlStandardDetailsFromHbba({ maxDetails = 0 } = {}) {
  const rows = db.db.prepare(
    "SELECT id, std_number FROM standards WHERE (publish_date IS NULL OR publish_date = '') AND std_number GLOB '[A-Z]*' ORDER BY yearOf(std_number) DESC, id LIMIT ?"
  ).all(maxDetails > 0 ? maxDetails : -1);

  console.log(`待补详情（hbba）：${rows.length} 条`);

  let filled = 0, notFound = 0, noMatch = 0, failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const { id, std_number } = rows[i];
    const full = normalize(std_number);
    const key = searchKey(std_number);
    try {
      const res = await searchHbba(key);
      if (!res || !res.total) {
        notFound++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗未搜索到`);
        continue;
      }
      const match =
        res.records.find((r) => normalize(r.code) === full) ||
        res.records.find((r) => normalize(r.code) === full.replace(/\/\s*XG.*$/i, ''));
      if (!match) {
        noMatch++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗编号不匹配(${res.records.map((r) => r.code).slice(0, 4).join(', ')})`);
        continue;
      }
      const publish_date = msToDate(match.issueDate);
      const implement_date = msToDate(match.actDate);
      if (!publish_date) {
        noMatch++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗无发布日期`);
        continue;
      }
      db.db.prepare(
        'UPDATE standards SET publish_date = ?, implement_date = ?, publish_dept = COALESCE(NULLIF(?, \'\'), publish_dept), source_url = ? WHERE id = ?'
      ).run(publish_date, implement_date, match.chargeDept || '', `${BASE}/stdDetail/${match.pk}`, id);
      filled++;
      console.log(`  [${i + 1}/${rows.length}] ${std_number} ✓ ${publish_date}${implement_date ? ' → ' + implement_date : ''}`);
    } catch (e) {
      failed++;
      console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗ ${e.message}`);
      if (failed >= 40) {
        console.log(`  ⚠ 连续 ${failed} 次请求失败，疑似被限流，中止。`);
        break;
      }
    }
  }
  return { total: rows.length, filled, notFound, noMatch, failed };
}

module.exports = { crawlStandardDetailsFromHbba, searchKey, msToDate };

// 直接运行：node crawler/crawlHbba.js [条数]
if (require.main === module) {
  const limit = parseInt(process.argv[2], 10) || 0;
  crawlStandardDetailsFromHbba({ maxDetails: limit }).then((r) => {
    console.log(`完成：补 ${r.filled} 条，未搜索到 ${r.notFound}，编号不匹配 ${r.noMatch}，失败 ${r.failed}`);
  });
}
