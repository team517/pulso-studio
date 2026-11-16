@echo off
REM Pulso Studio: tu PC edita los videos que subas en la web.
REM Dejalo abierto (puede estar minimizado). Si se cierra por un fallo, vuelve a arrancar solo.
title Pulso Studio - editor
cd /d "%~dp0"
:inicio
node --no-warnings=ExperimentalWarning server\worker.js
echo.
echo El editor se ha parado. Vuelve a arrancar en 10 segundos (cierra esta ventana para pararlo del todo).
timeout /t 10 /nobreak >nul
goto inicio
