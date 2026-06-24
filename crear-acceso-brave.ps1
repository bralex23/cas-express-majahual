$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\CAS Express (Brave).lnk")
$Shortcut.TargetPath   = "C:\Users\BRALX\Desktop\CAS EXPRESS SISTEMA\CAS Express Brave.vbs"
$Shortcut.IconLocation = "C:\Users\BRALX\Desktop\CAS EXPRESS SISTEMA\assets\icon.ico"
$Shortcut.Description  = "CAS Express en Brave Browser"
$Shortcut.Save()
Write-Host "Acceso directo creado en el escritorio."
