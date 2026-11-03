'use strict';

// 中标分类（中国标准分类 CCS）一级类目
const CCS_CATEGORIES = [
  { code: 'A', name: '综合' },
  { code: 'B', name: '农业、林业' },
  { code: 'C', name: '医药、卫生、劳动保护' },
  { code: 'D', name: '矿业' },
  { code: 'E', name: '石油' },
  { code: 'F', name: '能源、核技术' },
  { code: 'G', name: '化工' },
  { code: 'H', name: '冶金' },
  { code: 'J', name: '机械' },
  { code: 'K', name: '电工' },
  { code: 'L', name: '电子元器件与信息技术' },
  { code: 'M', name: '通信、广播' },
  { code: 'N', name: '仪器、仪表' },
  { code: 'P', name: '土木、建筑' },
  { code: 'Q', name: '建材' },
  { code: 'R', name: '公路、水路运输' },
  { code: 'S', name: '铁路' },
  { code: 'T', name: '车辆' },
  { code: 'U', name: '船舶' },
  { code: 'V', name: '航空、航天' },
  { code: 'W', name: '纺织' },
  { code: 'X', name: '食品' },
  { code: 'Y', name: '轻工、文化与生活用品' },
  { code: 'Z', name: '环境保护' },
];

// 行业标准分类（常用行业标准代号）
const INDUSTRY_CATEGORIES = [
  { code: 'GB', name: '国家标准' },
  { code: 'HG', name: '化工' },
  { code: 'JB', name: '机械' },
  { code: 'JC', name: '建材' },
  { code: 'FZ', name: '纺织' },
  { code: 'MT', name: '煤炭' },
  { code: 'YS', name: '有色金属' },
  { code: 'SY', name: '石油天然气' },
  { code: 'NB', name: '能源' },
  { code: 'DL', name: '电力' },
  { code: 'CB', name: '船舶' },
  { code: 'HB', name: '航空' },
  { code: 'QJ', name: '航天' },
  { code: 'QB', name: '轻工' },
  { code: 'SN', name: '出入境检验检疫' },
  { code: 'JT', name: '交通' },
  { code: 'JG', name: '建筑工业' },
  { code: 'CJ', name: '城镇建设' },
  { code: 'LY', name: '林业' },
  { code: 'NY', name: '农业' },
  { code: 'SC', name: '水产' },
  { code: 'GA', name: '公共安全' },
  { code: 'HJ', name: '环境保护' },
  { code: 'MH', name: '民用航空' },
  { code: 'WS', name: '卫生' },
  { code: 'YY', name: '医药' },
];

// 公告分类
const ANNOUNCEMENT_CATEGORIES = [
  '国家标准批准发布公告',
  '行业标准备案公告',
  '地方标准备案公告',
  '行业标准发布公告',
  '计划公告',
  '团体标准公告',
];

// 标准状态（作废已并入废止）
const STATUSES = ['现行', '即将实施', '废止'];

// 领域（检验检测能力项目一级领域）→ 中标分类代码 映射
// 用于把能力项目按名称归入已有的中标分类（如「食品检验」→ X 食品）
// 作为「行业代号 → 中标分类」映射不到的兜底
const DOMAIN_CCS_MAP = {
  '产品质量检验': 'A',
  '食品检验': 'X',
  '医疗器械检验': 'C',
  '农产品质量检验': 'B',
  '生态环境监测': 'Z',
  '司法鉴定检测': 'A',
  '林业产品质量检验': 'B',
  '进出口商品检验': 'A',
  '化妆品检验': 'Y',
  '机动车排放、安全技术检验': 'T',
  '林木种子、草种质量检验': 'B',
};

// 行业标准代号 → 中标分类代码 映射
// 每个行业标准代号本身就有对应的中标分类（如 HG 化工 → G 化工、JB 机械 → J 机械）
const INDUSTRY_TO_CCS = {
  HG: 'G', JB: 'J', JC: 'Q', FZ: 'W', MT: 'D', YS: 'H', SY: 'E', NB: 'F',
  DL: 'K', CB: 'U', HB: 'V', QJ: 'V', MH: 'V', QB: 'Y', SN: 'A', JT: 'R',
  JG: 'P', CJ: 'P', LY: 'B', NY: 'B', SC: 'B', GA: 'A', HJ: 'Z', WS: 'C',
  YY: 'C', YD: 'M', TB: 'S', QC: 'T', YB: 'H', SH: 'E', SJ: 'L', DZ: 'D',
  SB: 'A', IEC: 'K',
};

module.exports = {
  CCS_CATEGORIES,
  INDUSTRY_CATEGORIES,
  ANNOUNCEMENT_CATEGORIES,
  STATUSES,
  DOMAIN_CCS_MAP,
  INDUSTRY_TO_CCS,
};
