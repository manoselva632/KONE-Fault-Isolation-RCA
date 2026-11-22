@echo off
title KONE SentinIQ - Autonomous Fault Isolation Assistant
echo ============================================================
echo   Starting KONE SentinIQ (Autonomous Fault Isolation Engine)
echo ============================================================
echo.
echo Starting local web server on port 8080...
start "" "http://localhost:8080"
python -m http.server 8080
if %ERRORLEVEL% NEQ 0 (
    echo Python server not detected. Opening index.html directly in browser...
    start "" index.html
)
pause
