@echo off
REM Pulso Studio: tu PC edita los videos que subas en el panel de ChipsFinder.
REM Dejalo abierto mientras quieras que se editen (puedes minimizarlo).
title Pulso Studio - editor
cd /d "%~dp0"
node --no-warnings=ExperimentalWarning server\worker.js
pause
