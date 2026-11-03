'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { DOMAIN_CCS_MAP, INDUSTRY_TO_CCS, CCS_CATEGORIES, INDUSTRY_CATEGORIES } = require('./data/classifications');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'gongbiao.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 自定义函数：从标准编号提取最大年份（如 GB9744-2024 → 2024；GB9744-2024/XG1-2025 → 2025）
// 只认「-YYYY」「:YYYY」「[YYYY]」「 YYYY」等前后有分隔符的年号，避免把序号/公告号误判为年份
db.function('yearOf', { deterministic: true }, (code) => {
  const re = /(?:^|[-:\[\s])((?:19|20)\d{2})(?=$|[/,\s)\]])/g;
  const s = String(code || '');
  let max = 0;
  let m;
  while ((m = re.exec(s))) {
    const y = Number(m[1]);
    if (y > max) max = y;
  }
  return max;
});

// 自定义函数：能力项目 → 中标分类代码
// 优先按标准编号的行业代号映射（HG→G、JB→J…），映射不到再按领域兜底（食品检验→X 等）
db.function('ccsOf', { deterministic: true }, (code, domain) => {
  const m = String(code || '').match(/^([A-Za-z]{1,4})(?=\d|\/|\s|$)/);
  const ind = m ? m[1].toUpperCase() : '';
  if (INDUSTRY_TO_CCS[ind]) return INDUSTRY_TO_CCS[ind];
  return DOMAIN_CCS_MAP[domain] || '';
});

// 自定义函数：标准编号 → 行业代号（如 GB、HG、JB、ISO…；非字母开头返回空串）
db.function('industryCodeOf', { deterministic: true }, (code) => {
  const m = String(code || '').match(/^([A-Za-z]{1,4})(?=\d|\/|\s|$)/);
  return m ? m[1].toUpperCase() : '';
});

// 清理标准名称：删除附在中文名后的英文翻译，并合并源数据中的换行
// 规则：英文片段中若含 ≥2 个「真实英文单词」（含小写字母且长度≥3）则视为翻译删除，
//       避免误删 LED、pH、GPS、kV 等技术缩略词
function cleanStandardMethod(s) {
  let t = String(s || '');
  t = t.replace(
    /[A-Za-z][A-Za-z0-9\-:,.()/]*(?:\s+[A-Za-z0-9\-:,.()/]+)+/g,
    (m) => {
      const words = m.match(/[A-Za-z][A-Za-z0-9]*/g) || [];
      const real = words.filter((w) => /[a-z]/.test(w) && w.length >= 3);
      return real.length >= 2 ? '' : m;
    }
  );
  // 补充：删除残留的注释尾巴
  // 1) 分号 + 英文注释（如 "; Replaces IEC 60606: 1978"、"; Corrigendum 1"）
  t = t.replace(/(?:;\s*)+(?=[^;]*[A-Za-z])[^;]*$/g, '');
  // 2) 带变音符的外文残留（如法语 "éétés chimiques"）
  t = t.replace(/[éèêëàâäùûüîïôöç][\s\S]*$/g, '');
  // 3) 中文名后以「=」开头的残留（如 "试验方法 = 36 = 550 kV)"）；内部 "Um=36kV" 不受影响
  t = t.replace(/(?<=[一-鿿])\s*=[\s\S]*$/g, '');
  // 4) "[Superseded...] / [Superseded By...]" 等注释
  t = t.replace(/\[Superseded[^\]]*\]\s*/g, '');
  t = t.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t;
}

// ---------- 建表 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS standards (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  std_number      TEXT,                 -- 标准编号  GB/T 43187-2023/XG1-2026
  title           TEXT,                 -- 标准名称
  title_eng       TEXT,                 -- 英文名称
  status          TEXT DEFAULT '现行',  -- 现行 / 即将实施 / 废止
  price           REAL DEFAULT 0,       -- 标准价格
  summary         TEXT,                 -- 标准简介
  content         TEXT,                 -- 详细内容
  replace_info    TEXT,                 -- 替代情况
  adopt_info      TEXT,                 -- 采标情况
  ccs_code        TEXT,                 -- 中标分类代码  T36
  ccs_path        TEXT,                 -- 中标分类路径  车辆>>车用电子...
  ics_code        TEXT,                 -- ICS 代码  43.040
  ics_path        TEXT,                 -- ICS 路径
  publish_dept    TEXT,                 -- 发布部门
  publish_date    TEXT,                 -- 发布日期
  implement_date  TEXT,                 -- 实施日期
  propose_unit    TEXT,                 -- 提出单位
  tech_committee  TEXT,                 -- 归口单位
  drafting_unit   TEXT,                 -- 起草单位
  drafters        TEXT,                 -- 起草人
  publisher       TEXT,                 -- 出版社
  source_url      TEXT,                 -- 来源链接
  pdf_url         TEXT,                 -- 原文件 PDF 预览链接
  created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT,                 -- 公告标题
  source        TEXT,                 -- 来源
  publish_date  TEXT,                 -- 发布时间
  content       TEXT,                 -- 正文
  category      TEXT,                 -- 公告分类
  standards_json TEXT,                -- 附件标准列表 JSON
  source_url    TEXT,
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS news (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT,
  source        TEXT,
  publish_date  TEXT,
  content       TEXT,
  category      TEXT,
  source_url    TEXT,
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);

-- 领域分类（检验检测机构资质认定能力项目库的领域，三级树）
CREATE TABLE IF NOT EXISTS domains (
  id            INTEGER PRIMARY KEY,   -- 源站 id
  name          TEXT,                  -- 领域名称
  parent_id     INTEGER DEFAULT 0,     -- 父领域 id
  level         INTEGER DEFAULT 1,     -- 层级 1/2/3
  order_number  INTEGER DEFAULT 0,
  remark        TEXT
);

-- 能力项目（检验检测能力项目库数据）
CREATE TABLE IF NOT EXISTS capability_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       INTEGER UNIQUE,      -- 源站 id
  domain          TEXT,                -- 领域名（一级）
  standard_method TEXT,                -- 标准(方法)名称
  standard_code   TEXT,                -- 标准编号(含年号)/文件号
  remark          TEXT,                -- 备注
  source_url      TEXT,
  created_at      TEXT DEFAULT (datetime('now','localtime'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_std_number   ON standards(std_number);
CREATE INDEX IF NOT EXISTS idx_std_title    ON standards(title);
CREATE INDEX IF NOT EXISTS idx_std_status   ON standards(status);
CREATE INDEX IF NOT EXISTS idx_std_ccs      ON standards(ccs_code);
CREATE INDEX IF NOT EXISTS idx_std_ics      ON standards(ics_code);
CREATE INDEX IF NOT EXISTS idx_std_pubdate  ON standards(publish_date);
-- 表达式索引：加速 分类/新标准 页的 substr()、yearOf()、industryCodeOf() 查询
CREATE INDEX IF NOT EXISTS idx_std_ccs_head   ON standards(substr(ccs_code,1,1));
CREATE INDEX IF NOT EXISTS idx_std_ccs_head_year ON standards(substr(ccs_code,1,1), yearOf(std_number) DESC);
CREATE INDEX IF NOT EXISTS idx_std_industry   ON standards(industryCodeOf(std_number));
CREATE INDEX IF NOT EXISTS idx_std_industry_year ON standards(industryCodeOf(std_number), yearOf(std_number) DESC);
CREATE INDEX IF NOT EXISTS idx_ann_date     ON announcements(publish_date);
CREATE INDEX IF NOT EXISTS idx_news_date    ON news(publish_date);
CREATE INDEX IF NOT EXISTS idx_cap_domain   ON capability_items(domain);
CREATE INDEX IF NOT EXISTS idx_cap_code     ON capability_items(standard_code);
`);

// 迁移：为已存在的库补充 pdf_url 列
{
  const stdCols = db.prepare('PRAGMA table_info(standards)').all().map((c) => c.name);
  if (!stdCols.includes('pdf_url')) db.exec('ALTER TABLE standards ADD COLUMN pdf_url TEXT');
}

// ---------- 标准查询 ----------
// 构建 WHERE 子句，q 为对象，键对应列名或特殊条件
function buildStandardWhere(q) {
  const clauses = [];
  const params = [];
  const exact = ['status', 'ccs_code', 'ics_code'];

  if (q.keyword) {
    const kw = `%${q.keyword}%`;
    clauses.push('(std_number LIKE ? OR title LIKE ? OR title_eng LIKE ?)');
    params.push(kw, kw, kw);
  }
  if (q.std_number) {
    clauses.push('std_number LIKE ?');
    params.push(`%${q.std_number}%`);
  }
  if (q.title) {
    clauses.push('title LIKE ?');
    params.push(`%${q.title}%`);
  }
  if (q.title_eng) {
    clauses.push('title_eng LIKE ?');
    params.push(`%${q.title_eng}%`);
  }
  if (q.replace_info) {
    clauses.push('replace_info LIKE ?');
    params.push(`%${q.replace_info}%`);
  }
  if (q.adopt_info) {
    clauses.push('adopt_info LIKE ?');
    params.push(`%${q.adopt_info}%`);
  }
  if (q.drafting_unit) {
    clauses.push('drafting_unit LIKE ?');
    params.push(`%${q.drafting_unit}%`);
  }
  if (q.tech_committee) {
    clauses.push('tech_committee LIKE ?');
    params.push(`%${q.tech_committee}%`);
  }
  if (q.ccs_code) {
    clauses.push('ccs_code LIKE ?');
    params.push(`${q.ccs_code}%`);
  }
  if (q.ics_code) {
    clauses.push('ics_code LIKE ?');
    params.push(`${q.ics_code}%`);
  }
  if (q.publish_dept) {
    clauses.push('publish_dept LIKE ?');
    params.push(`%${q.publish_dept}%`);
  }
  if (q.status) {
    clauses.push('status = ?');
    params.push(q.status);
  }

  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

function searchStandards(q = {}, page = 1, pageSize = 20, sortField = 'id', sortWay = 'desc') {
  const { where, params } = buildStandardWhere(q);
  const allowedSort = {
    id: 'id',
    std_number: 'std_number',
    publish_date: 'publish_date',
    implement_date: 'implement_date',
    status: 'status',
  };
  const sf = allowedSort[sortField] || 'id';
  const sw = sortWay === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM standards ${where}`).get(...params).c;
  const rows = db.prepare(
    `SELECT id, std_number, title, status, publish_dept, implement_date, ccs_code, ics_code
     FROM standards ${where} ORDER BY ${sf} ${sw} LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);

  // 状态统计
  const stats = db.prepare(
    `SELECT status, COUNT(*) AS c FROM standards ${where} GROUP BY status`
  ).all(...params);

  return { total, rows, stats, page, pageSize };
}

function getStandard(id) {
  return db.prepare('SELECT * FROM standards WHERE id = ?').get(id);
}

function getStandardCounts() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM standards').get().c;
  const byStatus = db.prepare('SELECT status, COUNT(*) AS c FROM standards GROUP BY status').all();
  const byCcs = db.prepare(
    `SELECT substr(ccs_code,1,1) AS k, COUNT(*) AS c FROM standards WHERE ccs_code IS NOT NULL AND ccs_code != '' GROUP BY k`
  ).all();
  const current = db.prepare("SELECT COUNT(*) AS c FROM standards WHERE status = '现行'").get().c;
  const upcoming = db.prepare("SELECT COUNT(*) AS c FROM standards WHERE status = '即将实施'").get().c;
  const abolished = db.prepare("SELECT COUNT(*) AS c FROM standards WHERE status = '废止'").get().c;
  return { total, byStatus, byCcs, current, upcoming, abolished };
}

// 中标分类计数（A–Z）：一条 GROUP BY 取代 24 次 COUNT，供首页/分类页缓存复用
function getCcsStats() {
  const m = {};
  db.prepare("SELECT substr(ccs_code,1,1) AS code, COUNT(*) AS c FROM standards GROUP BY substr(ccs_code,1,1)")
    .all().forEach((r) => { if (r.code) m[r.code] = r.c; });
  return CCS_CATEGORIES.map((c) => ({ ...c, count: m[c.code] || 0 }));
}

// 行业分类计数：一条 GROUP BY 取代 26 次 COUNT（编号前两位即行业代号）
function getIndustryStats() {
  const m = {};
  db.prepare("SELECT substr(std_number,1,2) AS code, COUNT(*) AS c FROM standards GROUP BY substr(std_number,1,2)")
    .all().forEach((r) => { if (r.code) m[r.code] = r.c; });
  return INDUSTRY_CATEGORIES.map((c) => ({ ...c, count: m[c.code] || 0 }));
}

// ---------- 公告 / 动态 ----------
function listContent(table, { category, keyword, page = 1, pageSize = 20 }) {
  const clauses = [];
  const params = [];
  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }
  if (keyword) {
    clauses.push('(title LIKE ? OR content LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const offset = (page - 1) * pageSize;
  const total = db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get(...params).c;
  const rows = db.prepare(
    `SELECT id, title, source, publish_date, category FROM ${table} ${where} ORDER BY publish_date DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);
  return { total, rows, page, pageSize };
}

function getContent(table, id) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

// ---------- 爬虫写入 ----------

// 标准状态归一化：不同数据源的状态叫法不同（csres 用「已废止/已作废」，CMA 用「废止」），
// 统一到规范值，避免概览里被拆成多个重复分类
const STATUS_ALIASES = {
  已废止: '废止',
  已作废: '废止',
  作废: '废止',
  被代替: '废止',   // spc 用「被代替」表示已被新标准取代
  已实施: '现行',
  有效: '现行',
};
function normalizeStatus(s) {
  let v = String(s || '').trim();
  // 去掉 openstd 页面按钮等混入的后缀，如「现行 在线预览 下载标准」→「现行」
  v = v.replace(/\s*(在线预览|下载标准).*$/g, '').trim();
  return STATUS_ALIASES[v] || v || '现行';
}

const insertStandardStmt = db.prepare(`
  INSERT INTO standards (
    std_number, title, title_eng, status, price, summary, replace_info, adopt_info,
    ccs_code, ccs_path, ics_code, ics_path, publish_dept, publish_date, implement_date,
    propose_unit, tech_committee, drafting_unit, drafters, publisher, source_url
  ) VALUES (
    @std_number, @title, @title_eng, @status, @price, @summary, @replace_info, @adopt_info,
    @ccs_code, @ccs_path, @ics_code, @ics_path, @publish_dept, @publish_date, @implement_date,
    @propose_unit, @tech_committee, @drafting_unit, @drafters, @publisher, @source_url
  )
`);

function upsertStandard(s) {
  // 以标准编号去重
  const exist = db.prepare('SELECT id FROM standards WHERE std_number = ?').get(s.std_number);
  if (exist) return { id: exist.id, created: false };
  const info = insertStandardStmt.run({
    std_number: s.std_number || '',
    title: s.title || '',
    title_eng: s.title_eng || '',
    status: normalizeStatus(s.status),
    price: s.price || 0,
    summary: s.summary || '',
    replace_info: s.replace_info || '',
    adopt_info: s.adopt_info || '',
    ccs_code: s.ccs_code || '',
    ccs_path: s.ccs_path || '',
    ics_code: s.ics_code || '',
    ics_path: s.ics_path || '',
    publish_dept: s.publish_dept || '',
    publish_date: s.publish_date || '',
    implement_date: s.implement_date || '',
    propose_unit: s.propose_unit || '',
    tech_committee: s.tech_committee || '',
    drafting_unit: s.drafting_unit || '',
    drafters: s.drafters || '',
    publisher: s.publisher || '',
    source_url: s.source_url || '',
  });
  return { id: info.lastInsertRowid, created: true };
}

function upsertContent(table, c) {
  const exist = db.prepare(`SELECT id FROM ${table} WHERE source_url = ? AND source_url != ''`).get(c.source_url || '');
  if (exist) return { id: exist.id, created: false };
  if (table === 'announcements') {
    const info = db.prepare(
      'INSERT INTO announcements (title, source, publish_date, content, category, standards_json, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(c.title || '', c.source || '', c.publish_date || '', c.content || '', c.category || '',
      c.standards_json || '', c.source_url || '');
    return { id: info.lastInsertRowid, created: true };
  }
  const info = db.prepare(
    'INSERT INTO news (title, source, publish_date, content, category, source_url) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(c.title || '', c.source || '', c.publish_date || '', c.content || '', c.category || '', c.source_url || '');
  return { id: info.lastInsertRowid, created: true };
}

// ---------- 领域（分类） ----------
const upsertDomainStmt = db.prepare(`
  INSERT INTO domains (id, name, parent_id, level, order_number, remark)
  VALUES (@id, @name, @parent_id, @level, @order_number, @remark)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    parent_id = excluded.parent_id,
    level = excluded.level,
    order_number = excluded.order_number,
    remark = excluded.remark
`);

function upsertDomain(d) {
  return upsertDomainStmt.run({
    id: d.id,
    name: d.name || '',
    parent_id: d.parent_id || 0,
    level: d.level || 1,
    order_number: d.order_number || 0,
    remark: d.remark || '',
  });
}

function getDomains() {
  return db.prepare('SELECT * FROM domains ORDER BY level, order_number, id').all();
}

function getTopDomains() {
  return db.prepare('SELECT * FROM domains WHERE parent_id = 0 ORDER BY order_number, id').all();
}

// 一级领域名列表（能力项目按此打标）
function getTopDomainNames() {
  return db.prepare('SELECT DISTINCT domain FROM capability_items WHERE domain IS NOT NULL AND domain != ""').all()
    .map((r) => r.domain);
}

// ---------- 能力项目 ----------
const upsertCapabilityStmt = db.prepare(`
  INSERT INTO capability_items (source_id, domain, standard_method, standard_code, remark, source_url)
  VALUES (@source_id, @domain, @standard_method, @standard_code, @remark, @source_url)
  ON CONFLICT(source_id) DO UPDATE SET
    domain = excluded.domain,
    standard_method = excluded.standard_method,
    standard_code = excluded.standard_code,
    remark = excluded.remark
`);

function upsertCapabilityItem(c) {
  return upsertCapabilityStmt.run({
    source_id: c.source_id,
    domain: c.domain || '',
    standard_method: cleanStandardMethod(c.standard_method),
    standard_code: c.standard_code || '',
    remark: c.remark || '',
    source_url: c.source_url || '',
  });
}

// 领域（一级）统计
function getCapabilityDomainCounts() {
  return db.prepare(
    'SELECT domain, COUNT(*) AS c FROM capability_items GROUP BY domain ORDER BY c DESC'
  ).all();
}

function getCapabilityTotal() {
  return db.prepare('SELECT COUNT(*) AS c FROM capability_items').get().c;
}

// 能力项目列表（可按领域 + 关键词过滤）
function listCapabilityItems({ domain, keyword, page = 1, pageSize = 20 }) {
  const clauses = [];
  const params = [];
  if (domain) {
    clauses.push('domain = ?');
    params.push(domain);
  }
  if (keyword) {
    clauses.push('(standard_method LIKE ? OR standard_code LIKE ? OR remark LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const offset = (page - 1) * pageSize;
  const total = db.prepare(`SELECT COUNT(*) AS c FROM capability_items ${where}`).get(...params).c;
  const rows = db.prepare(
    `SELECT id, source_id, domain, standard_method, standard_code, remark
     FROM capability_items ${where} ORDER BY standard_code, id LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);
  return { total, rows, page, pageSize };
}

// 能力项目按中标分类（领域映射）计数
function getCapabilityCcsCounts() {
  return db.prepare(
    "SELECT ccsOf(standard_code, domain) AS code, COUNT(*) AS c FROM capability_items WHERE ccsOf(standard_code, domain) != '' GROUP BY code"
  ).all();
}

// 能力项目按行业分类（标准编号前缀）计数
function getCapabilityIndustryCounts() {
  return db.prepare(
    "SELECT industryCodeOf(standard_code) AS code, COUNT(*) AS c FROM capability_items WHERE industryCodeOf(standard_code) != '' GROUP BY code"
  ).all();
}

// 中标分类下的能力项目列表（分页，按标准编号年份倒序）
function listCapabilityByCcs(code, page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const total = db.prepare('SELECT COUNT(*) AS c FROM capability_items WHERE ccsOf(standard_code, domain) = ?').get(code).c;
  const rows = db.prepare(
    `SELECT domain, standard_method, standard_code, yearOf(standard_code) AS year
     FROM capability_items WHERE ccsOf(standard_code, domain) = ?
     ORDER BY yearOf(standard_code) DESC, standard_code DESC LIMIT ? OFFSET ?`
  ).all(code, pageSize, offset);
  return { total, rows, page, pageSize };
}

// 行业分类下的能力项目列表（分页，按标准编号年份倒序）
function listCapabilityByIndustry(code, page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const total = db.prepare('SELECT COUNT(*) AS c FROM capability_items WHERE industryCodeOf(standard_code) = ?').get(code).c;
  const rows = db.prepare(
    `SELECT domain, standard_method, standard_code, yearOf(standard_code) AS year
     FROM capability_items WHERE industryCodeOf(standard_code) = ?
     ORDER BY yearOf(standard_code) DESC, standard_code DESC LIMIT ? OFFSET ?`
  ).all(code, pageSize, offset);
  return { total, rows, page, pageSize };
}

// 每个中标分类取年份最新的前 N 条能力项目
function getLatestByCcs(limit = 10) {
  const codes = db.prepare(
    "SELECT DISTINCT ccsOf(standard_code, domain) AS code FROM capability_items WHERE ccsOf(standard_code, domain) != '' ORDER BY code"
  ).all();
  return codes.map(({ code }) => ({
    code,
    items: db.prepare(
      `SELECT standard_method, standard_code, yearOf(standard_code) AS year
       FROM capability_items WHERE ccsOf(standard_code, domain) = ?
       ORDER BY yearOf(standard_code) DESC, standard_code DESC LIMIT ?`
    ).all(code, limit),
  }));
}

// 每个行业分类（标准编号前缀）取年份最新的前 N 条能力项目
function getLatestByIndustry(limit = 10) {
  const codes = db.prepare(
    "SELECT DISTINCT industryCodeOf(standard_code) AS code FROM capability_items WHERE industryCodeOf(standard_code) != '' ORDER BY code"
  ).all();
  return codes.map(({ code }) => ({
    code,
    items: db.prepare(
      `SELECT standard_method, standard_code, yearOf(standard_code) AS year
       FROM capability_items WHERE industryCodeOf(standard_code) = ?
       ORDER BY yearOf(standard_code) DESC, standard_code DESC LIMIT ?`
    ).all(code, limit),
  }));
}

// 每个中标分类取年份最新的前 N 条标准（统一后的 standards 表）
function getLatestStandardsByCcs(limit = 10) {
  const codes = db.prepare(
    "SELECT DISTINCT upper(substr(ccs_code,1,1)) AS code FROM standards WHERE ccs_code IS NOT NULL AND ccs_code != '' AND upper(substr(ccs_code,1,1)) GLOB '[A-Z]' ORDER BY code"
  ).all();
  return codes.map(({ code }) => ({
    code,
    items: db.prepare(
      `SELECT id, std_number, title, status
       FROM standards WHERE upper(substr(ccs_code,1,1)) = ?
       ORDER BY publish_date DESC, yearOf(std_number) DESC, std_number DESC LIMIT ?`
    ).all(code, limit),
  }));
}

// 每个行业分类（标准编号前缀）取年份最新的前 N 条标准
function getLatestStandardsByIndustry(limit = 10) {
  const codes = db.prepare(
    "SELECT DISTINCT industryCodeOf(std_number) AS code FROM standards WHERE industryCodeOf(std_number) != '' ORDER BY code"
  ).all();
  return codes.map(({ code }) => ({
    code,
    items: db.prepare(
      `SELECT id, std_number, title, status
       FROM standards WHERE industryCodeOf(std_number) = ?
       ORDER BY publish_date DESC, yearOf(std_number) DESC, std_number DESC LIMIT ?`
    ).all(code, limit),
  }));
}

// 用爬取的详情更新已有标准（保留编号；爬取字段为空时保留原值）
function updateStandardDetail(id, s) {
  const cur = db.prepare('SELECT * FROM standards WHERE id = ?').get(id);
  if (!cur) return { changes: 0 };
  // 源数据未提供（undefined/空串）时保留库内原值，避免 A 源擦掉 B 源已填的字段
  const pick = (key) =>
    s[key] !== undefined && s[key] !== null && String(s[key]).trim() !== '' ? s[key] : cur[key];
  return db.prepare(`
    UPDATE standards SET
      title = ?, title_eng = ?, status = ?, price = ?, summary = ?,
      replace_info = ?, adopt_info = ?, ccs_code = ?, ccs_path = ?,
      ics_code = ?, ics_path = ?, publish_dept = ?, publish_date = ?,
      implement_date = ?, propose_unit = ?, tech_committee = ?,
      drafting_unit = ?, drafters = ?, publisher = ?, source_url = ?, pdf_url = ?
    WHERE id = ?
  `).run(
    pick('title'), pick('title_eng'), normalizeStatus(s.status || cur.status), pick('price'), pick('summary'),
    pick('replace_info'), pick('adopt_info'), pick('ccs_code'), pick('ccs_path'),
    pick('ics_code'), pick('ics_path'), pick('publish_dept'), pick('publish_date'),
    pick('implement_date'), pick('propose_unit'), pick('tech_committee'),
    pick('drafting_unit'), pick('drafters'), pick('publisher'), pick('source_url'), pick('pdf_url'),
    id
  );
}

module.exports = {
  db,
  DB_PATH,
  searchStandards,
  getStandard,
  getStandardCounts,
  getCcsStats,
  getIndustryStats,
  listContent,
  getContent,
  upsertStandard,
  upsertContent,
  upsertDomain,
  getDomains,
  getTopDomains,
  getTopDomainNames,
  upsertCapabilityItem,
  getCapabilityDomainCounts,
  getCapabilityTotal,
  listCapabilityItems,
  getCapabilityCcsCounts,
  getCapabilityIndustryCounts,
  listCapabilityByCcs,
  listCapabilityByIndustry,
  getLatestByCcs,
  getLatestByIndustry,
  getLatestStandardsByCcs,
  getLatestStandardsByIndustry,
  cleanStandardMethod,
  updateStandardDetail,
};
