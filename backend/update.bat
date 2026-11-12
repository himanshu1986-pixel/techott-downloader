@echo off
REM ============================================================
REM Tech OTT Downloader — update script (Windows)
REM Pulls the latest code from GitHub and installs dependencies.
REM It does NOT restart the server — restart it yourself after.
REM Run this from the backend folder of your git clone, e.g.
REM   C:\techott-downloader\backend\update.bat
REM (If you copied the files by hand instead of cloning, use the
REM manual update path in README.md instead.)
REM ============================================================
cd /d %~dp0
echo.
echo Pulling latest code from GitHub...
git pull
if errorlevel 1 (
  echo.
  echo git pull FAILED. Make sure this folder is inside a git
  echo clone of the repo and that you have internet.
  pause
  exit /b 1
)
echo.
echo Installing dependencies (in case they changed)...
call npm install
echo.
echo ===============================================================
echo Update done. Now restart the server:
echo   1. Press Ctrl+C in the backend window (where npm start runs)
echo   2. Run: npm start
echo.
echo Then check the version took effect:
echo   - Footer of the site must show the new Backend vX.Y.Z
echo   - https://dl.techott.store/api/health must show the new version
echo ===============================================================
pause
