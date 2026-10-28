@echo off
setlocal
cd /d "%~dp0.."
where docker >nul 2>&1
if errorlevel 1 (
  echo Installeer en start Docker Desktop eerst.
  pause
  exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker draait nog niet. Start Docker Desktop en probeer opnieuw.
  pause
  exit /b 1
)
if not exist .env (
  powershell.exe -NoProfile -Command "$rng=[Security.Cryptography.RandomNumberGenerator]::Create(); function Password { $b=New-Object byte[] 32; $rng.GetBytes($b); return ([BitConverter]::ToString($b)).Replace('-','').ToLowerInvariant() }; $lines=@('APP_PORT=8080','DB_NAME=bestuursatlas',('DB_PASSWORD='+ (Password)),('DB_READ_PASSWORD='+ (Password)),('DB_ROOT_PASSWORD='+ (Password))); [IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'),$lines,(New-Object Text.UTF8Encoding($false))); $rng.Dispose()"
  if errorlevel 1 (
    echo De lokale instellingen konden niet worden aangemaakt.
    pause
    exit /b 1
  )
)
docker compose up -d --build --wait --wait-timeout 180
if errorlevel 1 (
  echo Docker kon Govern nog niet starten. De foutmelding staat hierboven.
  pause
  exit /b 1
)
set "GOVERN_PORT=8080"
for /f "tokens=1,* delims==" %%a in ('findstr /b "APP_PORT=" .env') do set "GOVERN_PORT=%%b"
echo.
echo Open Govern op http://localhost:%GOVERN_PORT%
echo De eerste start kan even duren terwijl Docker de onderdelen downloadt.
pause
