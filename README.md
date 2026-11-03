# 工标网 · 标准查询门户

一个功能对标 [csres.com（工标网）](http://www.csres.com) 的标准查询网站。使用 **Node.js + Express + SQLite** 搭建，内置**可扩展爬虫**，可抓取真实标准数据并填充到对应板块。

## 功能

- **标准搜索**：按标准编号 / 名称 / 英文名 / 替代情况 / 采标情况 / 中标分类 / ICS 分类 / 起草单位 / 归口单位 / 发布部门 / 状态等字段检索
- **高级查询**：多字段组合 + 排序方式选择
- **公告搜索**：按关键词检索标准公告
- **标准分类浏览**：中标分类（CCS A–Z）、行业标准分类（GB/HG/JB/JC/FZ/MT…）
- **最新标准**：按发布日期倒序
- **标准公告**：分类列表 + 详情（含公告涉及标准清单）
- **标准动态**：资讯列表 + 详情
- **标准详情页**：编号、名称、英文名、状态、价格、简介、替代/采标情况、中标/ICS 分类、发布部门、发布/实施日期、提出/归口单位、起草单位、起草人、出版社
- **能力项目库**：检验检测机构资质认定能力项目（来源 cma.caqit.org.cn），按「领域」三级分类浏览 + 全库搜索
- **用户注册 / 登录**（HMAC 签名 Cookie，无额外依赖）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动网站
npm start          # 或 npm run dev（自动重启）

# 3. 抓取示例数据（可选，抓取 csres 真实数据）
npm run crawl      # 抓取 标准 + 公告 + 动态 + 能力项目
npm run crawl 标准  # 只抓标准
npm run crawl 公告  # 只抓公告
npm run crawl 动态  # 只抓动态
npm run crawl 能力项目  # 只抓能力项目（CMA）
```


## 爬虫配置

编辑 `crawler/index.js` 顶部的 `CONFIG` 对象即可调整抓取范围：

```js
const CONFIG = {
  standards: {
    keywords: ['国家标准', '化工', '机械', '纺织', '建材'], // 搜索关键词
    pagesPerKeyword: 1,   // 每个关键词抓几页结果
    maxDetails: 40,       // 最多抓取多少个标准详情
  },
  announcements: { maxDetails: 10 },
  news: { maxDetails: 10 },
  // 能力项目（CMA 检验检测能力项目库，JSON 接口，无需 HTML 解析）
  capability: {
    maxItems: 0,          // 0 = 全部抓取；>0 则限制条数
    pageSize: 500,
  },
};
```

> 抓取间隔默认 800ms（见 `crawler/fetch.js` 的 `DELAY`），请保持礼貌抓取、不要调得过低。

## 目录结构

```
工标网/
├── server.js                # Express 入口
├── db.js                    # SQLite 建表 + 查询 + 写入
├── data/
│   ├── classifications.js   # 中标分类 / 行业分类 / 公告分类 静态数据
│   └── gongbiao.db          # SQLite 数据库（运行时生成）
├── routes/                  # 路由
│   ├── home.js              # 首页
│   ├── search.js            # 标准/公告搜索 + 高级查询
│   ├── standard.js          # 标准详情
│   ├── category.js          # 分类浏览
│   ├── content.js           # 公告 + 动态
│   └── user.js              # 登录/注册
├── lib/auth.js              # 登录态签名工具
├── crawler/                 # 爬虫
│   ├── index.js             # 入口 + 配置
│   ├── fetch.js             # 请求（GBK 解码、限速、重试）
│   ├── parse.js             # 页面解析
│   ├── crawlStandards.js    # 标准抓取
│   ├── crawlContent.js      # 公告/动态抓取
│   └── crawlCma.js          # CMA 能力项目抓取（JSON 接口）
├── views/                   # EJS 模板
│   └── partials/            # header / footer
└── public/css/style.css     # 样式
```

## 数据模型

- **standards**：标准（编号、名称、英文名、状态、价格、简介、替代/采标、中标/ICS、发布部门、日期、单位、起草人、出版社等）
- **announcements**：公告（标题、来源、发布时间、正文、分类、附件标准清单 JSON）
- **news**：动态（标题、来源、发布时间、正文、分类）
- **domains**：领域分类（CMA 三级树：一级领域 → 子领域 → 细类）
- **capability_items**：能力项目（领域、标准(方法)名称、标准编号、备注）
- **users**：用户（用户名、密码哈希、邮箱）

## 说明

- 抓取时务必控制频率。
- 公告详情中的「涉及标准清单」已作为 JSON 存入公告记录，如需将清单中的标准也写入 `standards` 表，可扩展 `crawler/crawlContent.js`。
- **能力项目库**数据来自 [cma.caqit.org.cn](https://cma.caqit.org.cn)（检验检测机构资质认定能力项目库管理平台），通过其 JSON 接口（`/cma-admin/system/domain/list`、`/cma-admin/system/standardData/list`）抓取，按「领域」三级分类组织。
