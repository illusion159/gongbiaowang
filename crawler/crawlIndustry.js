'use strict';

// 从行业标准信息服务平台（hbba.sacinfo.org.cn）按行业代号批量补标准：
// 针对库内缺失/极少的行业（建材 JC、石油 SY、交通 JT、民航 MH、化工 HG、船舶 CB），
// 按代号前缀搜索 → 分页 → 按编号去重 → 用「列表数据」入库（编号/名称/状态/日期/发布部门）。
// 详情字段（简介/CCS/起草单位等）后续可用现有详情爬虫再补。
//
// 用法：node crawler/crawlIndustry.js [每行业条数，默认 500]
// 说明：航天 QJ 在 hbba 上基本无数据，暂不在目标列表内。

const axios = require('axios');
const db = require('../db');

const BASE = 'https://hbba.sacinfo.org.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DELAY = 500;

// 缺的行业代号（按库内数量从少到多）
const TARGETS = ['JC', 'SY', 'JT', 'MH', 'HG', 'CB'];

let lastReq = 0;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastReq + DELAY - now);
  if (wait) await sleep(wait);
  lastReq = Date.now();
}

// 归一化标准编号：统一横线、去空白、转大写
function normalize(n) {
  return String(n || '').replace(/[—–－‐]/g, '-').replace(/[\s　]+/g, '').toUpperCase();
}

function tsToDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function search(prefix, page, size) {
  await throttle();
  const data = new URLSearchParams({ current: String(page), size: String(size), key: prefix }).toString();
  const resp = await axios.post(`${BASE}/stdQueryList`, data, {
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: BASE + '/stdList',
    },
    timeout: 30000,
    maxRedirects: 5,
  });
  const j = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
  return j;
}

async function crawlIndustry({ perIndustry = 500 } = {}) {
  const existing = new Set(
    db.db.prepare('SELECT std_number FROM standards').all().map((r) => normalize(r.std_number))
  );
  let totalAdded = 0;

  for (const prefix of TARGETS) {
    let added = 0;
    let page = 1;
    while (added < perIndustry && page <= 200) {
      let j;
      try {
        j = await search(prefix, page, 100);
      } catch (e) {
        console.log(`  ${prefix} 第${page}页 ✗ ${e.message}`);
        break;
      }
      const records = j.records || [];
      if (!records.length) break;
      for (const rec of records) {
        const code = normalize(rec.code);
        if (!code || existing.has(code)) continue;
        const s = {
          std_number: code,
          title: rec.chName || '',
          status: rec.status || '现行',
          publish_date: tsToDate(rec.issueDate),
          implement_date: tsToDate(rec.actDate),
          publish_dept: rec.chargeDept || '',
          source_url: `${BASE}/stdDetail/${rec.pk}`,
        };
        db.upsertStandard(s);
        existing.add(code);
        added++;
        if (added >= perIndustry) break;
      }
      const total = j.total || 0;
      const pages = j.pages || 1;
      console.log(`  ${prefix} 第${page}页（本页 ${records.length}，累计新增 ${added}/${perIndustry}，源共 ${total} 条）`);
      page++;
      if (page > pages) break;
    }
    console.log(`  → ${prefix} 完成：新增 ${added} 条`);
    totalAdded += added;
  }

  return { totalAdded };
}

module.exports = { crawlIndustry };

if (require.main === module) {
  const perIndustry = parseInt(process.argv[2], 10) || 500;
  console.log(`按行业补标准，每行业最多 ${perIndustry} 条，目标：${TARGETS.join(', ')}`);
  crawlIndustry({ perIndustry })
    .then((r) => console.log(`全部完成，共新增 ${r.totalAdded} 条`))
    .catch((e) => console.error('ERR:', e.message));
}
