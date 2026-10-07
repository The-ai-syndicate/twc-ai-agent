$conns = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Write-Host "port 3001 cleared"

$log = Join-Path $PSScriptRoot 'server3001.log'
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run start > `"$log`" 2>&1" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
Start-Sleep -Seconds 6
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3001/' -UseBasicParsing -TimeoutSec 10
  Write-Host "GET / -> $($r.StatusCode)"
} catch {
  Write-Host "request failed: $($_.Exception.Message)"
}
