param(
  [Parameter(Mandatory = $true)][string]$AppPath
)

if (-not (Test-Path $AppPath)) {
  Write-Error "RustDesk executable not found: $AppPath"
  exit 1
}

$ruleName = "RustDesk Managed Client"

$existing = Get-NetFirewallApplicationFilter -PolicyStore ActiveStore -ErrorAction SilentlyContinue |
  Where-Object { $_.Program -eq $AppPath }

if ($existing) {
  Write-Host "Firewall rule already exists for $AppPath"
  exit 0
}

New-NetFirewallRule `
  -DisplayName "$ruleName (Inbound TCP)" `
  -Direction Inbound `
  -Program $AppPath `
  -Action Allow `
  -Protocol TCP `
  -Profile Domain,Private `
  -Enabled True | Out-Null

New-NetFirewallRule `
  -DisplayName "$ruleName (Inbound UDP)" `
  -Direction Inbound `
  -Program $AppPath `
  -Action Allow `
  -Protocol UDP `
  -Profile Domain,Private `
  -Enabled True | Out-Null

Write-Host "Firewall rules added for $AppPath"
