# Quita la tarea «Pulso Studio editor» y cierra el editor en segundo plano.
Unregister-ScheduledTask -TaskName 'Pulso Studio editor' -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe' OR Name='wscript.exe'" |
  Where-Object { $_.CommandLine -match 'editor-segundo-plano|editor-oculto|server\worker\.js' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host 'El editor ya no arranca solo.'
