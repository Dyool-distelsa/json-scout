#Requires -Version 5.1
<#
.SYNOPSIS
    Removes JSON Scout's Windows Explorer context-menu entries from
    HKEY_CURRENT_USER.

.DESCRIPTION
    Standalone fallback for the in-app "Remove context menu" toggle.
    Safe to run even if the entries were never installed.
#>

$ErrorActionPreference = 'Stop'

$shellKeys = @(
    'Software\Classes\SystemFileAssociations\.json\shell\JSONScout',
    'Software\Classes\Directory\Background\shell\JSONScout',
    'Software\Classes\Directory\shell\JSONScout'
)

foreach ($keyPath in $shellKeys) {
    $fullPath = "Registry::HKEY_CURRENT_USER\$keyPath"
    if (Test-Path $fullPath) {
        Remove-Item -Path $fullPath -Recurse -Force
        Write-Host "Removed: HKCU\$keyPath"
    } else {
        Write-Host "Not present (skipped): HKCU\$keyPath"
    }
}

Write-Host "`nDone."
