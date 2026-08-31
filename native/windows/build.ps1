param(
  [ValidateSet("x64", "arm64")]
  [string]$Architecture = "x64",
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release",
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$ScriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Resolve-Path (Join-Path $ScriptDirectory "..\..")
$Project = Join-Path $ScriptDirectory "ClawDad.Windows\ClawDad.Windows.csproj"
$RuntimeIdentifier = "win-$Architecture"
$DistRoot = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $ScriptDirectory "dist\$RuntimeIdentifier"
}
$AppDirectory = Join-Path $DistRoot "ClawDad"
$ArchivePath = Join-Path $DistRoot "ClawDad-Windows-$Architecture.zip"

$DotNet = Get-Command dotnet -ErrorAction Stop
$Node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $Node) {
  $Node = Get-Command node -ErrorAction Stop
}

Push-Location $RepositoryRoot
try {
  if (Test-Path $DistRoot) {
    Remove-Item -Recurse -Force $DistRoot
  }
  New-Item -ItemType Directory -Force -Path $AppDirectory | Out-Null

  & $DotNet.Source publish $Project `
    --configuration $Configuration `
    --runtime $RuntimeIdentifier `
    --self-contained true `
    --output $AppDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed for $RuntimeIdentifier."
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $AppDirectory "node") | Out-Null
  Copy-Item -Force $Node.Source (Join-Path $AppDirectory "node\node.exe")

  & $Node.Source `
    (Join-Path $ScriptDirectory "package-runtime.mjs") `
    (Join-Path $AppDirectory "runtime")
  if ($LASTEXITCODE -ne 0) {
    throw "The ClawDad Windows runtime bundle failed."
  }

  Copy-Item -Force (Join-Path $ScriptDirectory "install.ps1") (Join-Path $AppDirectory "install.ps1")
  Copy-Item -Force (Join-Path $ScriptDirectory "README.md") (Join-Path $AppDirectory "README-Windows.txt")

  Compress-Archive -Path (Join-Path $AppDirectory "*") -DestinationPath $ArchivePath -Force
  Write-Host "ClawDad Windows package: $ArchivePath"
} finally {
  Pop-Location
}
