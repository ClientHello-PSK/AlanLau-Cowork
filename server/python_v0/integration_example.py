"""
Claude Agent SDK 集成示例

展示如何在 Python server 中集成 Claude Agent SDK
"""

import subprocess
import json
import asyncio
from typing import Dict, Any, AsyncIterator
from pathlib import Path


class ClaudeSDKIntegration:
    """Claude Agent SDK 集成类"""
    
    def __init__(self, node_script_path: str = None):
        """
        初始化集成
        
        Args:
            node_script_path: Node.js SDK 调用脚本路径
        """
        self.node_script_path = node_script_path or str(Path(__file__).parent / 'call_claude.js')
    
    async def query(self, prompt: str, options: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
        """
        调用 Claude Agent SDK（流式）
        
        Args:
            prompt: 用户提示词
            options: 查询选项
            
        Yields:
            响应块（字典格式）
        """
        input_data = {
            'prompt': prompt,
            'options': options
        }
        
        # 创建子进程
        process = await asyncio.create_subprocess_exec(
            'node', self.node_script_path,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        # 发送输入数据
        input_json = json.dumps(input_data, ensure_ascii=False)
        process.stdin.write(input_json.encode('utf-8'))
        process.stdin.close()
        
        # 读取输出（行格式，每行一个 JSON）
        async for line in process.stdout:
            line = line.decode('utf-8').strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as e:
                    print(f'[SDK] Failed to parse JSON: {e}')
                    print(f'[SDK] Raw line: {line}')
        
        # 等待进程结束
        await process.wait()
        
        # 检查错误
        if process.returncode != 0:
            error_output = await process.stderr.read()
            print(f'[SDK] Process error: {error_output.decode("utf-8")}')


# 示例：在 server.py 中使用

"""
将以下代码添加到 server.py 的 chat_stream() 函数中：

from integration_example import ClaudeSDKIntegration

# 在应用启动时初始化
claude_integration = ClaudeSDKIntegration()

# 替换 chat_stream() 中的模拟实现
async def chat_stream():
    try:
        print('[CHAT] Calling Claude Agent SDK...')
        
        # 使用集成类调用 SDK
        async for chunk in claude_integration.query(enhanced_prompt, query_options):
            if chunk.get('type') == 'system' and chunk.get('subtype') == 'init':
                session_id = chunk.get('session_id') or chunk.get('data', {}).get('session_id')
                if session_id and request.chatId:
                    chat_sessions[request.chatId] = session_id
                    print(f'[CHAT] Session ID captured: {session_id}')
                yield f"data: {json.dumps({'type': 'session_init', 'session_id': session_id}, ensure_ascii=False)}\n\n"
            
            elif chunk.get('type') == 'assistant' and chunk.get('message'):
                content = chunk['message'].get('content', [])
                if isinstance(content, list):
                    for block in content:
                        if block.get('type') == 'text' and block.get('text'):
                            yield f"data: {json.dumps({'type': 'text', 'content': block['text']}, ensure_ascii=False)}\n\n"
                        elif block.get('type') == 'tool_use':
                            tool_event = {
                                'type': 'tool_use',
                                'name': block.get('name'),
                                'input': block.get('input'),
                                'id': block.get('id')
                            }
                            yield f"data: {json.dumps(tool_event, ensure_ascii=False)}\n\n"
            
            elif chunk.get('type') in ['tool_result', 'result']:
                event_data = {
                    'type': 'tool_result',
                    'result': chunk.get('result') or chunk.get('content') or chunk,
                    'tool_use_id': chunk.get('tool_use_id')
                }
                yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"
        
        # 发送完成信号
        yield 'data: {"type": "done"}\n\n'
        print('[CHAT] Stream completed')
        
    except Exception as error:
        print(f'[CHAT] Error: {error}')
        yield f"data: {json.dumps({'type': 'error', 'message': str(error)}, ensure_ascii=False)}\n\n"
"""


# ========================================
# Node.js 包装脚本示例
# ========================================

"""
创建 call_claude.js 文件：

const { query } = require('@anthropic-ai/claude-agent-sdk');
const readline = require('readline');

// 从标准输入读取输入
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let inputData = '';

rl.on('line', (line) => {
  inputData += line;
});

rl.on('close', async () => {
  try {
    const { prompt, options } = JSON.parse(inputData);
    
    // 流式调用 Claude Agent SDK
    for await (const chunk of query(prompt, options)) {
      // 每行输出一个 JSON 对象
      console.log(JSON.stringify(chunk));
    }
  } catch (error) {
    console.error(JSON.stringify({
      type: 'error',
      message: error.message
    }));
    process.exit(1);
  }
});
"""


# ========================================
# 直接使用 Anthropic Python SDK
# ========================================

"""
或者使用官方 Python SDK（不包含工具调用功能）：

from anthropic import Anthropic
import asyncio

class AnthropicDirect:
    \"\"\"直接使用 Anthropic Python SDK\"\"\"
    
    def __init__(self, api_key: str):
        self.client = Anthropic(api_key=api_key)
    
    async def query(self, prompt: str, options: Dict[str, Any]) -> AsyncIterator[Dict[str, Any]]:
        \"\"\"查询 Claude（非流式）\"\"\"
        try:
            # 创建消息（不流式）
            response = self.client.messages.create(
                model=options.get('model', 'claude-sonnet-4-20250514'),
                max_tokens=options.get('maxTokens', 4096),
                messages=[{"role": "user", "content": prompt}]
            )
            
            # 输出响应
            content = ''.join(
                block.text for block in response.content
                if hasattr(block, 'text')
            )
            
            yield {
                'type': 'text',
                'content': content
            }
            
            yield {'type': 'done'}
            
        except Exception as error:
            yield {
                'type': 'error',
                'message': str(error)
            }


# 在 server.py 中使用：
# anthropic = AnthropicDirect(api_key=server_config.api_key)
# async for chunk in anthropic.query(enhanced_prompt, query_options):
#     yield f"data: {json.dumps(chunk, ensure_ascii=False)}\\n\\n"
"""


# ========================================
# 使用示例
# ========================================

async def example_usage():
    """使用示例"""
    integration = ClaudeSDKIntegration()
    
    prompt = "Hello, how are you?"
    options = {
        'maxTurns': 20,
        'permissionMode': 'bypassPermissions'
    }
    
    print("Querying Claude...")
    async for chunk in integration.query(prompt, options):
        print(f"Received chunk: {chunk.get('type')}")


if __name__ == '__main__':
    # 运行示例
    # asyncio.run(example_usage())
    print("This is an integration example module.")
    print("See the code comments for usage instructions.")

