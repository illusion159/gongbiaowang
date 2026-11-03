@echo off
rem 工标网 每日增量更新脚本（供 Windows 任务计划程序调用）
rem 自动切到脚本所在目录，避免任务计划程序默认工作目录不对
cd /d "%~dp0"
node crawler\crawlIncremental.js >> autoUpdate.log 2>&1
