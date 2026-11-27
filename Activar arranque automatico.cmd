@echo off
REM Doble clic: el editor de Pulso Studio queda SIEMPRE encendido en segundo plano (sin ventana):
REM arranca al entrar en Windows, se reinicia solo si falla y se vuelve a abrir si se cierra.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0activar-arranque.ps1"
pause
