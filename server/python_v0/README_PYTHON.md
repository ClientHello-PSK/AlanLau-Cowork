# Python 版本的 Claude Agent SDK Server

这是基于 FastAPI 实现的 Python 版本 Claude Agent SDK Server，功能与 Node.js 版本完全一致。

## 功能特性

- ✅ FastAPI 异步框架，高性能流式响应
- ✅ SSE (Server-Sent Events) 流式输出
- ✅ 文件沙箱安全机制
- ✅ 工具调用权限控制
- ✅ 会话管理和持久化
- ✅ Skills 系统支持（本地 + Claude Code）
- ✅ 配置持久化
- ✅ CORS 支持

## 安装依赖

### 1. 创建虚拟环境（推荐）

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# Linux/Mac
python3 -m venv venv
source venv/bin/activate
```

### 2. 安装依赖包

```bash
pip install -r requirements.txt
```

## 配置

创建 `.env` 文件在项目根目录：

```env
# Anthropic API 配置
ANTHROPIC_API_KEY=your_api_key_here
ANTHROPIC_API_ENDPOINT=https://api.anthropic.com

# 工作空间配置
WORKSPACE_DIR=C:\path\to\your\workspace
SANDBOX_ENABLED=true

# 服务器配置
PORT=3001
```

## 启动服务器

### Windows

```bash
# 双击运行
run_python_server.bat

# 或命令行
python server.py
```

### Linux/Mac

```bash
# 添加执行权限
chmod +x start_python_server.sh

# 运行
./start_python_server.sh

# 或直接
python server.py
```

## API 端点

### 健康检查
```http
GET /api/health
```

### 配置管理
```http
GET /api/config
POST /api/config
```

### 聊天接口（SSE 流式）
```http
POST /api/chat
Content-Type: application/json

{
  "message": "你好",
  "chatId": "optional-chat-id",
  "userId": "default-user",
  "files": []
}
```

### Skills API

```http
# 列出所有技能
GET /api/skills

# 获取技能详情
GET /api/skills/{name}

# 切换技能状态
POST /api/skills/toggle
{
  "name": "skill-name",
  "enabled": true
}

# 创建技能
POST /api/skills/create
{
  "name": "new-skill",
  "content": "# Skill content"
}

# 删除技能
DELETE /api/skills/{name}
```

## 与 Node.js 版本的区别

### 相同点
- ✅ 相同的 API 端点结构
- ✅ 相同的配置管理方式
- ✅ 相同的文件沙箱逻辑
- ✅ 相同的 Skills 系统功能
- ✅ 相同的流式响应格式

### 不同点
- 🔧 使用 FastAPI 替代 Express
- 🔧 使用 asyncio 异步编程
- 🔧 使用 Pydantic 进行数据验证
- 🔧 使用 pathlib 进行路径操作
- 🔧 Python 原生的异常处理

## Claude Agent SDK 集成

✅ **官方 Python Agent SDK 已发布！**

### 安装依赖

将 `claude-agent-sdk` 添加到 `requirements.txt`：

```txt
claude-agent-sdk==0.1.21
```

### API 选择：`query()` vs `ClaudeSDKClient`

官方 SDK 提供两种使用方式：

| 功能             | `query()`                     | `ClaudeSDKClient`                  |
| :------------------ | :---------------------------- | :--------------------------------- |
| **会话**         | 每次创建新会话 | 重用同一会话                |
| **对话**    | 单次交换               | 同一上下文中的多次交换 |
| **连接**      | 自动管理         | 手动控制                     |
| **流式输入** | ✅ 支持                  | ✅ 支持                       |
| **中断**      | ❌ 不支持              | ✅ 支持                       |
| **钩子**           | ✅ 支持              | ✅ 支持                       |
| **自定义工具**    | ❌ 不支持              | ✅ 支持                       |
| **继续聊天**   | ❌ 每次新会话      | ✅ 保持对话          |
| **用例**        | 一次性任务                 | 持续对话           |

### 方案选择建议

**使用 `query()`（本服务器采用）**：
- 适合 Web API 服务器场景
- 每次请求独立处理
- 通过 `session_id` 手动管理会话
- 更适合无状态架构

**使用 `ClaudeSDKClient`**：
- 适合交互式应用（如 CLI、REPL）
- 需要保持长时间对话上下文
- 更复杂的会话管理需求

### 使用 `query()` 的示例

```python
from claude_agent_sdk import query, ClaudeAgentOptions
from claude_agent_sdk.types import AssistantMessage, TextBlock, ToolUseBlock

# 配置选项
options = ClaudeAgentOptions(
    permission_mode='bypassPermissions',
    allowed_tools=['Read', 'Write', 'Edit', 'Bash'],
    max_turns=20,
    cwd='/path/to/workspace'
)

async def chat_stream():
    """使用官方 SDK 进行流式聊天"""
    async for message in query(prompt=enhanced_prompt, options=options):
        # 处理助手消息
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    # 文本内容
                    yield f"data: {json.dumps({'type': 'text', 'content': block.text})}\n\n"
                elif isinstance(block, ToolUseBlock):
                    # 工具调用
                    yield f"data: {json.dumps({'type': 'tool_use', 'name': block.name, 'input': block.input, 'id': block.id})}\n\n"
```

### 权限钩子

```python
async def can_use_tool(tool: str, input: dict) -> bool:
    """权限控制钩子"""
    if tool == 'Bash':
        command = input.get('command', '')
        # 实现自定义权限逻辑
        return is_command_safe(command)
    return True

options = ClaudeAgentOptions(
    can_use_tool=can_use_tool
)
```

### 沙箱配置

```python
from claude_agent_sdk import SandboxSettings

sandbox_settings: SandboxSettings = {
    'enabled': True,
    'autoAllowBashIfSandboxed': True,
    'excludedCommands': ['docker'],
    'network': {
        'allowLocalBinding': True,
        'allowUnixSockets': ['/var/run/docker.sock']
    }
}

options = ClaudeAgentOptions(
    sandbox=sandbox_settings
)
```

### 官方资源

- 📚 英文文档：https://platform.claude.com/docs/en/agent-sdk/python
- 📚 中文文档：https://platform.claude.com/docs/zh-CN/agent-sdk/python
- 🚀 快速入门：https://platform.claude.com/docs/en/agent-sdk/quickstart
- 💻 GitHub：https://github.com/anthropics/claude-agent-sdk-python

## 文件沙箱说明

沙箱机制确保文件操作限制在配置的工作目录内：

- **绝对路径检查**：验证路径格式（Windows/Unix）
- **相对路径解析**：相对路径相对于工作目录
- **路径验证**：确保最终路径在工作目录内
- **工具拦截**：拦截 Read/Write/Edit/Glob/Grep 工具调用

示例：
```python
# 验证路径
result = validate_file_path('../secrets.txt', '/safe/workspace')
# {'allowed': False, 'reason': '路径 "../secrets.txt" 超出工作目录范围'}
```

## 开发和调试

### 启用详细日志

```bash
# 修改 server.py 中的日志级别
import logging
logging.basicConfig(level=logging.DEBUG)
```

### 测试 API

使用 curl 测试：
```bash
# 健康检查
curl http://localhost:3001/api/health

# 发送消息
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

## 故障排除

### 端口被占用
```bash
# 修改 .env 中的 PORT
PORT=3002
```

### 权限错误
```bash
# Windows：以管理员身份运行
# Linux/Mac：检查文件权限
chmod +x start_python_server.sh
```

### 依赖安装失败
```bash
# 使用国内镜像
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

## 性能优化

### 使用 Uvicorn 的生产配置
```bash
uvicorn server:app --host 0.0.0.0 --port 3001 --workers 4
```

### 启用缓存
```python
from fastapi_cache import FastAPICache
from fastapi_cache.backends.inmemory import InMemoryBackend

FastAPICache.init(InMemoryBackend())
```

## 许可证

与原 Node.js 版本保持一致。

## 贡献

欢迎提交 Issue 和 Pull Request！

