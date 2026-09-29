#Requires -Version 5.1
<#
.SYNOPSIS
    Installs JSON Scout's Windows Explorer context-menu entries under
    HKEY_CURRENT_USER (no administrator rights required).

.DESCRIPTION
    This is a standalone fallback for the in-app "Install context menu"
    toggle (Settings panel), useful for scripted installs or when the
    app itself cannot be launched yet. It adds three entries:

      1. Right-click a .json file       -> "Open in JSON Scout"
      2. Right-click a folder background -> "JSON Scout here"
      3. Right-click a folder            -> "JSON Scout here"

.PARAMETER ExePath
    Path to the JSON Scout executable. Defaults to json-scout.exe next
    to this script's repository build output, or can be passed
    explicitly, e.g. after installing to Program Files.

.EXAMPLE
    ./install-context-menu.ps1 -ExePath "C:\Program Files\JSON Scout\json-scout.exe"
#>
param(
    [string]$ExePath = (Join-Path $PSScriptRoot "..\src-tauri\target\release\json-scout.exe")
)

$ErrorActionPreference = 'Stop'

$resolved = Resolve-Path -Path $ExePath -ErrorAction SilentlyContinue
if (-not $resolved) {
    Write-Error "Could not resolve the JSON Scout executable path. Pass -ExePath explicitly."
    exit 1
}
$ExePath = $resolved.Path

function Install-ShellEntry {
    param(
        [string]$ShellKeyPath,
        [string]$Label,
        [string]$ArgPlaceholder
    )

    $shellKey = "Registry::HKEY_CURRENT_USER\$ShellKeyPath"
    $commandKey = "$shellKey\command"

    New-Item -Path $shellKey -Force | Out-Null
    Set-ItemProperty -Path $shellKey -Name '(default)' -Value $Label
    Set-ItemProperty -Path $shellKey -Name 'MUIVerb' -Value $Label
    Set-ItemProperty -Path $shellKey -Name 'Icon' -Value $ExePath

    New-Item -Path $commandKey -Force | Out-Null
    $commandValue = "`"$ExePath`" `"$ArgPlaceholder`""
    Set-ItemProperty -Path $commandKey -Name '(default)' -Value $commandValue

    Write-Host "Installed: HKCU\$ShellKeyPath"
}

Install-ShellEntry -ShellKeyPath 'Software\Classes\SystemFileAssociations\.json\shell\JSONScout' `
    -Label 'Open in JSON Scout' -ArgPlaceholder '%1'

Install-ShellEntry -ShellKeyPath 'Software\Classes\Directory\Background\shell\JSONScout' `
    -Label 'JSON Scout here' -ArgPlaceholder '%V'

Install-ShellEntry -ShellKeyPath 'Software\Classes\Directory\shell\JSONScout' `
    -Label 'JSON Scout here' -ArgPlaceholder '%1'

Write-Host "`nDone. All entries were written under HKCU only; no admin rights were required."
