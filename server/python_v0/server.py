"""
Claude Agent SDK Python Server
使用 FastAPI 提供与 Node.js 版本相同的功能
"""

import os
import json
import re
import base64
from pathlib import Path
from typing import Dict, Any, Optional, Set
from datetime import datetime
import asyncio

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from skills_api import router as skills_router
from skill_loader import init_skills_directory, seed_example_skill, build_skills_prompt

# 加载环境变量
load_dotenv()

# FastAPI 应用
app = FastAPI(title="Claude Agent SDK Server")

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 Skills API 路由
app.include_router(skills_router)

# 配置
PORT = int(os.getenv('PORT', '3001'))
CONFIG_FILE = Path(__file__).parent / 'workspace-config.json'

# 会话存储（chat_id -> session_id）
chat_sessions: Dict[str, str] = {}


class ServerConfig:
    """服务器配置"""
    def __init__(self):
        self.api_endpoint: str = os.getenv('ANTHROPIC_API_ENDPOINT', 'https://api.anthropic.com')
        self.api_key: str = os.getenv('ANTHROPIC_API_KEY', '')
        self.max_turns: int = 20
        self.permission_mode: str = 'bypassPermissions'
        self.workspace_dir: str = os.getenv('WORKSPACE_DIR', '')
        self.sandbox_enabled: bool = os.getenv('SANDBOX_ENABLED', 'true').lower() != 'false'


def load_config() -> ServerConfig:
    """从文件加载配置"""
    config = ServerConfig()
    
    try:
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                saved = json.load(f)
                config.workspace_dir = saved.get('workspaceDir', config.workspace_dir)
                config.sandbox_enabled = saved.get('sandboxEnabled', config.sandbox_enabled)
                config.max_turns = saved.get('maxTurns', config.max_turns)
    except Exception as error:
        print(f'[CONFIG] Failed to load saved config: {error}')
    
    return config


def save_config(config: ServerConfig):
    """保存配置到文件"""
    try:
        to_save = {
            'workspaceDir': config.workspace_dir,
            'sandboxEnabled': config.sandbox_enabled,
            'maxTurns': config.max_turns
        }
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(to_save, f, indent=2)
        print(f'[CONFIG] Saved to {CONFIG_FILE}')
    except Exception as error:
        print(f'[CONFIG] Failed to save config: {error}')


# 全局配置实例
server_config = load_config()


# ============================================
# File Sandbox Utilities
# ============================================

def is_absolute_path(p: str) -> bool:
    """检查路径是否为绝对路径（Windows 或 Unix）"""
    if not p:
        return False
    
    # Windows: C:\, D:\, etc. or UNC paths \\server\share
    if re.match(r'^[A-Za-z]:[\\/]', p) or p.startswith('\\\\'):
        return True
    
    # Unix: starts with /
    if p.startswith('/'):
        return True
    
    return False


def resolve_in_workspace(target_path: str, workspace_dir: str) -> Optional[str]:
    """解析路径相对于工作目录"""
    if not workspace_dir:
        return None
    
    if is_absolute_path(target_path):
        return str(Path(target_path).resolve())
    else:
        return str(Path(workspace_dir) / target_path)


def is_path_in_workspace(resolved_path: str, workspace_dir: str) -> bool:
    """检查解析后的路径是否在工作目录内"""
    if not workspace_dir or not resolved_path:
        return False
    
    normalized_workspace = str(Path(workspace_dir).resolve()).lower()
    normalized_path = str(Path(resolved_path).resolve()).lower()
    
    return (
        normalized_path == normalized_workspace or
        normalized_path.startswith(normalized_workspace + os.sep)
    )


def validate_file_path(target_path: str, workspace_dir: str) -> Dict[str, Any]:
    """验证文件操作路径是否在沙箱内"""
    if not workspace_dir:
        return {
            'allowed': False,
            'reason': '工作目录未设置，请先在设置中配置工作目录'
        }
    
    resolved = resolve_in_workspace(target_path, workspace_dir)
    
    if not is_path_in_workspace(resolved or '', workspace_dir):
        return {
            'allowed': False,
            'reason': f'路径 "{target_path}" 超出工作目录范围 ({workspace_dir})'
        }
    
    return {'allowed': True}


# ============================================
# Request/Response Models
# ============================================

class ChatRequest(BaseModel):
    """聊天请求"""
    message: str
    chatId: Optional[str] = None
    userId: str = 'default-user'
    files: Optional[list] = None


class ConfigUpdateRequest(BaseModel):
    """配置更新请求"""
    apiEndpoint: Optional[str] = None
    apiKey: Optional[str] = None
    maxTurns: Optional[int] = None
    permissionMode: Optional[str] = None
    workspaceDir: Optional[str] = None
    sandboxEnabled: Optional[bool] = None


class ConfigResponse(BaseModel):
    """配置响应"""
    apiEndpoint: str
    hasApiKey: bool
    maxTurns: int
    permissionMode: str
    workspaceDir: str
    sandboxEnabled: bool


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str
    timestamp: str
    config: Dict[str, Any]


# ============================================
# API Endpoints
# ============================================


@app.get('/api/health', response_model=HealthResponse)
async def health_check():
    """健康检查端点，包含诊断信息"""
    return HealthResponse(
        status='ok',
        timestamp=datetime.now().isoformat(),
        config={
            'hasApiKey': bool(server_config.api_key),
            'apiEndpoint': server_config.api_endpoint
        }
    )


@app.get('/api/config', response_model=ConfigResponse)
async def get_config():
    """获取当前配置"""
    return ConfigResponse(
        apiEndpoint=server_config.api_endpoint,
        hasApiKey=bool(server_config.api_key),
        maxTurns=server_config.max_turns,
        permissionMode=server_config.permission_mode,
        workspaceDir=server_config.workspace_dir,
        sandboxEnabled=server_config.sandbox_enabled
    )


@app.post('/api/config')
async def update_config(request: ConfigUpdateRequest):
    """更新配置（动态配置）"""
    if request.apiEndpoint is not None:
        server_config.api_endpoint = request.apiEndpoint
    if request.apiKey is not None:
        server_config.api_key = request.apiKey
    if request.maxTurns is not None:
        server_config.max_turns = request.maxTurns
    if request.permissionMode is not None:
        server_config.permission_mode = request.permissionMode
    if request.workspaceDir is not None:
        # 规范化 Windows 路径
        server_config.workspace_dir = str(Path(request.workspaceDir).resolve()) if request.workspaceDir else ''
    if request.sandboxEnabled is not None:
        server_config.sandbox_enabled = request.sandboxEnabled
    
    # 持久化工作空间设置
    save_config(server_config)
    
    print(f'[CONFIG] Config updated: {dict(apiEndpoint=server_config.api_endpoint, hasApiKey=bool(server_config.api_key), maxTurns=server_config.max_turns, permissionMode=server_config.permission_mode, workspaceDir=server_config.workspace_dir, sandboxEnabled=server_config.sandbox_enabled)}')
    
    return ConfigResponse(
        apiEndpoint=server_config.api_endpoint,
        hasApiKey=bool(server_config.api_key),
        maxTurns=server_config.max_turns,
        permissionMode=server_config.permission_mode,
        workspaceDir=server_config.workspace_dir,
        sandboxEnabled=server_config.sandbox_enabled
    )


@app.post('/api/chat')
async def chat(request: ChatRequest):
    """使用 Claude Agent SDK 的聊天端点（SSE 流式响应）"""
    print(f'[CHAT] Request received: {request.message}')
    print(f'[CHAT] Chat ID: {request.chatId}')
    print(f'[CHAT] Files attached: {len(request.files) if request.files else 0}')
    
    if not request.message:
        raise HTTPException(status_code=400, detail='Message is required')
    
    # 检查工作空间配置
    if server_config.sandbox_enabled and not server_config.workspace_dir:
        async def error_stream():
            yield f"data: {json.dumps({'type': 'error', 'message': '请先在设置中配置工作目录（Workspace Directory）'}, ensure_ascii=False)}\n\n"
        
        return StreamingResponse(error_stream(), media_type='text/event-stream')
    
    # 构建增强 prompt：消息 + 文件附件
    enhanced_prompt = request.message
    
    # 如果有附件文件，将其内容添加到 prompt 中
    if request.files and len(request.files) > 0:
        temp_dir = Path(__file__).parent / '.temp'
        temp_dir.mkdir(exist_ok=True)
        
        file_contents = []
        for file in request.files:
            if file.get('type', '').startswith('image/'):
                # 图片文件：保存到本地，传递文件路径
                base64_data = re.sub(r'^data:image/\w+;base64,', '', file['data'])
                buffer = base64.b64decode(base64_data)
                ext = file['type'].split('/')[1] if '/' in file['type'] else 'png'
                filename = f"img_{datetime.now().timestamp()}_{hash(file['name']) % 10000}.{ext}"
                file_path = temp_dir / filename
                
                file_path.write_bytes(buffer)
                print(f'[CHAT] Image saved to: {file_path}')
                
                file_contents.append(f'[Image: {file["name"]}]\n文件路径: {file_path}')
            else:
                # 文本文件：直接包含内容
                file_contents.append(f'[File: {file["name"]}]\n```\n{file["data"]}\n```')
        
        enhanced_prompt = f'{request.message}\n\n---\n**附件内容：**\n\n' + '\n\n'.join(file_contents)
    
    # 构建技能上下文增强 prompt
    try:
        skills_context = await build_skills_prompt()
        if skills_context:
            enhanced_prompt = f'<available_skills>\n{skills_context}\n</available_skills>\n\n{enhanced_prompt}'
            print('[SKILLS] Injected skills context')
    except Exception as skill_error:
        print(f'[SKILLS] Failed to build skills prompt: {skill_error}')
    
    # 构建查询选项（使用官方 ClaudeAgentOptions）
    from claude_agent_sdk import ClaudeAgentOptions
    
    # 沙箱配置
    sandbox_settings = None
    if server_config.sandbox_enabled and server_config.workspace_dir:
        from claude_agent_sdk import SandboxSettings
        sandbox_settings: SandboxSettings = {
            'enabled': True,
            'autoAllowBashIfSandboxed': True
        }
        print(f'[SANDBOX] Enabled with workspace: {server_config.workspace_dir}')
    
    # 权限钩子函数
    # 注意：根据官方文档，can_use_tool 可以返回 bool 或 {'allowed': bool, 'reason': str}
    # Python 版本使用 bool 返回值（与 TypeScript 版本不同，但符合 SDK 规范）
    async def can_use_tool(tool: str, input: dict) -> bool:
        """权限钩子 - 检查工具调用是否被允许
        
        返回:
            bool: True 表示允许，False 表示拒绝
            
        说明:
            - TypeScript/Node.js 版本返回对象 {allowed: bool, reason: str}
            - Python 版本直接返回 bool，符合官方 SDK 规范
            - 拒绝原因通过 print 记录到日志
        """
        # 文件操作工具需要路径验证
        file_tools = {'Read', 'Write', 'Edit', 'Glob', 'Grep'}
        
        if tool in file_tools and server_config.workspace_dir:
            # 从各种输入格式提取路径
            file_path = (
                input.get('path') or
                input.get('file') or
                input.get('target') or
                input.get('pattern') or
                input.get('glob_pattern')
            )
            
            if file_path:
                validation = validate_file_path(file_path, server_config.workspace_dir)
                if not validation['allowed']:
                    print(f'[SANDBOX] Blocked {tool}: {validation["reason"]}')
                    return False
        
        # Bash 命令：记录警告但允许
        if tool == 'Bash':
            command = input.get('command', '')
            print(f'[SANDBOX] Bash command: {command[:50]}')
        
        return True
    
    # 构建官方 SDK 选项
    query_options = ClaudeAgentOptions(
        permission_mode=server_config.permission_mode,
        allowed_tools=[
            'Read',
            'Write',
            'Edit',
            'Bash',
            'Glob',
            'Grep',
            'WebSearch',
            'WebFetch',
            'TodoWrite'
        ],
        max_turns=server_config.max_turns,
        can_use_tool=can_use_tool,
        sandbox=sandbox_settings
    )
    
    # 设置工作目录
    if server_config.workspace_dir:
        query_options['cwd'] = server_config.workspace_dir
    
    # 恢复现有会话
    existing_session_id = chat_sessions.get(request.chatId)
    if existing_session_id:
        query_options['resume'] = existing_session_id
        print(f'[CHAT] Resuming session: {existing_session_id}')
    
    # SSE 流式响应生成器
    async def chat_stream():
        try:
            from claude_agent_sdk import query
            from claude_agent_sdk.types import (
                AssistantMessage,
                TextBlock,
                ToolUseBlock,
                ToolResultMessage
            )
            
            print('[CHAT] Calling Claude Agent SDK...')
            
            # 使用官方 query 函数进行流式响应
            async for message in query(prompt=enhanced_prompt, options=query_options):
                # 处理系统消息
                if hasattr(message, 'type') and message.type == 'system':
                    if hasattr(message, 'subtype') and message.subtype == 'init':
                        session_id = getattr(message, 'session_id', None)
                        if session_id and request.chatId:
                            chat_sessions[request.chatId] = session_id
                        print(f'[CHAT] Session initialized: {session_id}')
                
                # 处理助手消息
                elif isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            # 文本内容
                            yield f"data: {json.dumps({'type': 'text', 'content': block.text}, ensure_ascii=False)}\n\n"
                        elif isinstance(block, ToolUseBlock):
                            # 工具调用
                            yield f"data: {json.dumps({'type': 'tool_use', 'name': block.name, 'input': block.input, 'id': block.id}, ensure_ascii=False)}\n\n"
                
                # 处理工具结果
                elif isinstance(message, ToolResultMessage):
                    for tool_result in message.content:
                        yield f"data: {json.dumps({'type': 'tool_result', 'result': tool_result.result, 'tool_use_id': tool_result.tool_use_id}, ensure_ascii=False)}\n\n"
            
            # 完成
            yield 'data: {"type": "done"}\n\n'
            
        except ImportError as e:
            print(f'[CHAT] SDK import error: {e}')
            yield f"data: {json.dumps({'type': 'error', 'message': f'请安装 Claude Agent SDK: pip install claude-agent-sdk==0.1.21'}, ensure_ascii=False)}\n\n"
        except Exception as error:
            print(f'[CHAT] Error: {error}')
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(error)}, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        chat_stream(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    )


# ============================================
# Server Startup
# ============================================

@app.on_event('startup')
async def startup_event():
    """服务器启动事件"""
    print(f'\n✓ Backend server running on http://localhost:{PORT}')
    print(f'✓ Chat endpoint: POST http://localhost:{PORT}/api/chat')
    print(f'✓ Health check: GET http://localhost:{PORT}/api/health')
    print('✓ Skills API: /api/skills/*')
    
    # 初始化技能目录
    skills_init = await init_skills_directory()
    if skills_init.success:
        print('✓ Skills directory initialized')
        # 预置示例技能
        await seed_example_skill()
    else:
        print(f'⚠ Skills directory init failed: {skills_init.error}')
    
    # 显示沙箱状态
    if server_config.sandbox_enabled:
        if server_config.workspace_dir:
            print(f'✓ Sandbox enabled - Workspace: {server_config.workspace_dir}')
        else:
            print('⚠ Sandbox enabled but no workspace directory set')
    else:
        print('⚠ Sandbox disabled - File access unrestricted')
    print('')


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=PORT)

