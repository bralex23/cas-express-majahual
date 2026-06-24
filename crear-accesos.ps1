# $PSScriptRoot = carpeta donde está este .ps1 (no depende de parámetros externos)
$dir     = $PSScriptRoot + '\'
$ws      = New-Object -ComObject WScript.Shell
$ico     = $dir + 'assets\icon.ico,0'
$desktop = [Environment]::GetFolderPath('Desktop')
$wscript = "$env:SystemRoot\System32\wscript.exe"

# ── Crear archivos VBS lanzadores ────────────────────────────────────────────
# VBScript llama al .bat con comillas propias → resuelve el problema de espacios
$vbs1 = $dir + 'launch-brave.vbs'
$vbs2 = $dir + 'launch-electron.vbs'
$bat1 = $dir + 'INICIAR EN BRAVE.bat'
$bat2 = $dir + 'Iniciar CAS Express.bat'

# Verificar que los .bat existen
if (-not (Test-Path $bat1)) { Write-Error "No encontrado: $bat1"; exit 1 }
if (-not (Test-Path $bat2)) { Write-Error "No encontrado: $bat2"; exit 1 }

# Escribir VBS usando single-quoted here-string para evitar escaping de PowerShell
$content1 = 'CreateObject("WScript.Shell").Run Chr(34) & "' + $bat1 + '" & Chr(34), 1, False'
$content2 = 'CreateObject("WScript.Shell").Run Chr(34) & "' + $bat2 + '" & Chr(34), 1, False'

[System.IO.File]::WriteAllText($vbs1, $content1, [System.Text.Encoding]::ASCII)
[System.IO.File]::WriteAllText($vbs2, $content2, [System.Text.Encoding]::ASCII)

Write-Host "VBS 1: $vbs1"
Write-Host "VBS 2: $vbs2"
Write-Host "Contenido VBS1: $content1"

# ── Crear accesos directos ────────────────────────────────────────────────────
$s1 = $ws.CreateShortcut($desktop + '\CAS Majahual (Brave).lnk')
$s1.TargetPath       = $wscript
$s1.Arguments        = '"' + $vbs1 + '"'
$s1.WorkingDirectory = $dir
$s1.IconLocation     = $ico
$s1.WindowStyle      = 1
$s1.Save()

$s2 = $ws.CreateShortcut($desktop + '\CAS Majahual.lnk')
$s2.TargetPath       = $wscript
$s2.Arguments        = '"' + $vbs2 + '"'
$s2.WorkingDirectory = $dir
$s2.IconLocation     = $ico
$s2.WindowStyle      = 1
$s2.Save()

Write-Host "OK - Accesos directos creados en: $desktop"
Write-Host "Shortcut 1 target: $wscript"
Write-Host "Shortcut 1 args: $($s1.Arguments)"
