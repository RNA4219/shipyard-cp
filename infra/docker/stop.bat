@echo off
REM =============================================================================
REM shipyard-cp Stop Script
REM =============================================================================

echo.
echo ========================================
echo  shipyard-cp Shutdown
echo ========================================
echo.

cd /d "%~dp0..\.."

REM Stop Docker containers if running
where docker >nul 2>&1
if %errorlevel%==0 (
    echo Stopping Docker containers...
    cd infra\docker
    call docker-compose down
    cd ..\..
)

echo.
echo All services stopped.
echo ========================================
echo.

pause
