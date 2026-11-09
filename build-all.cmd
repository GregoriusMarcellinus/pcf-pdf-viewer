@echo off
echo ========================================================
echo Building All 3 Managed Solutions (Sigma, DITPAM, Grey)...
echo ========================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-all-solutions.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Build failed with error code %ERRORLEVEL%.
) else (
    echo.
    echo [SUCCESS] All 3 solutions built and verified!
)
pause
