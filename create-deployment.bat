@echo off
setlocal enabledelayedexpansion

echo.
echo ================================================
echo   Cold Wallet Standalone Deployment Builder
echo ================================================
echo.

REM Clean and create deployment directory
if exist deployment (
    echo Cleaning old deployment...
    rmdir /s /q deployment
)
mkdir deployment
mkdir deployment\data
mkdir deployment\node_modules\sqlite3\build\Release

echo [1/3] Copying executable...
copy dist\coldwallet-win.exe deployment\ >nul
if errorlevel 1 (
    echo ERROR: Failed to copy executable. Run 'npm run build:win' first.
    exit /b 1
)

echo [2/3] Copying sqlite3 native binary...
copy node_modules\sqlite3\build\Release\node_sqlite3.node deployment\node_modules\sqlite3\build\Release\ >nul
if errorlevel 1 (
    echo ERROR: Failed to copy sqlite3 native binary
    exit /b 1
)

echo [3/3] Creating configuration file...
if exist .env (
    copy .env deployment\.env >nul
    echo    - Copied existing .env file
) else (
    copy .env.example deployment\.env >nul
    echo    - Created .env from .env.example
)

echo.
echo ================================================
echo   ✓ Deployment package created successfully!
echo ================================================
echo.
echo Location: %CD%\deployment
echo Size: ~60MB (exe) + ~400KB (native binary)
echo.
echo Contents:
echo   - coldwallet-win.exe (main application)
echo   - node_modules\sqlite3\build\Release\node_sqlite3.node
echo   - data\ (database folder)
echo   - .env (configuration)
echo.
echo To run the application:
echo   1. cd deployment
echo   2. coldwallet-win.exe
echo.
echo The deployment folder is now portable - you can:
echo   - Zip it and distribute
echo   - Copy to any Windows machine
echo   - Move it to any location
echo.

endlocal
