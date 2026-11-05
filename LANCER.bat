
@echo off
title Mon Application P2P

cd /d "%~dp0"

echo ================================
echo       APPLICATION P2P
echo ================================
echo.

if not exist "node_modules" (
    echo Installation des dependances...
    call npm install
)

echo Lancement de Electron...
call npm start

pause
