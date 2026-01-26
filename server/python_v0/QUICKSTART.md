# Python 版本快速开始指南

## 文件结构

```
server/
├── server.py              # 主服务器（FastAPI）
├── skill_loader.py        # 技能加载模块
├── skills_api.py          # Skills API 路由
├── requirements.txt       # Python 依赖
├── run_python_server.bat  # Windows 启动脚本
├── start_python_server.sh # Linux/Mac 启动脚本
└── README_PYTHON.md       # 详细文档
```

## 快速安装（需 Python 3.8+）

### 1. 安装 Python（如果未安装）

**Windows:**
- 下载：https://www.python.org/downloads/
- 安装时勾选 "Add Python to PATH"

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install python3 python3-pip python3-venv
```

**Mac (Homebrew):**
```bash
brew install python3
```

### 2. 创建虚拟环境

**Windows:**
```cmd
cd server
python -m venv venv
venv\Scripts\activate
```

**Linux/Mac:**
```bash
cd server
python3 -m venv venv
source venv/bin/activate
```

### 3. 安装依赖

```bash
pip install -r requirements.txt
```

## 配置

在项目根目录创建 `.env` 文件：

```env
ANTHROPIC_API_KEY=your_api_key_here
WORKSPACE_DIR=C:\your\workspace\path
SANDBOX_ENABLED=true
PORT=3001
```

## 启动服务器

### Windows
双击 `run_python_server.bat` 或运行：
```cmd
python server.py
```

### Linux/Mac
```bash
chmod +x start_python_server.sh
./start_python_server.sh
```

## 测试

```bash
# 健康检查
curl http://localhost:3001/api/health

# 查看配置
curl http://localhost:3001/api/config
```

## 功能对比

| 功能 | Node.js 版本 | Python 版本 | 状态 |
|------|--------------|-------------|------|
| SSE 流式响应 | ✅ | ✅ | 完成 |
| 文件沙箱 | ✅ | ✅ | 完成 |
| Skills 系统 | ✅ | ✅ | 完成 |
| 会话管理 | ✅ | ✅ | 完成 |
| 配置持久化 | ✅ | ✅ | 完成 |
| Claude SDK 集成 | ✅ | ⚠️ | 需要补充 |

## Claude SDK 集成说明

**官方 Python Agent SDK 已发布！**

### 安装官方 Python SDK

```bash
pip install claude-agent-sdk==0.1.21
```

### 更新 requirements.txt

确保 `requirements.txt` 包含：
```txt
claude-agent-sdk==0.1.21
```

### 使用示例

```python
from claude_agent_sdk import query

async def call_claude_sdk(prompt: str, options: dict):
    """使用官方 Python Agent SDK"""
    async for chunk in query(prompt=prompt, **options):
        # 处理流式响应
        if chunk.type == 'assistant' and chunk.message:
            for block in chunk.message.content:
                if block.type == 'text':
                    yield block.text
                elif block.type == 'tool_use':
                    # 处理工具调用
                    pass
```

### 官方资源

- 📚 英文文档：https://platform.claude.com/docs/en/agent-sdk/python
- 📚 中文文档：https://platform.claude.com/docs/zh-CN/agent-sdk/python
- 🚀 快速入门：https://platform.claude.com/docs/en/agent-sdk/quickstart
- 💻 GitHub：https://github.com/anthropics/claude-agent-sdk-python

## 主要模块说明

### server.py
- FastAPI 应用主文件
- API 端点定义
- 配置管理
- SSE 流式响应

### skill_loader.py
- 技能目录初始化
- 技能内容加载和验证
- 技能索引管理
- 安全过滤

### skills_api.py
- Skills REST API 路由
- 技能 CRUD 操作
- 启用/禁用切换

## 故障排除

### 问题：Python 未找到

**解决方案：**
1. 确认 Python 已安装：`python --version`
2. Windows：重新安装并勾选 "Add to PATH"
3. 手动添加到系统环境变量

### 问题：依赖安装失败

**解决方案：**
```bash
# 使用国内镜像
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 问题：端口被占用

**解决方案：**
修改 `.env` 文件：
```env
PORT=3002
```

## 下一步

1. 安装 Python 环境
2. 配置 `.env` 文件
3. 安装依赖包
4. 选择 Claude SDK 集成方案
5. 启动服务器测试

## 获取帮助

- 查看 `README_PYTHON.md` 获取详细文档
- 参考 `server.js` 了解原始实现
- 查阅 FastAPI 文档：https://fastapi.tiangolo.com/

