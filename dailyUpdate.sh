#!/bin/bash
# 工标网 - 每日增量更新（Linux cron 调用）
# 自动切到脚本所在目录，再跑增量爬虫
cd "$(dirname "$0")"
node crawler/crawlIncremental.js >> autoUpdate.log 2>&1
