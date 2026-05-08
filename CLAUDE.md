# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1 身份定义

-Role：Principal Engineer & Senior Data Scientist.
-Voice：Professional,Concise,Result-Oriented.No "I hope this help".
-Authority：The user is the Lead Architect.Execute commands immediately.

## 2 行动法则

-_Think Before Act_:Before any file modification,outline your plan in 3 bullet points. -_Verification First_:Never report "Done" until you have run a verification script. -_Error Handling_:If a command fails,read error log -> analyze root cause -> fix. -_Test Coverage_:After any code changes,run `npm test` to verify all tests pass. Never commit code that breaks existing tests.

## 3 心法约束

-**DRY**：Don't Repeat Yourself -**KISS**:Keep It Simple,Stupid

## 项目概述

这是一个基于 Electron 的桌面聊天应用，使用 DeepSeek API 构建 AI 助手。应用支持多会话管理、内置工具调用（文件读写、Bash、搜索等）、实时流式响应等功能。

## 常用命令

### 启动应用

需要**两个终端窗口**：

**终端 1 - 启动后端服务器：**

```bash
cd server
npm start
```

后端运行在 `http://localhost:3001`

**终端 2 - 启动 Electron 应用：**

```bash
npm start          # 正常启动
npm run dev        # 开发模式（带热重载）
```

### 依赖安装

```bash
# 安装 Electron 应用依赖
npm install

# 安装后端依赖
cd server && npm install
```

### 自动化设置

```bash
# Windows 一键启动
start.bat         # 自动安装依赖并启动服务
start-dev.bat     # 开发模式启动
stop.bat          # 停止所有服务
reinstall.bat     # 重装依赖
```

### 测试命令

```bash
npm test        # 运行所有单元测试 (Vitest)
npm run test:unit   # 运行单元测试
npm run test:api    # 运行 API 测试
npm run test:e2e    # 运行 E2E 测试 (Playwright)
npm run test:all    # 运行所有测试
npm run lint        # 检查代码风格
npm run lint:fix    # 自动修复代码风格问题
```

**重要：代码修改后必须运行测试验证**

- 完成任何代码修改后，必须运行 `npm test` 验证所有测试用例通过
- 如果测试失败，必须修复问题后再提交代码
- 这是强制要求，不得跳过测试验证步骤

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron App                              │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │   Main Process  │    │ Renderer Process │                    │
│  │   (main.js)     │    │  (renderer.js)   │                    │
│  └────────┬────────┘    └────────┬─────────┘                    │
│           │                      │                               │
│           └──────────┬───────────┘                               │
│                      │ IPC (preload.js)                          │
└──────────────────────┼───────────────────────────────────────────┘
                       │
                       │ HTTP + SSE
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend Server                               │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  Express.js     │───▶│  DeepSeek API    │                    │
│  │  (server.js)    │    │ (OpenAI SDK)     │                    │
│  └─────────────────┘    └────────┬─────────┘                    │
│                                  │                               │
│                                  ▼                               │
│                    ┌─────────────────────────┐                   │
│                    │   Tool Executor         │                   │
│                    │   (tools.js)            │                   │
│                    └─────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## 核心文件说明

### Electron 主进程

- **[main.js](main.js)** - Electron 主进程入口，创建窗口，处理应用生命周期

### IPC 安全桥接

- **[preload.js](preload.js)** - 使用 `contextBridge` 向渲染进程暴露安全的 API，通过 fetch 与后端通信

### 渲染进程（前端）

- **[renderer/index.html](renderer/index.html)** - 聊天界面 HTML
- **[renderer/renderer.js](renderer/renderer.js)** - 前端逻辑，处理 UI 交互、SSE 流式响应、多会话管理
- **[renderer/styles/](renderer/styles/)** - 模块化样式文件（base.css, layout.css, chatView.css 等）

### 后端服务器

- **[server/server.js](server/server.js)** - Express 服务器，集成 DeepSeek API，处理聊天请求和 SSE 流式响应
- **[server/tools.js](server/tools.js)** - 工具定义与执行器（Read/Write/Edit/Bash/Glob/Grep/WebFetch/TodoWrite）
- **[server/package.json](server/package.json)** - 后端依赖配置（使用 ES modules：`"type": "module"`）

## 会话管理机制

应用使用服务端内存中的消息历史实现会话管理：

1. **首次消息**：在 `chatSessions` Map 中为 chatId 创建新会话
2. **后续消息**：使用同一 chatId 追加消息到已有会话
3. **前端映射**：前端通过 `currentChatId` 对应服务端的 chatId
4. **上下文保持**：完整的对话上下文在服务端维护，支持自动裁剪超长消息

## 多聊天功能

- **状态存储**：`allChats` 数组存储所有聊天，`currentChatId` 标识当前聊天
- **本地持久化**：使用 localStorage 保存聊天状态
- **聊天切换**：`switchToChat()` 和 `loadChat()` 处理聊天间切换
- **聊天删除**：`deleteChat()` 删除指定聊天

## SSE 流式响应处理

后端通过 Server-Sent Events 流式传输数据：

- `session_init` - 会话初始化
- `text` - 文本内容
- `reasoning` - 深度思考内容
- `tool_use` - 工具调用信息
- `tool_result` - 工具执行结果
- `done` - 响应完成
- `error` - 错误信息

前端在 `handleSendMessage()` 中逐行解析 SSE 数据，实时更新 UI。

## 工具调用可视化

- **右侧边栏**：显示所有工具调用的输入/输出详情
- **内联显示**：在消息流中直接显示工具调用过程
- **Todo 列表**：从 `TodoWrite` 工具调用中提取并显示任务进度

## 配置文件

- **[.env](.env)** - API 密钥配置（不提交到版本控制）
  - `DEEPSEEK_API_KEY` - DeepSeek API 密钥
  - `DEEPSEEK_BASE_URL` - DeepSeek API 地址
- **[.env.example](.env.example)** - 环境变量模板

## 技术栈

| 类别     | 技术                           |
| -------- | ------------------------------ |
| 桌面框架 | Electron.js                    |
| 后端     | Node.js + Express (ES modules) |
| AI API   | DeepSeek API (OpenAI SDK)      |
| 工具执行 | 自研 Tool Executor (tools.js)  |
| 流式传输 | Server-Sent Events (SSE)       |
| Markdown | Marked.js                      |

## 开发注意事项

1. **后端使用 ES modules**：`server/package.json` 中设置 `"type": "module"`，使用 `import/export` 语法
2. **IPC 通信**：通过 preload.js 的 `contextBridge` 暴露安全 API，避免直接使用 `ipcRenderer`
3. **流式响应**：使用 DeepSeek API 的 streaming 模式，通过 SSE 推送到前端
4. **文件沙箱**：支持配置工作目录，所有文件操作限制在沙箱范围内
5. **热重载**：开发模式下使用 `electron-reload` 实现自动重载
6. **工具执行**：后端通过 agentic loop 自动执行工具调用，支持多轮工具调用直到任务完成

## Plan 文档组织规范

所有开发计划文档统一存放在 `docs/plans/` 目录，按照以下规则组织：

### 目录结构

```
docs/plans/
├── README.md                          # 组织规范说明
├── {主plan文件名}.md                  # 主计划文件（保留在根目录）
└── {主plan文件名}/                    # 以主plan命名的子文件夹
    ├── {子plan-1}.md                  # 子计划文件 1
    ├── {子plan-2}.md                  # 子计划文件 2
    └── ...                            # 其他子计划文件
```

### 命名规范

- **主 Plan 文件**：格式 `{日期}-{计划名称}-master.md`，位置在 `docs/plans/` 根目录
- **子 Plan 文件夹**：格式 `{主plan文件名}`（去掉 `.md` 后缀），位置在 `docs/plans/` 根目录下
- **子 Plan 文件**：格式 `{日期}-{功能名称}.md`，位置在对应的子文件夹内

### 组织原则

1. **主从关系**：每个主 plan 对应一个子文件夹，所有相关的子 plan 文件都放在该文件夹内
2. **清晰分离**：主 plan 文件保留在根目录，便于快速查找和导航
3. **引用更新**：主 plan 文件中的子 plan 引用路径需要指向子文件夹内的文件

### 创建新 Plan 的步骤

1. 在 `docs/plans/` 根目录创建主 plan 文件
2. 创建以主 plan 文件名（不含 `.md`）命名的文件夹
3. 在子文件夹内创建所有子 plan 文件
4. 在主 plan 文件中使用相对路径引用子 plan 文件，格式为 `{子文件夹名}/{子plan文件名}.md`

详细规范请参考 [docs/plans/README.md](docs/plans/README.md)

## 已知问题和待办

当前有 UX 升级计划位于 `docs/plans/2025-01-17-ux-upgrade-master.md`，包含六个子计划：

- #1 反馈基础能力（P0）
- #2 核心输入体验（P0）
- #3 生成控制与启动（P1）
- #4 开发者体验套件（P1）
- #5 历史管理增强（P2）
- #6 个性化与可访问性（P3）
