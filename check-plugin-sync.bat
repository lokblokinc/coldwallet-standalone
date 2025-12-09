@echo off
REM Check if coldwallet plugin differs from source

set SOURCE=..\toughlok-portal\views\plug-ins\coldwallet
set TARGET=.\views\plug-ins\coldwallet

if not exist "%SOURCE%" (
    echo Warning: Source plugin not found at %SOURCE%
    exit /b 1
)

if not exist "%TARGET%" (
    echo Warning: Target plugin not found at %TARGET%
    exit /b 1
)

echo Checking for plugin differences...

REM Compare key files
set CHANGED=0

REM Check coldwallet.ejs (skip first line which has layout reference)
fc /L /N /LB2 "%SOURCE%\coldwallet.ejs" "%TARGET%\coldwallet.ejs" >nul 2>&1
if errorlevel 1 (
    echo - coldwallet.ejs differs
    set CHANGED=1
)

REM Check coldwallet.js
fc /B "%SOURCE%\coldwallet.js" "%TARGET%\coldwallet.js" >nul 2>&1
if errorlevel 1 (
    echo - coldwallet.js differs
    set CHANGED=1
)

REM Check plugin.json
fc /B "%SOURCE%\plugin.json" "%TARGET%\plugin.json" >nul 2>&1
if errorlevel 1 (
    echo - plugin.json differs
    set CHANGED=1
)

REM Check assets directory
if exist "%SOURCE%\assets" (
    xcopy /L /E /Y "%SOURCE%\assets" "%TARGET%\assets" | find /C "File(s)" >nul
    if errorlevel 1 (
        echo - assets/ directory differs
        set CHANGED=1
    )
)

if %CHANGED%==1 (
    echo.
    echo Plugin is out of sync with source!
    echo Run 'npm run update-plugin' to sync from source
    exit /b 1
) else (
    echo Plugin is in sync with source
    exit /b 0
)
