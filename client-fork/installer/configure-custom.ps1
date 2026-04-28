param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$RendezvousServer,
  [Parameter(Mandatory = $true)][string]$RelayServer,
  [Parameter(Mandatory = $true)][string]$PublicKey
)

$customPath = Join-Path $InstallDir "custom.txt"
$content = @(
  "rendezvous-server=$RendezvousServer"
  "relay-server=$RelayServer"
  "key=$PublicKey"
) -join "`r`n"

Set-Content -Path $customPath -Value $content -Encoding ASCII
Write-Host "custom.txt written to $customPath"
