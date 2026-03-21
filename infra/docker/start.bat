@echo off
REM =============================================================================
REM shipyard-cp Start Script
REM =============================================================================

setlocal enabledelayedexpansion

echo.
echo ========================================
echo  shipyard-cp Startup
echo ========================================
echo.

cd /d "%~dp0.."

REM Check if .env exists
if not exist .env (
    echo WARNING: .env file not found. Using defaults.
    echo Run install.bat to create configuration.
)

REM Check if dist exists
if not exist dist (
    echo Building TypeScript...
    call npm run build
    if %errorlevel% neq 0 (
        echo ERROR: Build failed.
        exit /b 1
    )
)

REM Check if Docker containers are running
where docker >nul 2>&1
if %errorlevel%==0 (
    echo Checking Docker containers...
    docker ps --format "{{.Names}}" 2>nul | findstr "memx-resolver" >nul
    if %errorlevel% neq 0 (
        echo Starting Docker containers...
        cd docker
        call docker-compose up -d
        cd ..
        timeout /t 3 /nobreak >nul
    )
)

echo.
echo Starting shipyard-cp...
echo   - Control Plane: http://localhost:3000
echo   - memx-resolver: http://localhost:8080
echo   - tracker-bridge: http://localhost:8081
echo.
echo Press Ctrl+C to stop
echo ========================================
echo.

REM Start the server
call npm run dev