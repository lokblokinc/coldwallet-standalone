@echo off
REM Update coldwallet plugin from source portal

set SOURCE=..\toughlok-portal\views\plug-ins\coldwallet
set TARGET=.\views\plug-ins\coldwallet
set TIMESTAMP=%DATE:~-4%%DATE:~4,2%%DATE:~7,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%

if not exist "%SOURCE%" (
    echo Error: Source plugin not found at %SOURCE%
    exit /b 1
)

if not exist "%TARGET%" (
    echo Error: Target plugin not found at %TARGET%
    exit /b 1
)

echo Backing up current plugin...
if exist "%TARGET%.backup.%TIMESTAMP%" (
    rmdir /S /Q "%TARGET%.backup.%TIMESTAMP%"
)
xcopy /E /I /Y "%TARGET%" "%TARGET%.backup.%TIMESTAMP%"
echo Backup saved to %TARGET%.backup.%TIMESTAMP%

echo.
echo Copying plugin from source...
xcopy /E /I /Y "%SOURCE%\*" "%TARGET%"

echo.
echo Modifying layout reference in coldwallet.ejs...
powershell -Command "(Get-Content '%TARGET%\coldwallet.ejs') -replace '^<%%- layout\(''layout''\) %%>$', '<%%- layout(''layout-minimal'') %%>' | Set-Content '%TARGET%\coldwallet.ejs'"

echo.
echo Cleaning up Zone.Identifier files...
powershell -Command "Get-ChildItem -Path '%TARGET%' -Recurse -Filter '*:Zone.Identifier' | Remove-Item -Force"

echo.
echo Plugin updated successfully!
echo To restore from backup: xcopy /E /I /Y "%TARGET%.backup.%TIMESTAMP%\*" "%TARGET%"
