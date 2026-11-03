'use strict';

// 国标原文 PDF 分页图片代理
// 原理：openstd 的 showGb 页里带每页图片的 token（bg 属性），
//       图片通过 viewGbImg?fileName=<token> 获取（需 Cache-Alive: chunked 头）。
// 这里由后端代理，把每页图片平铺展示，避免 iframe 内嵌滚动条。

const express = require('express');
const axios = require('axios');
const db = require('../db');

const router = express.Router();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TOKEN_TTL = 10 * 60 * 1000; // token 缓存 10 分钟

// hcno -> { tokens: [...], ts: number }
const tokenCache = new Map();

async function getTokens(hcno) {
  const cached = tokenCache.get(hcno);
  if (cached && Date.now() - cached.ts < TOKEN_TTL) return cached.tokens;

  const resp = await axios.get(
    `https://openstd.samr.gov.cn/bzgk/std/showGb?type=online&hcno=${hcno}&request_locale=zh`,
    {
      headers: { 'User-Agent': UA, Referer: 'https://openstd.samr.gov.cn/bzgk/gb/' },
      timeout: 25000,
      maxRedirects: 5,
      responseType: 'text',
    }
  );
  const tokens = [...resp.data.matchAll(/bg="([^"]{10,})"/g)].map((m) => m[1]);
  const uniq = [...new Set(tokens)];
  tokenCache.set(hcno, { tokens: uniq, ts: Date.now() });
  return uniq;
}

function hcnoOf(std) {
  if (!std || !std.pdf_url) return '';
  return (String(std.pdf_url).match(/hcno=([A-Z0-9]+)/i) || [])[1] || '';
}

// 返回页数
router.get('/pdf/:id', async (req, res) => {
  const std = db.getStandard(req.params.id);
  const hcno = hcnoOf(std);
  if (!hcno) return res.json({ pages: 0 });
  try {
    const tokens = await getTokens(hcno);
    res.json({ pages: tokens.length });
  } catch (e) {
    res.json({ pages: 0, error: e.message });
  }
});

// 返回某一页图片
router.get('/pdf/:id/page/:n', async (req, res) => {
  const std = db.getStandard(req.params.id);
  const hcno = hcnoOf(std);
  if (!hcno) return res.status(404).end();
  const n = parseInt(req.params.n, 10) || 1;
  try {
    const tokens = await getTokens(hcno);
    const token = tokens[n - 1];
    if (!token) return res.status(404).end();
    const img = await axios.get(
      `https://openstd.samr.gov.cn/bzgk/std/viewGbImg?fileName=${token}`,
      {
        headers: {
          'User-Agent': UA,
          Referer: 'https://openstd.samr.gov.cn/bzgk/std/showGb',
          'Cache-Alive': 'chunked',
        },
        timeout: 30000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
      }
    );
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(img.data));
  } catch (e) {
    res.status(500).end();
  }
});

module.exports = router;
module.exports.getTokens = getTokens;
module.exports.hcnoOf = hcnoOf;
