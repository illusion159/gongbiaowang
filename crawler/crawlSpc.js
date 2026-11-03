'use strict';

// 从 中国标准在线服务网（spc.org.cn）批量补标准详情：搜索 → 详情 → 更新 standards 表
// 页面含「适用范围（简介）+ 发布日期/实施日期/发布部门/状态/ICS/CCS/英文名」等字段
//
// 说明：csres.com（工标网）已对爬虫限流/封禁（搜索返回「无权访问」，详情重定向 noRight.html），
// 因此这里改用 spc.org.cn 作为详情数据源。

const axios = require('axios');
const cheerio = require('cheerio');
const db = require('../db');

const BASE = 'https://www.spc.org.cn';
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

// 规范化：去空白、转大写（用于比较标准编号）
function normalize(n) {
  return String(n || '').replace(/\s+/g, '').toUpperCase();
}

// 从标准编号中去除「修改单/勘误/增补」后缀，得到可搜索的基础编号。
// 只剥离开头为 XG/ZG/AMD/Amd/Cor/A 的修订后缀，保留 /T（推荐性）、/Z（指导性）等类型标记。
function baseNumber(stdNumber) {
  return String(stdNumber || '')
    .replace(/\s*\/\s*(?:XG\d+-\d+|ZG\d+-\d+|AMD\d+:\d+|Amd[.\s]?\d+[:,\-]\d+|Cor[.\s]?\d+[:,\-]\d+|A\d+:\d+)\s*$/i, '')
    .trim();
}

// 从搜索结果条目的 alt/title（形如 "GB 11551-2014 汽车正面碰撞的乘员保护"）提取标准编号
function stdFromAlt(alt) {
  const s = String(alt || '').trim();
  // 标准号 = 字母前缀(可选 /T /Z 等) + 数字段 + 年份（-2023 或 :2023），之后才是名称；
  // 这样能避开标题里以数字/字母开头的部分（如 "25kV铁道…"）被误并入编号
  const m = s.match(/^([A-Za-z]{1,4}(?:\/[A-Za-z])?\s*\d[\d./、\-]*?[-:]\s?\d{4})/);
  if (m) return m[1].trim();
  // 无年份时兜底：取开头字母数字段
  const m2 = s.match(/^([A-Za-z][A-Za-z0-9/.、\- ]*?)(?=\s*[一-鿿])/);
  return (m2 ? m2[1] : s.split(' ')[0]).trim();
}

// 搜索并返回候选结果列表 [{ hash, std_number }]
async function searchSpc(keyword) {
  const html = await get(`${BASE}/basicsearch?text=${encodeURIComponent(keyword)}`);
  const out = [];
  const re = /<a href="\/online\/([a-f0-9]+)\.html"[^>]*>[\s\S]*?<span alt="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const hash = m[1];
    const std_number = stdFromAlt(m[2]);
    if (std_number && !out.some((o) => o.hash === hash)) out.push({ hash, std_number });
  }
  return out;
}

// 解析详情页
function parseSpcDetail(html) {
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
    std_number: grab('标准号：', '标准名称'),
    title: grab('标准名称：', '英文名称'),
    title_eng: grab('英文名称：', '标准状态'),
    status: grab('标准状态：', '发布日期'),
    publish_date: (grab('发布日期：', '实施日期').match(/\d{4}-\d{1,2}-\d{1,2}/) || [''])[0],
    implement_date: (grab('实施日期：', '出版语种').match(/\d{4}-\d{1,2}-\d{1,2}/) || [''])[0],
    ics_code: grab('标准ICS号：', '中标分类号'),
    ccs_code: grab('中标分类号：', '关联标准'),
    summary: grab('适用范围：', '基本信息'),
    drafters: grab('起草人：', '起草单位'),
    drafting_unit: grab('起草单位：', '归口单位'),
    tech_committee: grab('归口单位：', '提出部门'),
    propose_unit: grab('提出部门：', '发布部门'), // spc 用「提出部门」，对应 csres 的「提出单位」
    publish_dept: grab('发布部门：', '其它标准', '上一篇'),
  };
}

async function crawlStandardDetailsFromSpc({ maxDetails = 0, onProgress } = {}) {
  const rows = db.db.prepare(
    "SELECT id, std_number FROM standards WHERE (publish_date IS NULL OR publish_date = '') AND std_number GLOB '[A-Z]*' ORDER BY yearOf(std_number) DESC, id LIMIT ?"
  ).all(maxDetails > 0 ? maxDetails : -1);

  console.log(`待补详情：${rows.length} 条`);

  let updated = 0, notFound = 0, noMatch = 0, failed = 0, consecutiveFail = 0;
  for (let i = 0; i < rows.length; i++) {
    const { id, std_number } = rows[i];
    const full = normalize(std_number);
    const base = normalize(baseNumber(std_number));
    const kw = baseNumber(std_number);

    try {
      const results = await searchSpc(kw);
      consecutiveFail = 0;
      if (!results.length) {
        notFound++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗未搜索到`);
        if (onProgress) onProgress(i + 1, rows.length);
        continue;
      }

      // 1) 精确匹配完整编号（含修改单 /XG1-2026 等）
      let match = results.find((r) => normalize(r.std_number) === full);
      // 2) 库内是修改单/勘误且搜不到精确条目 → 跳过，避免用基础标准数据冒充
      if (!match && full !== base) {
        noMatch++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗仅基础编号(${results.map((r) => r.std_number).join(',')})`);
        if (onProgress) onProgress(i + 1, rows.length);
        continue;
      }
      // 3) 普通标准：按基础编号匹配
      if (!match) match = results.find((r) => normalize(r.std_number) === base);
      if (!match) {
        noMatch++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗编号不匹配(${results.map((r) => r.std_number).join(',')})`);
        if (onProgress) onProgress(i + 1, rows.length);
        continue;
      }

      const detailHtml = await get(`${BASE}/online/${match.hash}.html`);
      const s = parseSpcDetail(detailHtml);
      if (!s.std_number || normalize(s.std_number) !== normalize(match.std_number)) {
        noMatch++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗详情编号不符(${s.std_number})`);
        if (onProgress) onProgress(i + 1, rows.length);
        continue;
      }

      db.updateStandardDetail(id, { ...s, source_url: `${BASE}/online/${match.hash}.html` });
      updated++;
      console.log(`  [${i + 1}/${rows.length}] ${std_number} ✓ ${s.title} (${s.publish_date || '无日期'})`);
    } catch (e) {
      failed++;
      consecutiveFail++;
      console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗ ${e.message}`);
      if (consecutiveFail >= 40) {
        console.log(`  ⚠ 连续 ${consecutiveFail} 次请求失败，疑似被限流/封禁，中止本次抓取。`);
        break;
      }
    }
    if (onProgress) onProgress(i + 1, rows.length);
  }

  return { total: rows.length, updated, notFound, noMatch, failed };
}

module.exports = { crawlStandardDetailsFromSpc, parseSpcDetail, baseNumber };
