<#
.SYNOPSIS
  dashboard 의 pause / resume / consent 엔드포인트를 호출하는 헬퍼.
#>

[CmdletBinding()]
param()

function Invoke-StreamApi {
  param(
    [Parameter(Mandatory=$true)][ValidateSet('consent','pause','resume')] [string]$Action,
    [Parameter(Mandatory=$true)] [string]$DashboardBase,
    [Parameter(Mandatory=$true)] [string]$StreamId,
    [Parameter(Mandatory=$true)] [string]$IngestSecret,
    [string]$AcceptedBy = $null,
    [string]$AcceptedNoticeHash = $null,
    [string]$Reason = $null,
    [string]$Hostname = $env:COMPUTERNAME,
    [string]$AgentVersion = '0.1.0'
  )

  $url = "$($DashboardBase.TrimEnd('/'))/api/streams/$StreamId/$Action"
  $body = @{ ingestSecret = $IngestSecret; hostname = $Hostname; agentVersion = $AgentVersion }
  if ($Action -eq 'consent') {
    if (-not $AcceptedBy -or -not $AcceptedNoticeHash) {
      throw "consent requires AcceptedBy and AcceptedNoticeHash"
    }
    $body.acceptedBy = $AcceptedBy
    $body.acceptedNoticeHash = $AcceptedNoticeHash
  }
  if ($Reason) { $body.reason = $Reason }

  $json = $body | ConvertTo-Json -Compress
  try {
    return Invoke-RestMethod -Method POST -Uri $url -Body $json -ContentType 'application/json' -TimeoutSec 10
  } catch {
    throw "API $Action failed: $($_.Exception.Message)"
  }
}
