@echo off
echo Starting Python Claude Agent SDK Server...
echo.

REM 检查是否在虚拟环境中
if not defined VIRTUAL_ENV (
    echo Warning: No virtual environment detected.
    echo It is recommended to use a virtual environment.
    echo.
)

REM 启动服务器
python server.py

pause

