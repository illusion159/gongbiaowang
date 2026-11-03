'use strict';

const axios = require('axios');
const iconv = require('iconv-lite');

const BASE = 'http://www.csres.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// 爬取间隔（毫秒），礼貌抓取，可配置
const DELAY = 800;

let lastRequest = 0;
let requestCount = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 将字符串按 GBK 编码并 percent-encode（csres 搜索用 GBK）
function encodeGBK(str) {
  const buf = iconv.encode(String(str), 'gbk');
  let out = '';
  for (const b of buf) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  return out;
}

// 抓取并解码 GBK 页面，返回 UTF-8 字符串
async function fetchGBK(url, retries = 3) {
  // 限速
  const now = Date.now();
  const wait = Math.max(0, lastRequest + DELAY - now);
  if (wait) await sleep(wait);

  for (let i = 0; i < retries; i++) {
    try {
      lastRequest = Date.now();
      const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': UA, Referer: BASE + '/' },
        timeout: 25000,
        maxRedirects: 5,
      });
      requestCount++;
      const buf = Buffer.from(resp.data);
      // 优先按 GBK 解码（站点 meta 声明 gbk）
      let html = iconv.decode(buf, 'gbk');
      // 简单校验：若出现大量替换符则回退 utf-8
      if ((html.match(/�/g) || []).length > 5) {
        html = buf.toString('utf-8');
      }
      return html;
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

// 拼接绝对地址
function absUrl(pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return BASE + (pathOrUrl.startsWith('/') ? pathOrUrl : '/' + pathOrUrl);
}

module.exports = { BASE, DELAY, encodeGBK, fetchGBK, absUrl, sleep, getRequestCount: () => requestCount };
