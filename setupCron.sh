#!/bin/bash
# 工标网 - 一键注册每日更新 cron 任务（部署到 Linux 服务器后运行一次）
set -e

# 脚本所在目录（绝对路径）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SH_PATH="$SCRIPT_DIR/dailyUpdate.sh"

# 确保 dailyUpdate.sh 有可执行权限
chmod +x "$SH_PATH"

CRON_LINE="0 3 * * * $SH_PATH"

# 先删掉可能已存在的同名任务，避免重复
( crontab -l 2>/dev/null | grep -vF "$SH_PATH" ) | crontab -

# 追加新任务
( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab -

echo "============================================"
echo "  已注册每日更新 cron 任务："
echo "  $CRON_LINE"
echo "  每天凌晨 3:00 自动执行"
echo "============================================"
echo "  查看：crontab -l"
echo "  清除：crontab -r"
