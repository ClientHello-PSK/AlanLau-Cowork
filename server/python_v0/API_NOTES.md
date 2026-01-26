# API 实现说明

## Python vs Node.js 版本差异

### 权限钩子 (can_use_tool)

**Python 版本 (server.py):**
```python
async def can_use_tool(tool: str, input: dict) -> bool:
    """返回布尔值"""
    if tool in file_tools and not validation['allowed']:
        print(f'[SANDBOX] Blocked {tool}: {validation["reason"]}')
        return False
    return True
```

**Node.js 版本 (server.js):**
```javascript
async function can_use_tool(toolName, toolInput) {
    /* 返回对象 */
    if (!validation.allowed) {
        return { allowed: false, reason: validation.reason };
    }
    return { allowed: true };
}
```

**说明：**
- 两种方式都符合官方 SDK 规范
- Python SDK 的 `can_use_tool` 支持返回 `bool` 或 `{'allowed': bool, 'reason': str}`
- Node.js SDK 要求返回对象格式
- Python 版本选择返回 `bool`，拒绝原因通过日志记录

---

### 会话管理

两种版本都使用 `query()` 函数 + `resume` 参数来实现会话恢复：

```python
# Python
existing_session_id = chat_sessions.get(request.chatId)
if existing_session_id:
    query_options['resume'] = existing_session_id
```

```javascript
// Node.js
const existingSessionId = chatSessions.get(chatId);
if (existingSessionId) {
    queryOptions.resume = existingSessionId;
}
```

---

### ClaudeSDKClient 使用场景

如果改用 `ClaudeSDKClient`，则不需要手动管理 `resume`：

```python
# ClaudeSDKClient 自动管理会话
async with ClaudeSDKClient(options=options) as client:
    await client.query("First message")  # 自动创建会话
    await client.query("Second message")  # 自动使用同一会话
```

但 python_v0 采用无状态 API 架构，不适合使用 ClaudeSDKClient。

---

## 官方文档参考

详见：https://platform.claude.com/docs/zh-CN/agent-sdk/python



