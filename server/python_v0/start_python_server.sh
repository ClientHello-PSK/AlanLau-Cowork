#!/bin/bash

echo "Starting Python Claude Agent SDK Server..."
echo ""

# 检查虚拟环境
if [ -z "$VIRTUAL_ENV" ]; then
    echo "Warning: No virtual environment detected."
    echo "It is recommended to use a virtual environment."
    echo ""
fi

# 启动服务器
python server.py

