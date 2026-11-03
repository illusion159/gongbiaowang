'use strict';

// 从 全国标准信息公共服务平台（std.samr.gov.cn）抓取国家标准公告
// 列表接口：/noc/search/nocGBPage?searchText=&pageNumber=N&pageSize=M
// 详情页：http://std.sacinfo.org.cn/gnoc/queryInfo?id=<PID>
// 详情页含完整标准清单（序号/标准编号/标准名称/代替标准号/实施日期）

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db');

const LIST_API = 'https://std.samr.gov.cn/noc/search/nocGBPage';
const NOTICE_API_BASE = 'https://std.samr.gov.cn/noc/search/';
const DETAIL_BASE = 'http://std.sacinfo.org.cn/gnoc/queryInfo';

// 备案月报 / 计划公告：详情页正文在附件里（网页无正文），但列表数据即含标题/日期/文号
const CATEGORY_SOURCES = [
  { key: 'nocHB', api: 'nocHBPage', category: '行业标准备案公告', titleField: 'C_TITLE', label: '行业标准备案月报' },
  { key: 'nocDB', api: 'nocDBPage', category: '地方标准备案公告', titleField: 'C_TITLE', label: '地方标准备案月报' },
  { key: 'nocPlan', api: 'nocPlanPage', category: '计划公告', titleField: 'TITLE', label: '计划公告' },
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DELAY = 600; // 请求间隔（毫秒）

let lastRequest = 0;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function get(url) {
  const now = Date.now();
  const wait = Math.max(0, lastRequest + DELAY - now);
  if (wait) await sleep(wait);
  lastRequest = Date.now();
  const resp = await axios.get(url, {
    headers: { 'User-Agent': UA, Referer: 'https://std.samr.gov.cn/' },
    timeout: 25000,
    maxRedirects: 5,
    responseType: 'text',
  });
  return resp.data;
}

// 抓取列表（返回 { total, rows:[{CODE,TITLE,NOTICE_DATE,PID}] }）
async function fetchListPage(page, pageSize = 50) {
  const url = `${LIST_API}?searchText=&pageNumber=${page}&pageSize=${pageSize}`;
  const raw = await get(url);
  try {
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error('列表接口返回非 JSON：' + String(raw).slice(0, 80));
  }
}

// 解析详情页 → { title, content, publish_date, standards }
function parseDetail(html) {
  const $ = cheerio.load(html);
  const title = $('.notice-content .ntitle').first().text().replace(/\s+/g, ' ').trim();

  // 正文：zhengwen 段落 + 落款
  const paras = [];
  $('.notice-content .zhengwen').each((i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) paras.push(t);
  });
  const luokuan = [];
  $('.notice-content .luokuan').each((i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) luokuan.push(t);
  });
  const content = [...paras, ...luokuan].join('\n');

  // 发布日期：优先取落款里的日期
  let publish_date = '';
  const dm = content.match(/(\d{4}-\d{1,2}-\d{1,2})/);
  if (dm) publish_date = dm[1];

  // 标准清单
  const standards = [];
  $('.std-list table tbody tr').each((i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 3) return;
    const number = $(tds[1]).text().replace(/\s+/g, ' ').trim();
    if (!number || !/^[A-Z]/.test(number)) return;
    const name = $(tds[2]).find('a').first().text().replace(/\s+/g, ' ').trim()
      || $(tds[2]).text().replace(/\s+/g, ' ').trim();
    standards.push({
      序号: $(tds[0]).text().replace(/\s+/g, ' ').trim(),
      标准编号: number,
      标准名称: name,
      代替标准号: $(tds[3]).text().replace(/\s+/g, ' ').trim(),
      实施日期: $(tds[4]).text().replace(/\s+/g, ' ').trim(),
    });
  });

  return { title, content, publish_date, standards };
}

async function crawlGbAnnouncements({ maxDetails = 0, onProgress } = {}) {
  const first = await fetchListPage(1, 50);
  const total = first.total || 0;
  console.log(`国家标准公告总数：${total}`);

  // 收集全部列表行
  const rows = [...(first.rows || [])];
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);
  for (let p = 2; p <= totalPages; p++) {
    const page = await fetchListPage(p, pageSize);
    rows.push(...(page.rows || []));
  }

  // 只抓「批准发布」类公告；跳过废止公告、标准样品公告（清单在附件 .wps 里，网页无列表）
  const filtered = rows.filter((r) => !/废止|标准样品/.test(r.TITLE || ''));
  console.log(`过滤后剩余 ${filtered.length} 条（跳过废止/标准样品 ${rows.length - filtered.length} 条）`);

  const targets = maxDetails > 0 ? filtered.slice(0, maxDetails) : filtered;
  console.log(`计划抓取 ${targets.length} 条公告详情`);

  let ok = 0, skip = 0, fail = 0, totalStds = 0;
  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    const code = row.CODE || '';
    const url = `${DETAIL_BASE}?id=${row.PID}`;
    try {
      const html = await get(url);
      const d = parseDetail(html);
      const title = d.title || row.TITLE || '';
      const standards_json = JSON.stringify(d.standards);
      totalStds += d.standards.length;

      const r = db.upsertContent('announcements', {
        title: code ? `${code} ${title}` : title,
        source: '国家市场监督管理总局 国家标准化管理委员会',
        publish_date: row.NOTICE_DATE || d.publish_date || '',
        content: d.content || '',
        category: '国家标准批准发布公告',
        standards_json,
        source_url: url,
      });
      if (r.created) ok++;
      else skip++;
      console.log(`  [${i + 1}/${targets.length}] ${code} ${title.slice(0, 30)} ${r.created ? '✓新增' : '-已存在'}（${d.standards.length} 项标准）`);
    } catch (e) {
      fail++;
      console.log(`  [${i + 1}/${targets.length}] ${code} ✗ ${e.message}`);
    }
    if (onProgress) onProgress(i + 1, targets.length);
  }

  return { total: targets.length, ok, skip, fail, totalStds };
}

// 通用列表抓取（分页）
async function fetchNoticeList(api, page, pageSize = 50) {
  const url = `${NOTICE_API_BASE}${api}?searchText=&pageNumber=${page}&pageSize=${pageSize}`;
  const raw = await get(url);
  try {
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error('列表接口返回非 JSON：' + String(raw).slice(0, 80));
  }
}

// 抓取 备案月报 / 计划公告（仅用列表数据，详情页无正文）
async function crawlFilingAnnouncements({ onProgress } = {}) {
  let ok = 0, skip = 0, fail = 0, total = 0;
  for (const src of CATEGORY_SOURCES) {
    let rows = [];
    try {
      const first = await fetchNoticeList(src.api, 1, 50);
      rows = [...(first.rows || [])];
      const pages = Math.ceil((first.total || 0) / 50);
      for (let p = 2; p <= pages; p++) {
        const page = await fetchNoticeList(src.api, p, 50);
        rows.push(...(page.rows || []));
      }
    } catch (e) {
      fail++;
      console.log(`  ${src.label} 列表抓取失败：${e.message}`);
      continue;
    }
    console.log(`${src.label}：共 ${rows.length} 条`);

    for (const r of rows) {
      const code = (r.CODE || '').trim();
      const title = (r[src.titleField] || '').trim();
      if (!title) continue;
      const source_url = `https://std.samr.gov.cn/noc/${src.key}#${r.id || code}`;
      const result = db.upsertContent('announcements', {
        title: code ? `${code} ${title}` : title,
        source: '国家标准化管理委员会',
        publish_date: r.NOTICE_DATE || '',
        content: title,
        category: src.category,
        standards_json: '[]',
        source_url,
      });
      if (result.created) ok++;
      else skip++;
      total++;
    }
  }
  return { total, ok, skip, fail };
}

module.exports = { crawlGbAnnouncements, crawlFilingAnnouncements, parseDetail };
