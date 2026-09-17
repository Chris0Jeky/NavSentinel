[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $NodeArguments = @()
)

Set-StrictMode -Version Latest

$sensitiveExactKeys = @(
  "NODE_OPTIONS",
  "NODE_PATH",
  "EXTENSION_PATH"
)
$sensitivePrefixes = @(
  "GIT_",
  "NAVSENTINEL_STATE_AUTHORITY_"
)

function Test-SensitiveEnvironmentKey {
  param(
    [Parameter(Mandatory)]
    [string] $Key
  )

  $normalized = $Key.ToUpperInvariant()
  if ($sensitiveExactKeys -contains $normalized) {
    return $true
  }
  foreach ($prefix in $sensitivePrefixes) {
    if ($normalized.StartsWith($prefix, [StringComparison]::Ordinal)) {
      return $true
    }
  }
  return $false
}

# PowerShell is the first process in the Windows path. Remove every spelling
# before Node starts, because NODE_OPTIONS is interpreted during Node startup,
# before launch-state-authority-campaign.mjs can sanitize its own environment.
foreach ($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()) {
  $key = [string] $entry.Key
  if (Test-SensitiveEnvironmentKey -Key $key) {
    Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
  }
}

$env:GIT_NO_REPLACE_OBJECTS = "1"
$env:GIT_NO_LAZY_FETCH = "1"
$env:GIT_OPTIONAL_LOCKS = "0"

$nodeCommand = Get-Command -Name "node" -CommandType Application -ErrorAction Stop
$bootstrapPath = Join-Path $PSScriptRoot "launch-state-authority-campaign.mjs"
if (-not (Test-Path -LiteralPath $bootstrapPath -PathType Leaf)) {
  throw "Committed state-authority bootstrap is missing: $bootstrapPath"
}

& $nodeCommand.Source $bootstrapPath @NodeArguments
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) {
  $exitCode = 0
}
exit $exitCode
