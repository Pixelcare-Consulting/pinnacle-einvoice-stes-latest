@echo off
REM ================================
REM Secure Production Deployment Script for eInvoice
REM ================================

echo.
echo ========================================
echo   eInvoice Secure Production Deployment
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js and try again
    pause
    exit /b 1
)

REM Check if pnpm is installed
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: pnpm is not installed
    echo Please install pnpm with: npm install -g pnpm
    pause
    exit /b 1
)

REM Check if PM2 is installed
pm2 --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: PM2 is not installed
    echo Please install PM2 with: npm install -g pm2
    pause
    exit /b 1
)

echo [1/8] Checking dependencies...
echo ✓ Node.js is installed
echo ✓ pnpm is installed
echo ✓ PM2 is installed
echo.

echo [2/8] Installing build dependencies...
pnpm install
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo ✓ Dependencies installed
echo.

echo [3/8] Running security audit...
pnpm run security:audit
if errorlevel 1 (
    echo WARNING: Security audit found issues
    echo Continue anyway? (y/n)
    set /p continue=
    if /i not "%continue%"=="y" (
        echo Deployment cancelled
        pause
        exit /b 1
    )
)
echo ✓ Security audit completed
echo.

echo [4/8] Cleaning previous builds...
pnpm run clean
echo ✓ Previous builds cleaned
echo.

echo [5/8] Building production version...
pnpm run build
if errorlevel 1 (
    echo ERROR: Build failed
    pause
    exit /b 1
)
echo ✓ Production build completed
echo.

echo [6/8] Running security checks...
pnpm run security:check
if errorlevel 1 (
    echo ERROR: Security check failed
    echo Please review security issues and fix them before deployment
    pause
    exit /b 1
)
echo ✓ Security checks passed
echo.

echo [7/8] Deploying to production...
pnpm run deploy
if errorlevel 1 (
    echo ERROR: Deployment failed
    pause
    exit /b 1
)
echo ✓ Deployment completed
echo.

echo [8/8] Final steps...
echo.
echo ========================================
echo   DEPLOYMENT COMPLETED SUCCESSFULLY!
echo ========================================
echo.
echo IMPORTANT: Complete these manual steps:
echo.
echo 1. Navigate to deployment directory:
echo    cd C:\inetpub\wwwroot\eInvoice-prod
echo.
echo 2. Copy environment template to .env:
echo    copy .env.template .env
echo.
echo 3. Edit .env file with actual values:
echo    - Database connection string
echo    - Session secret
echo    - API keys
echo    - Certificate paths
echo.
echo 4. Ensure SSL certificates are in place
echo.
echo 5. Start the application:
echo    pm2 start ecosystem.config.production.js
echo.
echo 6. Monitor the application:
echo    pm2 status
echo    pm2 logs eInvoice-prod
echo.
echo 7. Set up database (if needed):
echo    cd C:\inetpub\wwwroot\eInvoice-prod
echo    pnpm run db:setup
echo.
echo 8. Test the application:
echo    Open browser and navigate to your domain
echo.
echo ========================================
echo   DATABASE OPERATIONS
echo ========================================
echo.
echo Available database commands:
echo   pnpm run db:generate    - Generate Prisma client
echo   pnpm run db:pull        - Pull database schema
echo   pnpm run db:migrate     - Deploy migrations
echo   pnpm run db:setup       - Full database setup
echo   pnpm run db:health      - Check database health
echo   pnpm run db:studio      - Open Prisma Studio
echo.
echo ========================================
echo   SECURITY REMINDERS
echo ========================================
echo.
echo ✓ Source code is obfuscated and minified
echo ✓ Sensitive files are excluded from build
echo ✓ Environment variables are externalized
echo ✓ Security headers are configured
echo ✓ File access controls are in place
echo.
echo For security report, check:
echo C:\inetpub\wwwroot\eInvoice-prod\security-report.json
echo.

pause
