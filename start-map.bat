@echo off
REM gpx.studio local launcher - serves the prebuilt static site on port 4173
cd /d D:\claudeD\gpx-studio\website

if not exist build\app.html (
    echo [gpx.studio] build not found, building first...
    call npm run build || exit /b 1
)

start "" firefox http://localhost:4173/app
npm run preview -- --port 4173
