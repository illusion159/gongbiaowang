'use strict';

const axios = require('axios');
const db = require('../db');

const BASE = 'https://cma.caqit.org.cn';
const API = `${BASE}/cma-admin`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DELAY = 600; // 请求间隔（毫秒）

let lastRequest = 0;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getJSON(path, params = {}) {
  const now = Date.now();
  const wait = Math.max(0, lastRequest + DELAY - now);
  if (wait) await sleep(wait);
  lastRequest = Date.now();
  const resp = await axios.get(API + path, {
    params,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    timeout: 30000,
    maxRedirects: 5,
  });
  return resp.data;
}

// 抓取领域分类（三级树）
async function crawlDomains() {
  console.log(`抓取领域分类: ${API}/system/domain/list`);
  const res = await getJSON('/system/domain/list', { pageNum: 1, pageSize: 1000 });
  const arr = res.data || res.rows || [];
  if (!arr.length) {
    console.log('  未获取到领域数据');
    return { total: 0 };
  }

  // 计算层级：parentId=0 → 1，否则父级+1
  const byId = new Map(arr.map((d) => [d.id, d]));
  for (const d of arr) {
    let level = 1;
    let p = d.parentId;
    while (p && byId.has(p)) {
      level++;
      p = byId.get(p).parentId;
    }
    db.upsertDomain({
      id: d.id,
      name: d.name,
      parent_id: d.parentId || 0,
      level,
      order_number: d.orderNumber || 0,
      remark: d.remark || '',
    });
  }
  console.log(`  已写入 ${arr.length} 个领域`);
  return { total: arr.length };
}

// 抓取能力项目（分页 JSON 接口）
async function crawlCapabilityItems({ maxItems = 0, pageSize = 500, onProgress } = {}) {
  const first = await getJSON('/system/standardData/list', { pageNum: 1, pageSize });
  const total = first.total || 0;
  const target = maxItems > 0 ? Math.min(maxItems, total) : total;
  const totalPages = Math.ceil(target / pageSize);
  console.log(`能力项目总数 ${total}，计划抓取 ${target} 条（${totalPages} 页）`);

  let inserted = 0;
  let page = 1;
  let rows = first.rows || [];

  while (rows.length && page <= totalPages) {
    for (const r of rows) {
      db.upsertCapabilityItem({
        source_id: r.id,
        domain: r.domain || '',
        standard_method: r.standardMethod || '',
        standard_code: r.standardCode || '',
        remark: r.remark || '',
        source_url: '',
      });
      inserted++;
    }
    if (onProgress) onProgress(page, totalPages, inserted);
    if (inserted >= target) break;

    page++;
    try {
      const res = await getJSON('/system/standardData/list', { pageNum: page, pageSize });
      rows = res.rows || [];
    } catch (e) {
      console.log(`  第 ${page} 页抓取失败: ${e.message}，重试一次`);
      await sleep(1500);
      const res = await getJSON('/system/standardData/list', { pageNum: page, pageSize });
      rows = res.rows || [];
    }
    if (page % 20 === 0) console.log(`  已抓取 ${page}/${totalPages} 页，累计 ${inserted} 条`);
  }

  console.log(`  能力项目写入完成，共 ${inserted} 条`);
  return { total: target, inserted };
}

module.exports = { crawlDomains, crawlCapabilityItems };
