@echo off
REM Cambiar la contrasena de Pulso Studio desde este PC (si la olvidas o no te deja entrar).
cd /d "%~dp0"
node --no-warnings=ExperimentalWarning server\cambiar-contrasena.js
echo.
pause
