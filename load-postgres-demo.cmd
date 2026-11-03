@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
where docker >nul 2>&1
if errorlevel 1 (
  echo Install Docker and start Govern with PG_ENABLED=1 before loading sample data.
  exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running. Start Docker and Govern before loading sample data.
  exit /b 1
)
rem Use only the running container's configured database. Identifiers are checked
rem before unquoted expansion, avoiding nested Windows command-line quoting.
docker compose --profile postgres exec -T postgres sh -c "set -eu; case $POSTGRES_DB in ''|*[!a-zA-Z0-9_]*) echo 'Invalid PostgreSQL database name.' >&2; exit 1;; esac; case $POSTGRES_USER in ''|*[!a-zA-Z0-9_]*) echo 'Invalid PostgreSQL bootstrap user.' >&2; exit 1;; esac; exec psql -X --username=$POSTGRES_USER --dbname=$POSTGRES_DB --set ON_ERROR_STOP=1" < "docker\postgres\demo.sql"
set "GOVERN_LOAD_RESULT=%ERRORLEVEL%"
if not "%GOVERN_LOAD_RESULT%"=="0" (
  echo Sample data could not be loaded. Start Govern with PG_ENABLED=1 and inspect the error above.
  exit /b %GOVERN_LOAD_RESULT%
)
echo Sample data is ready. Refresh Govern and choose the public PostgreSQL schema.
exit /b 0
