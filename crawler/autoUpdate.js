'use strict';

// 每日自动增量更新：启动后立即跑一次，之后每 24 小时跑一次
// 运行：node crawler/autoUpdate.js  （保持进程运行即可）

const { crawlIncremental } = require('./crawlIncremental');

const INTERVAL = 24 * 60 * 60 * 1000; // 24 小时

function now() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

async function run() {
  const t0 = Date.now();
  console.log(`[${now()}] 开始每日增量更新…`);
  try {
    const r = await crawlIncremental();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${now()}] 完成：查询 ${r.checked} 条，新增 ${r.added} 条，耗时 ${secs}s`);
  } catch (e) {
    console.log(`[${now()}] 更新失败：${e.message}`);
  }
}

run(); // 立即跑一次
setInterval(run, INTERVAL);
console.log(`已启动自动更新，每 ${INTERVAL / 3600000} 小时执行一次（保持本进程运行即可）`);
