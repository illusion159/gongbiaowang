'use strict';

// 从 中国工程建设标准化协会（cecs.org.cn）抓取「团体标准发布公告」
// 列表页 /xhbz/fbgg/list_111_N.html 每页约 6 条，且列表项已含 标题/正文/日期，
// 正文内自带 公告号 + 标准编号(T/CECS xxx) + 实施日期，无需再进详情页。

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db');

const BASE = 'http://www.cecs.org.cn';
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
    headers: { 'User-Agent': UA, Referer: BASE + '/' },
    timeout: 25000,
    maxRedirects: 5,
    responseType: 'text',
  });
  return resp.data;
}

// 解析一页列表 → [{ title, href, content, publish_date }]
function parseListPage(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('.wenzhang').each((i, el) => {
    const a = $(el).find('.bt a').first();
    const title = (a.attr('title') || a.text()).replace(/\s+/g, ' ').trim();
    const href = (a.attr('href') || '').trim();
    const content = $(el).find('.nr').text().replace(/\s+/g, ' ').trim();
    const publish_date = $(el).find('.shijian').text().replace(/\s+/g, ' ').trim();
    if (!title || !href) return;
    items.push({ title, href, content, publish_date });
  });
  return items;
}

// 从标题/正文提取标准信息
function extractStandard(title, content) {
  const name = ((title.match(/《([^》]+)》/) || [])[1] || '').trim();
  const number = ((content.match(/编号为\s*(T\/CECS[^，。；、]+)/) || [])[1] || '').replace(/\s+/g, '');
  let implement = '';
  const dm = content.match(/自\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日起施行/);
  if (dm) implement = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
  return { name, number, implement };
}

async function crawlCecs({ pages = 50, onProgress } = {}) {
  let ok = 0, skip = 0, fail = 0, total = 0, withStd = 0;
  for (let p = 1; p <= pages; p++) {
    const url = `${BASE}/xhbz/fbgg/list_111_${p}.html`;
    let html;
    try {
      html = await get(url);
    } catch (e) {
      fail++;
      console.log(`  第${p}页抓取失败：${e.message}`);
      continue;
    }
    const items = parseListPage(html);
    for (const it of items) {
      const std = extractStandard(it.title, it.content);
      const standards_json = std.number
        ? JSON.stringify([{
            序号: '1',
            标准编号: std.number,
            标准名称: std.name,
            代替标准号: '',
            实施日期: std.implement,
            发布日期: it.publish_date,
          }])
        : '[]';
      if (std.number) withStd++;
      const r = db.upsertContent('announcements', {
        title: it.title,
        source: '中国工程建设标准化协会',
        publish_date: it.publish_date,
        content: it.content,
        category: '团体标准公告',
        standards_json,
        source_url: BASE + it.href,
      });
      if (r.created) ok++;
      else skip++;
      total++;
    }
    console.log(`  第${p}/${pages}页：${items.length} 条`);
    if (onProgress) onProgress(p, pages);
  }
  return { total, ok, skip, fail, withStd };
}

module.exports = { crawlCecs, parseListPage, extractStandard };
