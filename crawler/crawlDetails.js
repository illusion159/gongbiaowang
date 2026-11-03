'use strict';

// 按标准编号补齐详情：搜索 → 详情 → 更新到 standards 表
// 针对库内「缺少发布日期」的标准，逐个用编号去 csres 搜索并抓取详情填充

const { fetchGBK, encodeGBK, BASE } = require('./fetch');
const { extractDetailIds, parseStandardDetail } = require('./parse');
const db = require('../db');

function normalize(n) {
  return String(n || '').replace(/\s+/g, '').toUpperCase();
}

function searchKeyword(stdNumber) {
  return String(stdNumber || '').split('/')[0].trim();
}

async function crawlStandardDetails({ maxDetails = 0, onProgress } = {}) {
  const rows = db.db.prepare(
    "SELECT id, std_number FROM standards WHERE (publish_date IS NULL OR publish_date = '') ORDER BY yearOf(std_number) DESC, id LIMIT ?"
  ).all(maxDetails > 0 ? maxDetails : -1);

  console.log(`待补详情：${rows.length} 条`);

  let updated = 0, notFound = 0, noMatch = 0;
  for (let i = 0; i < rows.length; i++) {
    const { id, std_number } = rows[i];
    const kw = searchKeyword(std_number);
    try {
      const listHtml = await fetchGBK(`${BASE}/s.jsp?keyword=${encodeGBK(kw)}&pageNum=1`);
      const candidates = extractDetailIds(listHtml);
      if (!candidates.length) {
        notFound++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗未搜索到`);
        continue;
      }

      let matched = false;
      for (const cid of candidates.slice(0, 5)) {
        const dhtml = await fetchGBK(`${BASE}/detail/${cid}.html`);
        const s = parseStandardDetail(dhtml);
        if (s.std_number && normalize(s.std_number) === normalize(std_number)) {
          s.source_url = `${BASE}/detail/${cid}.html`;
          db.updateStandardDetail(id, s);
          updated++;
          matched = true;
          console.log(`  [${i + 1}/${rows.length}] ${std_number} ✓ ${s.title} (${s.publish_date || '无日期'})`);
          break;
        }
      }
      if (!matched) {
        noMatch++;
        console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗编号不匹配`);
      }
    } catch (e) {
      console.log(`  [${i + 1}/${rows.length}] ${std_number} ✗ ${e.message}`);
    }
    if (onProgress) onProgress(i + 1, rows.length);
  }

  return { total: rows.length, updated, notFound, noMatch };
}

module.exports = { crawlStandardDetails };
