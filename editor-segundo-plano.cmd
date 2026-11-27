@echo off
REM Pulso Studio: el editor en segundo plano (sin ventana). Lo arranca la tarea de Windows «Pulso Studio editor».
REM Si se para, vuelve a arrancar a los 10 segundos. Lo que va haciendo queda en data\editor.log.
cd /d "%~dp0"
if not exist data mkdir data
:inicio
for %%A in (data\editor.log) do if %%~zA GTR 5000000 move /y data\editor.log data\editor-anterior.log >nul
echo.>> data\editor.log
echo ==== %date% %time% arranca el editor ====>> data\editor.log
set STUDIO_NO_BROWSER=
node --no-warnings=ExperimentalWarning server\worker.js >> data\editor.log 2>&1
REM 3 = ya hay otro editor abierto en este PC: no hace falta otro
if %errorlevel%==3 exit /b 0
timeout /t 10 /nobreak >nul
goto inicio
