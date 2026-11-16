@echo off
REM Doble clic: el editor de Pulso Studio arrancara solo (minimizado) cada vez que enciendas el PC.
set "DEST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Pulso Studio editor.cmd"
(
  echo @echo off
  echo start "Pulso Studio - editor" /min "%~dp0Editor Pulso Studio.cmd"
) > "%DEST%"
echo Listo: el editor de Pulso Studio arrancara solo al encender el PC.
echo Para quitarlo, borra "Pulso Studio editor.cmd" de la carpeta de Inicio (Win+R, shell:startup).
start "Pulso Studio - editor" /min "%~dp0Editor Pulso Studio.cmd"
pause
