'use strict';

// 进程内缓存（同步版，配合同步 better-sqlite3）
//
// 三个防护：
// 1. 防雪崩 —— 每个 key 的 TTL 都加 ±15% 随机抖动，避免大量 key 在同一时刻
//              集中过期、对数据库造成突发洪峰。
// 2. 防击穿 —— 由「同步 + 单线程」天然保证：一个 key 过期时，先到的请求同步
//              完成重建并回填，后续请求拿到的已是新值，不存在并发重复重建。
//              （若将来改成异步 DB，再在这里加 single-flight 互斥即可。）
// 3. 防穿透 —— getAllowEmpty 把空结果（null / 空数组）也缓存起来（用更短 TTL），
//              避免反复查询不存在的数据每次都打到数据库。

const store = new Map(); // key -> { value, expireAt }

function jitter(ttlMs) {
  const ratio = 0.85 + Math.random() * 0.3; // 0.85 ~ 1.15
  return Math.round(ttlMs * ratio);
}

// 读取：命中且未过期直接返回；否则用 loader 重建并缓存（带抖动 TTL）
function get(key, ttlMs, loader) {
  const hit = store.get(key);
  if (hit && hit.expireAt > Date.now()) return hit.value;
  const value = loader();
  store.set(key, { value, expireAt: Date.now() + jitter(ttlMs) });
  return value;
}

// 读取（允许空结果）：loader 返回 null/空数组时，用更短 TTL 缓存，防穿透
function getAllowEmpty(key, ttlMs, emptyTtlMs, loader) {
  const hit = store.get(key);
  if (hit && hit.expireAt > Date.now()) return hit.value;
  const value = loader();
  const empty = value == null || (Array.isArray(value) && value.length === 0);
  const ttl = empty ? (emptyTtlMs || ttlMs) : ttlMs;
  store.set(key, { value, expireAt: Date.now() + jitter(ttl) });
  return value;
}

function clear() { store.clear(); }

module.exports = { get, getAllowEmpty, clear };
