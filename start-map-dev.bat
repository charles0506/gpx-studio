@echo off
REM gpx.studio dev server - hot reload, use this when editing source
cd /d D:\claudeD\gpx-studio\website
start "" firefox http://localhost:5173/app
npm run dev -- --port 5173
