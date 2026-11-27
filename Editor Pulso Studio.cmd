@echo off
REM Pulso Studio: tu PC edita los videos que subas en la web (con ventana, para ver lo que hace).
REM Normalmente no hace falta: con «Activar arranque automatico» ya funciona siempre en segundo plano.
title Pulso Studio - editor
cd /d "%~dp0"
:inicio
node --no-warnings=ExperimentalWarning server\worker.js
if %errorlevel%==3 (
  echo.
  echo El editor ya esta funcionando en segundo plano: no hace falta esta ventana.
  echo Lo que hace queda en data\editor.log
  timeout /t 8
  exit /b 0
)
echo.
echo El editor se ha parado. Vuelve a arrancar en 10 segundos (cierra esta ventana para pararlo del todo).
timeout /t 10 /nobreak >nul
goto inicio
