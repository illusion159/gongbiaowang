'use strict';

// 补全行业标准的详情字段：针对「列表数据入库、详情字段为空」的标准，
// 逐个抓 hbba 的 stdDetail 详情页，回填 简介/起草单位/起草人/归口/CCS/ICS/代替/发布部门 等。
// 用法：node crawler/crawlIndustryDetail.js [条数，默认 0 = 全部]

const axios = require('axios');
const db = require('../db');
const { parseHbbaDetail } = require('./crawlIncremental');

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

async function crawlIndustryDetail({ max = 0 } = {}) {
  const sql =
    "SELECT id, std_number, source_url FROM standards WHERE (summary IS NULL OR summary = '') AND source_url LIKE 'https://hbba.sacinfo.org.cn/stdDetail/%' ORDER BY id" +
    (max > 0 ? ` LIMIT ${max}` : '');
  const rows = db.db.prepare(sql).all();
  console.log(`待补详情：${rows.length} 条`);

  let filled = 0, failed = 0, consecutiveFail = 0;
  for (let i = 0; i < rows.length; i++) {
    const { id, std_number, source_url } = rows[i];
    try {
      await throttle();
      const resp = await axios.get(source_url, {
        headers: { 'User-Agent': UA, Referer: BASE + '/stdList' },
        timeout: 25000,
        maxRedirects: 5,
        responseType: 'text',
      });
      const detail = parseHbbaDetail(resp.data);
      db.updateStandardDetail(id, detail);
      consecutiveFail = 0;
      filled++;
      if (filled % 50 === 0) {
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✓ ${(detail.summary || '').slice(0, 18) || '（无简介）'}`);
      }
    } catch (e) {
      failed++;
      consecutiveFail++;
      console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗ ${e.message}`);
      if (consecutiveFail >= 40) {
        console.log(`  ⚠ 连续 ${consecutiveFail} 次失败，疑似被限流，中止。`);
        break;
      }
    }
  }
  return { total: rows.length, filled, failed };
}

module.exports = { crawlIndustryDetail };

if (require.main === module) {
  const max = parseInt(process.argv[2], 10) || 0;
  crawlIndustryDetail({ max })
    .then((r) => console.log(`完成：补 ${r.filled} 条，失败 ${r.failed}`))
    .catch((e) => console.error('ERR:', e.message));
}
