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
rem PostgreSQL remains opt-in; never execute the contents of .env.
set "GOVERN_PG_ENABLED=%PG_ENABLED%"
if not defined GOVERN_PG_ENABLED for /f "tokens=1,* delims==" %%a in ('findstr /b "PG_ENABLED=" .env') do set "GOVERN_PG_ENABLED=%%~b"
set "GOVERN_PROFILE="
if "%GOVERN_PG_ENABLED%"=="1" (
  powershell.exe -NoProfile -Command "$path=Join-Path (Get-Location) '.env'; $lines=[IO.File]::ReadAllLines($path); $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); foreach($key in @('PG_READ_PASSWORD','PG_PASSWORD','PG_ADMIN_PASSWORD')) { if([Environment]::GetEnvironmentVariable($key)) { continue }; $matches=@($lines | Where-Object { $_.StartsWith($key+'=') }); if($matches.Count -and $matches[-1].Substring($key.Length+1).Trim().Trim([char[]]@(34,39))) { continue }; $b=New-Object byte[] 32; $rng.GetBytes($b); $password=([BitConverter]::ToString($b)).Replace('-','').ToLowerInvariant(); $lines=@($lines | Where-Object { -not $_.StartsWith($key+'=') }) + ($key+'='+$password) }; [IO.File]::WriteAllLines($path,$lines,(New-Object Text.UTF8Encoding($false))); $rng.Dispose()"
  if errorlevel 1 (
    echo De PostgreSQL-instellingen konden niet worden aangemaakt.
    pause
    exit /b 1
  )
  set "GOVERN_PROFILE=--profile postgres"
)

docker compose %GOVERN_PROFILE% up -d --build --wait --wait-timeout 180
if errorlevel 1 (
  echo Docker kon Govern nog niet starten. De foutmelding staat hierboven.
  goto gateway_failed
)
rem Reload an existing gateway after testing the bind-mounted access rules.
docker compose %GOVERN_PROFILE% exec -T gateway nginx -t
if errorlevel 1 goto gateway_failed
docker compose %GOVERN_PROFILE% exec -T gateway nginx -s reload
if errorlevel 1 goto gateway_failed
set "GOVERN_PORT=8080"
for /f "tokens=1,* delims==" %%a in ('findstr /b "APP_PORT=" .env') do set "GOVERN_PORT=%%b"
echo.
echo Open Govern op http://localhost:%GOVERN_PORT%
echo De eerste start kan even duren terwijl Docker de onderdelen downloadt.
pause
exit /b 0

:gateway_failed
echo De nieuwe toegangsregels konden niet worden geladen. De ingang wordt gestopt.
echo Je databases en accountgegevens blijven behouden. Los de fout op en start opnieuw.
docker compose %GOVERN_PROFILE% stop gateway
pause
exit /b 1
