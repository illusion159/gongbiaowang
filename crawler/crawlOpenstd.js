'use strict';

// 从 国家标准全文公开系统（openstd.samr.gov.cn）抓取国标详情 + 原文件 PDF 链接
// 搜索 std_list?p.p2=<keyword> → showInfo(hcno)
// 详情 newGbInfo?hcno=<hcno> → 标准号/名称/英文名/状态/CCS/ICS/发布/实施/主管/归口/发布单位
// PDF  showGb?type=online&hcno=<hcno>（仅「现行/即将实施」标准提供）

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db');

const BASE = 'http://openstd.samr.gov.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DELAY = 800;

let lastRequest = 0;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function get(url) {
  const now = Date.now();
  const wait = Math.max(0, lastRequest + DELAY - now);
  if (wait) await sleep(wait);
  lastRequest = Date.now();
  const resp = await axios.get(url, {
    headers: { 'User-Agent': UA, Referer: BASE + '/bzgk/gb/' },
    timeout: 25000,
    maxRedirects: 5,
    responseType: 'text',
  });
  return resp.data;
}

function normalize(n) { return String(n || '').replace(/\s+/g, '').toUpperCase(); }

// 搜索并返回 hcno 列表
async function searchHcno(keyword) {
  const html = await get(`${BASE}/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=${encodeURIComponent(keyword)}`);
  const hcnos = [...html.matchAll(/showInfo\('([A-Z0-9]+)'\)/g)].map((m) => m[1]);
  return [...new Set(hcnos)];
}

// 解析详情页
function parseDetail(html, hcno) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  const grab = (label, ...nexts) => {
    const i = text.indexOf(label);
    if (i < 0) return '';
    let v = text.slice(i + label.length).replace(/^[：:]\s*/, '');
    for (const n of nexts) {
      const j = v.indexOf(n);
      if (j >= 0) v = v.slice(0, j);
    }
    return v.trim();
  };

  const std_number = grab('标准号', '中文标准名称').replace(/[一-鿿].*$/, '').trim();
  const status = grab('标准状态', '在线预览', '下载标准', '实施信息反馈', '中国标准分类号');
  const publish_date = grab('发布日期', '实施日期');
  const implement_date = grab('实施日期', '主管部门');
  const publish_dept = grab('发布单位', '备注') || grab('主管部门', '归口部门');
  const tech_committee = grab('归口部门', '发布单位');

  // 仅现行/即将实施提供 PDF
  let pdf_url = '';
  if (!/废止|作废/.test(status)) {
    pdf_url = `${BASE}/bzgk/std/showGb?type=online&hcno=${hcno}&request_locale=zh`;
  }

  return {
    std_number: std_number,
    title: grab('中文标准名称', '英文标准名称'),
    title_eng: grab('英文标准名称', '标准状态'),
    status,
    ccs_code: grab('中国标准分类号（CCS）', '国际标准分类号') || grab('中国标准分类号', '国际标准分类号'),
    ics_code: grab('国际标准分类号（ICS）', '发布日期') || grab('国际标准分类号', '发布日期'),
    publish_date: (publish_date.match(/\d{4}-\d{1,2}-\d{1,2}/) || [''])[0],
    implement_date: (implement_date.match(/\d{4}-\d{1,2}-\d{1,2}/) || [''])[0],
    publish_dept,
    tech_committee,
    pdf_url,
    source_url: `${BASE}/bzgk/gb/newGbInfo?hcno=${hcno}`,
  };
}

// 从标准编号提取搜索关键词（取首段数字含小数点，如 GB7956.9-2025 → 7956.9）
function searchCore(n) {
  const m = String(n || '').match(/\d[\d.]*/);
  return m ? m[0] : String(n || '').trim();
}

async function crawlOpenstd({ maxDetails = 10, onProgress } = {}) {
  // 选「现行」且无修改单后缀的 GB 标准
  const rows = db.db.prepare(
    "SELECT id, std_number, title FROM standards WHERE status='现行' AND std_number GLOB 'GB*' AND std_number NOT LIKE '%/XG%' AND (pdf_url IS NULL OR pdf_url = '') ORDER BY yearOf(std_number) DESC, id LIMIT ?"
  ).all(maxDetails > 0 ? maxDetails : -1);

  console.log(`待抓取国标：${rows.length} 条`);

  let updated = 0, noPdf = 0, notFound = 0, noMatch = 0, consecutiveFail = 0;
  for (let i = 0; i < rows.length; i++) {
    const { id, std_number } = rows[i];
    const core = searchCore(std_number);
    try {
      const hcnos = await searchHcno(core);
      consecutiveFail = 0;
      if (!hcnos.length) {
        notFound++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗未搜索到(key=${core})`);
        continue;
      }
      let matched = false;
      for (const hcno of hcnos.slice(0, 20)) {
        const html = await get(`${BASE}/bzgk/gb/newGbInfo?hcno=${hcno}`);
        const s = parseDetail(html, hcno);
        if (s.std_number && normalize(s.std_number) === normalize(std_number)) {
          db.updateStandardDetail(id, s);
          updated++;
          matched = true;
          console.log(`  [${i + 1}/${rows.length}] ${std_number} ✓ ${s.title} (${s.publish_date || '无日期'}) PDF:${s.pdf_url ? '有' : '无'}`);
          if (!s.pdf_url) noPdf++;
          break;
        }
      }
      if (!matched) {
        noMatch++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗编号不匹配`);
      }
    } catch (e) {
      consecutiveFail++;
      console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗ ${e.message}`);
      if (consecutiveFail >= 40) {
        console.log(`  ⚠ 连续 ${consecutiveFail} 次请求失败，疑似被限流/封禁，中止本次抓取。`);
        break;
      }
    }
    if (onProgress) onProgress(i + 1, rows.length);
  }
  return { total: rows.length, updated, noPdf, notFound, noMatch };
}

module.exports = { crawlOpenstd, parseDetail, searchHcno };
