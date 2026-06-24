$carpeta    = "C:\Users\BRALX\Desktop\CAS EXPRESS SISTEMA"
$WshShell   = New-Object -ComObject WScript.Shell
$Shortcut   = $WshShell.CreateShortcut("C:\Users\BRALX\Desktop\CAS Express.lnk")
$Shortcut.TargetPath       = "$carpeta\INICIAR CAS EXPRESS.bat"
$Shortcut.WorkingDirectory = $carpeta
$Shortcut.IconLocation     = "$carpeta\assets\icon.ico"
$Shortcut.WindowStyle      = 7
$Shortcut.Description      = "CAS Express — Soluciones Financieras"
$Shortcut.Save()
Write-Host "Listo! Acceso directo creado en el escritorio."
pause
