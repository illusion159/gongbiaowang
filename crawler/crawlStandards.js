'use strict';

const { fetchGBK, encodeGBK, absUrl, BASE, sleep } = require('./fetch');
const { extractDetailIds, parseStandardDetail } = require('./parse');
const db = require('../db');

// 抓取指定关键词的标准：搜索列表 → 详情
async function crawlStandards({ keywords, pagesPerKeyword = 1, maxDetails = 50, onProgress } = {}) {
  const detailIds = [];

  for (const kw of keywords) {
    for (let p = 1; p <= pagesPerKeyword; p++) {
      const url = `${BASE}/s.jsp?keyword=${encodeGBK(kw)}&pageNum=${p}`;
      log(`搜索【${kw}】第 ${p} 页: ${url}`);
      let html;
      try {
        html = await fetchGBK(url);
      } catch (e) {
        log(`  ✗ 抓取失败: ${e.message}`);
        continue;
      }
      const ids = extractDetailIds(html);
      log(`  发现 ${ids.length} 条标准`);
      for (const id of ids) {
        if (!detailIds.includes(id)) detailIds.push(id);
      }
      if (ids.length === 0) break;
    }
  }

  log(`共收集 ${detailIds.length} 个详情页，最多抓取 ${maxDetails} 个`);
  const targets = detailIds.slice(0, maxDetails);

  let ok = 0;
  for (let i = 0; i < targets.length; i++) {
    const id = targets[i];
    const url = `${BASE}/detail/${id}.html`;
    try {
      const html = await fetchGBK(url);
      const s = parseStandardDetail(html);
      if (s.std_number) {
        s.source_url = url;
        const r = db.upsertStandard(s);
        ok += r.created ? 1 : 0;
        log(`  [${i + 1}/${targets.length}] ${s.std_number} ${s.title} ${r.created ? '✓新增' : '-已存在'}`);
      } else {
        log(`  [${i + 1}/${targets.length}] id=${id} 未解析到编号，跳过`);
      }
    } catch (e) {
      log(`  [${i + 1}/${targets.length}] id=${id} ✗ ${e.message}`);
    }
    if (onProgress) onProgress(i + 1, targets.length);
  }

  return { total: targets.length, ok };
}

function log(msg) {
  console.log(msg);
}

module.exports = { crawlStandards };
