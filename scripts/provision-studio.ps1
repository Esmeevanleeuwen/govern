$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

# Read explicit non-secret settings as text; .env is never executed.
function Read-StudioSetting([string] $Name, [string] $Fallback) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
    if (Test-Path -LiteralPath '.env') {
        foreach ($line in Get-Content -LiteralPath '.env' -Encoding UTF8) {
            if ($line.StartsWith($Name + '=')) { $value = $line.Substring($Name.Length + 1).Trim() }
        }
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }
    return $Fallback
}

if ((Read-StudioSetting 'PG_ENABLED' '0') -cne '1' -or (Read-StudioSetting 'STUDIO_ENABLED' '0') -cne '1') {
    throw 'Set PG_ENABLED=1 and STUDIO_ENABLED=1 explicitly before provisioning Studio.'
}
$studioSchema = Read-StudioSetting 'STUDIO_SCHEMA' 'brainstorm'
$databaseName = Read-StudioSetting 'PG_DATABASE' 'govern_pg'
$schemas = (Read-StudioSetting 'PG_SCHEMAS' 'public').Split(',') | ForEach-Object { $_.Trim() }
if ($studioSchema -cnotmatch '^[A-Za-z_][A-Za-z0-9_]{0,62}$' -or $studioSchema -cin @('public','information_schema') -or $studioSchema.StartsWith('pg_')) {
    throw 'Choose a separate non-system STUDIO_SCHEMA using letters, digits and underscores.'
}
if ($databaseName -cnotmatch '^[A-Za-z0-9_]{1,63}$' -or $schemas -cnotcontains $studioSchema) {
    throw 'Check PG_DATABASE, include STUDIO_SCHEMA in PG_SCHEMAS, and restart Govern first.'
}
$migration = Get-Content -Raw -LiteralPath 'docker/postgres/studio/001-foundation.sql' -Encoding UTF8
$migration | & docker compose --profile postgres exec -T -e "STUDIO_SCHEMA=$studioSchema" postgres psql -X --username postgres "--dbname=$databaseName" --set ON_ERROR_STOP=1 "--set=studio_schema=$studioSchema"
if ($LASTEXITCODE -ne 0) { throw 'Studio provisioning failed. Review the error; existing data is not replaced.' }
$migration = Get-Content -Raw -LiteralPath 'docker/postgres/studio/002-dictation.sql' -Encoding UTF8
$migration | & docker compose --profile postgres exec -T -e "STUDIO_SCHEMA=$studioSchema" postgres psql -X --username postgres "--dbname=$databaseName" --set ON_ERROR_STOP=1 "--set=studio_schema=$studioSchema"
if ($LASTEXITCODE -ne 0) { throw 'Studio provisioning failed. Review the error; existing data is not replaced.' }
$migration = Get-Content -Raw -LiteralPath 'docker/postgres/studio/003-ghostsketch-storage.sql' -Encoding UTF8
$migration | & docker compose --profile postgres exec -T -e "STUDIO_SCHEMA=$studioSchema" postgres psql -X --username postgres "--dbname=$databaseName" --set ON_ERROR_STOP=1 "--set=studio_schema=$studioSchema"
if ($LASTEXITCODE -ne 0) { throw 'Studio provisioning failed. Review the error; existing data is not replaced.' }
Write-Output 'Studio schema version 1 is ready. Existing data and account passwords were preserved.'
