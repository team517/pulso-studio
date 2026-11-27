# Pulso Studio: el editor de tu PC siempre encendido.
# Crea la tarea de Windows «Pulso Studio editor», que arranca el editor SIN ventana:
#   · al entrar en Windows,
#   · y cada 5 minutos comprueba que sigue abierto (si alguien lo cerró, lo vuelve a abrir; si ya está, no hace nada).
# Si el editor falla, se reinicia solo a los 10 segundos (editor-segundo-plano.cmd). Registro en data\editor.log.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $dir 'editor-oculto.vbs'
$user = "$env:USERDOMAIN\$env:USERNAME"
$name = 'Pulso Studio editor'

$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument "`"$vbs`"" -WorkingDirectory $dir
$alEntrar = New-ScheduledTaskTrigger -AtLogOn -User $user
$cada5min = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -Priority 4
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $name -Action $action -Trigger $alEntrar, $cada5min -Settings $settings -Principal $principal `
  -Description 'Mantiene abierto el editor de Pulso Studio (tu PC edita los vídeos del panel). Para quitarlo: desactivar-arranque.ps1' -Force | Out-Null

# El arranque antiguo (carpeta Inicio, con ventana) ya no hace falta
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Pulso Studio editor.cmd" -ErrorAction SilentlyContinue

Start-ScheduledTask -TaskName $name
Write-Host "Listo: el editor de Pulso Studio queda siempre encendido en segundo plano (tarea de Windows «$name»)."
