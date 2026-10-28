# Fetches today's reservoir, Mahaweli tank, rainfall and river readings into the database.
# The "Yala-Maha daily data" scheduled task runs this once a day; it is safe to run by hand.
# Each run is logged to Tank-Reserviour\logs\daily-<date>.log (kept for 30 days).

$here = $PSScriptRoot
Set-Location $here
$logDir = Join-Path $here 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ('daily-{0:yyyy-MM-dd}.log' -f (Get-Date))

# Database settings from API/config.env, under every name the scripts read
Get-Content (Join-Path $here '..\API\config.env') | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2].Trim() }
}
$env:PGHOST = $env:DB_HOST = $env:APIDBHOST
$env:PGPORT = $env:DB_PORT = $env:APIDBPORT
$env:PGDATABASE = $env:DB_NAME = $env:APIDATABASE
$env:PGUSER = $env:DB_USER = $env:APIDBUSERN
$env:PGPASSWORD = $env:DB_PASSWORD = $env:APIDBPASSWORD
$env:PYTHONUTF8 = '1'

$py = (Get-Command py -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = "$env:LOCALAPPDATA\Programs\Python\Launcher\py.exe" }

$scripts = 'reservious_daily.py', 'get-mahaweli-tank-data.py', 'get-realtime-rainfall.py', 'get-realtime-river-levels.py'
foreach ($script in $scripts) {
    Add-Content -Encoding utf8 $log ("`n=== {0:HH:mm:ss} {1}" -f (Get-Date), $script)
    & $py $script *>&1 | ForEach-Object { "$_" } | Add-Content -Encoding utf8 $log
    Add-Content -Encoding utf8 $log "exit code $LASTEXITCODE"
}

Get-ChildItem $logDir -Filter 'daily-*.log' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item
