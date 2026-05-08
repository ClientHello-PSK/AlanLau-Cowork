<p align="center">
  <h1 align="center">GTS Cowork</h1>
</p>

<p align="center">
  An open-source desktop AI assistant powered by DeepSeek API with built-in tool execution, file sandboxing, and real-time streaming.
</p>

---

## Features

- **DeepSeek API Integration** - Full agentic capabilities with multi-turn conversations and tool use
- **Built-in Tool Executor** - 8 tools including file read/write/edit, Bash execution, glob/grep search, web fetch, and todo tracking
- **File Sandboxing** - Configurable workspace directory with path validation for safe file operations
- **Persistent Chat Sessions** - Server-side conversation history with automatic context trimming
- **Multi-Chat Support** - Create and switch between multiple chat sessions
- **Real-time Streaming** - Server-Sent Events (SSE) for smooth, token-by-token response streaming
- **Extended Thinking** - Support for DeepSeek reasoning mode with collapsible thinking display
- **Tool Call Visualization** - See tool inputs and outputs in real-time in the sidebar
- **Skills System** - Extensible skills with local and Claude Code plugin compatibility
- **Modern UI** - Clean, dark/light themed interface with resizable panels

---

## Tech Stack

| Category              | Technology                      |
| --------------------- | ------------------------------- |
| **Desktop Framework** | Electron.js                     |
| **Backend**           | Node.js + Express (ES modules)  |
| **AI API**            | DeepSeek API (via OpenAI SDK)   |
| **Tool Execution**    | Custom Tool Executor (tools.js) |
| **Streaming**         | Server-Sent Events (SSE)        |
| **Markdown**          | Marked.js                       |
| **Styling**           | Vanilla CSS (modular)           |

---

## Getting Started

### Prerequisites

- Node.js 18+ installed
- DeepSeek API key ([platform.deepseek.com](https://platform.deepseek.com))

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd ClientHello-Cowork

# Install dependencies
npm install
cd server && npm install && cd ..
```

### Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your API key:

```env
DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

### Starting the Application

**Windows (recommended):**

```bash
start.bat         # Auto-install deps and start services
start-dev.bat     # Development mode with hot reload
stop.bat          # Stop all services
```

**Manual start (two terminals):**

```bash
# Terminal 1 - Backend Server
cd server && npm start

# Terminal 2 - Electron App
npm start
```

---

## Architecture

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

### Session Management

Server-side session management using in-memory message history:

1. First message creates a session for the given `chatId`
2. Subsequent messages append to the existing session
3. Messages are automatically trimmed when exceeding 800K characters
4. Sessions expire after 1 hour of inactivity

### Tool Execution

Built-in agentic loop with 8 tools:

| Tool      | Description                        |
| --------- | ---------------------------------- |
| Read      | Read file contents                 |
| Write     | Write/create files                 |
| Edit      | String replacement in files        |
| Bash      | Execute shell commands             |
| Glob      | Find files by pattern              |
| Grep      | Search file contents by regex      |
| WebFetch  | Fetch web page content             |
| TodoWrite | Update task progress display       |

---

## File Structure

```
ClientHello-Cowork/
├── main.js                 # Electron main process
├── preload.js              # IPC security bridge
├── renderer/
│   ├── index.html          # Chat interface
│   ├── renderer.js         # Frontend logic entry
│   ├── utils.js            # Utility functions
│   ├── uiHelpers.js        # UI helper functions
│   ├── chatStore.js        # Chat data operations
│   ├── sessionManager.js   # Tool call data utilities
│   ├── modules/            # Feature modules
│   │   ├── chatManager.js  # Chat state management
│   │   ├── chatHistory.js  # Chat history rendering
│   │   ├── streamHandler.js # SSE stream processing
│   │   ├── messageHandler.js # Message DOM operations
│   │   ├── toolCalls.js    # Tool call UI
│   │   ├── fileHandler.js  # File attachment handling
│   │   ├── generationControl.js # Generation state
│   │   ├── markdownRenderer.js  # Markdown rendering
│   │   ├── feedback.js     # Toast/error feedback
│   │   ├── settings.js     # Settings management
│   │   ├── skillsManager.js # Skills UI
│   │   ├── theme.js        # Theme switching
│   │   └── logger.js       # Debug logging
│   └── styles/             # Modular CSS files
├── server/
│   ├── server.js           # Express + DeepSeek API + SSE
│   ├── tools.js            # Tool definitions & executor
│   ├── skill-loader.js     # Skills management
│   ├── skills-api.js       # Skills REST API
│   └── package.json
├── tests/                  # Unit, API, E2E tests
├── start.bat               # Windows startup script
├── start-dev.bat           # Windows dev startup
├── stop.bat                # Windows stop script
├── reinstall.bat           # Windows dependency reinstall
├── package.json
├── .env.example            # Environment template
└── CLAUDE.md               # AI assistant instructions
```

---

## Available Scripts

| Command                  | Description                                |
| ------------------------ | ------------------------------------------ |
| `npm start`              | Start backend + Electron app               |
| `npm run dev`            | Start in development mode with live reload |
| `npm test`               | Run unit tests (Vitest)                    |
| `npm run test:all`       | Run all tests including E2E                |
| `npm run lint`           | Check code style                           |
| `npm run lint:fix`       | Auto-fix code style issues                 |

---

## Troubleshooting

**"Failed to connect to backend"**

- Ensure backend server is running on port 3001
- Check server terminal for error logs

**"API key error"**

- Verify `DEEPSEEK_API_KEY` in `.env` is valid
- Ensure `DEEPSEEK_BASE_URL` is correct

**"Session not persisting"**

- Check server logs for session creation
- Ensure `chatId` is being passed from frontend

---

## License

ISC
