@echo off
rem ============================================
rem  GongBiao - one-click register daily update task
rem  Run this ONCE after deploying to the server
rem ============================================
cd /d "%~dp0"

set "TASK_NAME=GongBiaoDailyUpdate"
set "BAT_PATH=%~dp0dailyUpdate.bat"

echo ============================================
echo   GongBiao - Register Daily Update Task
echo ============================================
echo.
echo   Task name : %TASK_NAME%
echo   Script    : %BAT_PATH%
echo   Schedule  : Daily 03:00
echo.

schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
schtasks /Create /TN "%TASK_NAME%" /TR "\"%BAT_PATH%\"" /SC DAILY /ST 03:00 /F

echo.
echo   Done! Open Task Scheduler (taskschd.msc) to verify.
echo   Tip: set task to "Run whether user is logged on or not"
echo        for unattended server operation.
echo.
pause
