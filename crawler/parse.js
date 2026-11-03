'use strict';

const cheerio = require('cheerio');

function clean(s) {
  return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

// 提取页面内所有标准详情 id（/detail/NNN.html）
function extractDetailIds(html) {
  const ids = [];
  const re = /\/detail\/(\d+)\.html/g;
  let m;
  while ((m = re.exec(html))) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

// 提取 /notice/NNN.html 公告详情 id
function extractNoticeIds(html) {
  const ids = [];
  const re = /\/notice\/(\d+)\.html/g;
  let m;
  while ((m = re.exec(html))) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

// 提取 /info/NNN.html 动态详情 id
function extractInfoIds(html) {
  const ids = [];
  const re = /\/info\/(\d+)\.html/g;
  let m;
  while ((m = re.exec(html))) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

// 解析标准详情页
function parseStandardDetail(html) {
  const $ = cheerio.load(html);

  // 编号/状态/价格 是行内文本（如 <td>标准编号：<strong>...</strong></td>）
  const findInline = (label) => {
    let val = '';
    $('td').each((i, el) => {
      // 跳过包含嵌套表格的外层 td（其 text() 会把整张内表拼在一起）
      if ($(el).find('table').length > 0) return;
      const t = $(el).text().trim();
      if (t.startsWith(label + '：') || t.startsWith(label + ':')) {
        val = t.slice(label.length + 1).trim();
        return false;
      }
    });
    return val;
  };

  // 主字段：<strong>标签：</strong> 所在 td 的下一个 td
  const fieldByStrong = (label) => {
    let val = '';
    $('strong').each((i, el) => {
      const t = $(el).text().trim();
      if (t === label + '：' || t === label + ':') {
        const td = $(el).closest('td');
        val = clean(td.next('td').text());
        return false;
      }
    });
    return val;
  };

  const std_number = clean(findInline('标准编号'));
  const status = clean(findInline('标准状态')) || '现行';
  const price = parseFloat(findInline('标准价格')) || 0;

  const title_eng = fieldByStrong('英文名称');
  const replace_info = fieldByStrong('替代情况');
  const adopt_info = fieldByStrong('采标情况');
  const ccs_path = fieldByStrong('中标分类');
  const ics_path = fieldByStrong('ICS分类');
  const publish_dept = fieldByStrong('发布部门');
  const publish_date = (fieldByStrong('发布日期').match(/\d{4}-\d{1,2}-\d{1,2}/) || [''])[0];
  const implement_date = (fieldByStrong('实施日期').match(/\d{4}-\d{1,2}-\d{1,2}/) || [''])[0];
  const propose_unit = fieldByStrong('提出单位');
  const tech_committee = fieldByStrong('归口单位');
  const drafting_unit = fieldByStrong('起草单位');
  const drafters = fieldByStrong('起草人');
  const publisher = fieldByStrong('出版社');

  // 中标分类代码，如 T36
  const ccs_code = (ccs_path.match(/[A-Z]\d{1,3}/) || [''])[0];
  // ICS 代码，如 43.040
  const ics_code = (ics_path.match(/\d{2}\.\d{3}/) || [''])[0];

  // 简介
  const summary = clean($('td.f14').first().text());

  // 标题：从 <title> 提取，去掉编号前缀与 -工标网 后缀
  let title = clean($('title').text()).replace(/\s*-\s*工标网\s*$/, '');
  const idx = title.indexOf('《');
  if (idx >= 0) title = title.slice(idx);
  else if (std_number && title.startsWith(std_number)) title = title.slice(std_number.length).trim();

  return {
    std_number, title, title_eng, status, price, summary,
    replace_info, adopt_info, ccs_code, ccs_path, ics_code, ics_path,
    publish_dept, publish_date, implement_date, propose_unit,
    tech_committee, drafting_unit, drafters, publisher,
  };
}

// 解析公告 / 动态详情页（结构类似：标题、来源、更新时间、正文、附件表格）
function parseContentDetail(html) {
  const $ = cheerio.load(html);

  let title = clean($('title').text()).replace(/\s*-\s*工标网\s*$/, '');

  const bodyText = $('body').text();

  // 来源
  let source = '';
  const srcMatch = bodyText.match(/来源[：:]\s*([^\n]*)/);
  if (srcMatch) source = clean(srcMatch[1]).slice(0, 50);

  // 更新时间
  let publish_date = '';
  const dateMatch = bodyText.match(/更新时间[：:]\s*([0-9]{4}-[0-9]{1,2}-[0-9]{1,2})/);
  if (dateMatch) publish_date = dateMatch[1];

  // 正文：取日期之后到附件表（序号）之前的文本
  let content = '';
  if (dateMatch) {
    const dateIdx = bodyText.indexOf(dateMatch[1], bodyText.indexOf('更新时间'));
    let body = bodyText.slice(dateIdx + dateMatch[1].length);
    const tblIdx = body.indexOf('序号');
    if (tblIdx >= 0) body = body.slice(0, tblIdx);
    content = clean(body.replace(/^[：:\s]+/, ''));
  }

  // 附件标准表格
  const standards = parseAttachmentTable($);

  return { title, source, publish_date, content, standards };
}

// 解析公告附件标准表（表头：序号/标准编号/标准名称/代替标准号/实施日期/发布日期）
function parseAttachmentTable($) {
  const headers = ['序号', '标准编号', '标准名称', '代替标准号', '实施日期', '发布日期'];
  const result = [];

  // 找到文本恰好为「标准编号」的单元格，其所在行即表头行
  let headerRow = null;
  $('td, th').each((i, el) => {
    if (headerRow) return;
    if (clean($(el).text()) === '标准编号') headerRow = $(el).closest('tr');
  });
  if (!headerRow) return result;

  // 表头列索引
  const colMap = {};
  headerRow.find('td, th').each((i, el) => {
    const t = clean($(el).text());
    if (headers.includes(t)) colMap[t] = i;
  });
  if (!('标准编号' in colMap)) return result;

  // 数据行：表头行之后的兄弟行
  const table = headerRow.closest('table');
  let started = false;
  table.find('tr').each((i, row) => {
    if (row === headerRow[0]) { started = true; return; }
    if (!started) return;
    const cells = [];
    $(row).find('td, th').each((j, el) => { cells[j] = clean($(el).text()); });
    const number = cells[colMap['标准编号']];
    if (!number || !/^[A-Z0-9]/.test(number)) return;
    result.push({
      序号: cells[colMap['序号']] || '',
      标准编号: number,
      标准名称: cells[colMap['标准名称']] || '',
      代替标准号: colMap['代替标准号'] !== undefined ? cells[colMap['代替标准号']] || '' : '',
      实施日期: colMap['实施日期'] !== undefined ? cells[colMap['实施日期']] || '' : '',
      发布日期: colMap['发布日期'] !== undefined ? cells[colMap['发布日期']] || '' : '',
    });
  });

  return result;
}

module.exports = {
  clean,
  extractDetailIds,
  extractNoticeIds,
  extractInfoIds,
  parseStandardDetail,
  parseContentDetail,
};
