import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { toolDefinitions, executeTool } from './tools.js';

// Skills 模块
import { initSkillsDirectory, buildSkillsPrompt, seedExampleSkill } from './skill-loader.js';
import skillsRouter from './skills-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Config file path for persistence
const CONFIG_FILE = path.join(__dirname, 'workspace-config.json');

// Load persisted config or use defaults
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return { ...getDefaultConfig(), ...saved };
    }
  } catch (err) {
    console.warn('[CONFIG] Failed to load saved config:', err.message);
  }
  return getDefaultConfig();
}

function getDefaultConfig() {
  return {
    apiEndpoint: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    defaultModel: 'deepseek-v4-flash',
    maxTurns: 20,
    permissionMode: 'bypassPermissions',
    // Workspace sandbox settings
    workspaceDir: process.env.WORKSPACE_DIR || '',
    sandboxEnabled: process.env.SANDBOX_ENABLED !== 'false'
  };
}

function saveConfig() {
  try {
    const toSave = {
      workspaceDir: serverConfig.workspaceDir,
      sandboxEnabled: serverConfig.sandboxEnabled,
      maxTurns: serverConfig.maxTurns
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2));
    console.log('[CONFIG] Saved to', CONFIG_FILE);
  } catch (err) {
    console.warn('[CONFIG] Failed to save config:', err.message);
  }
}

// In-memory config
const serverConfig = loadConfig();

// ============================================
// File Sandbox Utilities
// ============================================

function isAbsolutePath(p) {
  if (!p) return false;
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')) return true;
  if (p.startsWith('/')) return true;
  return false;
}

function resolveInWorkspace(targetPath, workspaceDir) {
  if (!workspaceDir) return null;
  return isAbsolutePath(targetPath) ? path.resolve(targetPath) : path.resolve(workspaceDir, targetPath);
}

function isPathInWorkspace(resolvedPath, workspaceDir) {
  if (!workspaceDir || !resolvedPath) return false;
  const normalizedWorkspace = path.resolve(workspaceDir).toLowerCase();
  const normalizedPath = resolvedPath.toLowerCase();
  return (
    normalizedPath === normalizedWorkspace ||
    normalizedPath.startsWith(normalizedWorkspace + path.sep)
  );
}

function validateFilePath(targetPath, workspaceDir) {
  if (!workspaceDir) {
    return { allowed: false, reason: '工作目录未设置，请先在设置中配置工作目录' };
  }
  const resolved = resolveInWorkspace(targetPath, workspaceDir);
  if (!isPathInWorkspace(resolved, workspaceDir)) {
    return {
      allowed: false,
      reason: `路径 "${targetPath}" 超出工作目录范围 (${workspaceDir})`
    };
  }
  return { allowed: true };
}

// ============================================
// Session Management
// ============================================

// chatId -> { messages: [], lastAccess: number }
const chatSessions = new Map();

const SESSION_TTL = 60 * 60 * 1000; // 1 hour

function trimMessages(messages, maxChars = 800000) {
  let total = messages.reduce((sum, m) => sum + JSON.stringify(m).length, 0);
  while (total > maxChars && messages.length > 2) {
    messages.splice(1, 2); // 移除最早的一对 user/assistant
    total = messages.reduce((sum, m) => sum + JSON.stringify(m).length, 0);
  }
}

// Periodic session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [chatId, session] of chatSessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      chatSessions.delete(chatId);
    }
  }
}, 60 * 60 * 1000);

// ============================================
// Middleware
// ============================================

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Skills API 路由
app.use('/api/skills', skillsRouter);

// ============================================
// SSE helper
// ============================================

function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ============================================
// Chat endpoint using DeepSeek API
// ============================================

app.post('/api/chat', async (req, res) => {
  const { message, chatId, userId = 'default-user', files, model, thinkingMode } = req.body;

  console.log('[CHAT] Request received:', message);
  console.log('[CHAT] Chat ID:', chatId);
  console.log('[CHAT] Model:', model || serverConfig.defaultModel);
  console.log('[CHAT] Files attached:', files?.length || 0);

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    // Check workspace configuration
    if (serverConfig.sandboxEnabled && !serverConfig.workspaceDir) {
      sseWrite(res, {
        type: 'error',
        message: '请先在设置中配置工作目录（Workspace Directory）'
      });
      res.end();
      return;
    }

    // Build enhanced prompt with file attachments
    let enhancedPrompt = message;

    if (files && files.length > 0) {
      const tempDir = path.join(__dirname, '.temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileContents = files.map(file => {
        if (file.type?.startsWith('image/')) {
          const base64Data = file.data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const ext = file.type.split('/')[1] || 'png';
          const filename = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
          const filePath = path.join(tempDir, filename);
          fs.writeFileSync(filePath, buffer);
          console.log('[CHAT] Image saved to:', filePath);
          return `[Image: ${file.name}]\n文件路径: ${filePath}`;
        } else {
          return `[File: ${file.name}]\n\`\`\`\n${file.data}\n\`\`\``;
        }
      }).join('\n\n');

      enhancedPrompt = `${message}\n\n---\n**附件内容：**\n\n${fileContents}`;
    }

    // Inject skills context
    try {
      const skillsContext = await buildSkillsPrompt();
      if (skillsContext) {
        enhancedPrompt = `<available_skills>\n${skillsContext}\n</available_skills>\n\n${enhancedPrompt}`;
        console.log('[SKILLS] Injected skills context');
      }
    } catch (skillError) {
      console.warn('[SKILLS] Failed to build skills prompt:', skillError.message);
    }

    // Load or create session
    let session = chatSessions.get(chatId);
    if (!session) {
      session = { messages: [], lastAccess: Date.now() };
      chatSessions.set(chatId, session);
    }
    session.lastAccess = Date.now();

    // Append user message
    session.messages.push({ role: 'user', content: enhancedPrompt });

    // Trim if too long
    trimMessages(session.messages);

    // Create OpenAI client
    const client = new OpenAI({
      apiKey: serverConfig.apiKey,
      baseURL: serverConfig.apiEndpoint || 'https://api.deepseek.com'
    });

    const selectedModel = model || serverConfig.defaultModel || 'deepseek-v4-flash';
    const maxTurns = serverConfig.maxTurns;
    const sandboxConfig = {
      workspaceDir: serverConfig.workspaceDir,
      sandboxEnabled: serverConfig.sandboxEnabled,
      validateFilePath
    };

    // Agentic loop
    let turnCount = 0;

    while (turnCount < maxTurns) {
      turnCount++;
      console.log(`[CHAT] Turn ${turnCount}/${maxTurns}`);

      // Build request options
      const requestOptions = {
        model: selectedModel,
        messages: session.messages,
        tools: toolDefinitions,
        stream: true,
        max_tokens: 16384
      };

      // Enable thinking mode
      if (thinkingMode === 'extended') {
        requestOptions.thinking = { type: 'enabled' };
        requestOptions.reasoning_effort = 'high';
      }

      // Call DeepSeek API with streaming
      const stream = await client.chat.completions.create(requestOptions);

      let assistantContent = '';
      let reasoningContent = '';
      let toolCalls = [];
      let hasReasoning = false;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const finishReason = chunk.choices[0]?.finish_reason;

        // Handle reasoning content
        if (delta?.reasoning_content) {
          if (!hasReasoning) {
            hasReasoning = true;
          }
          reasoningContent += delta.reasoning_content;
          sseWrite(res, { type: 'reasoning', content: delta.reasoning_content });
        }

        // Handle text content
        if (delta?.content) {
          assistantContent += delta.content;
          sseWrite(res, { type: 'text', content: delta.content });
        }

        // Handle tool call deltas
        if (delta?.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tcDelta.id || '', function: { name: '', arguments: '' } };
            }
            if (tcDelta.id) toolCalls[idx].id = tcDelta.id;
            if (tcDelta.function?.name) toolCalls[idx].function.name += tcDelta.function.name;
            if (tcDelta.function?.arguments) {
              toolCalls[idx].function.arguments += tcDelta.function.arguments;
            }
          }
        }

        if (finishReason === 'stop' || finishReason === 'length') {
          break;
        }
      }

      // Filter out incomplete tool calls
      const completedToolCalls = toolCalls.filter(tc => tc && tc.id && tc.function.name);

      if (completedToolCalls.length === 0) {
        // No tool calls, save assistant message and finish
        if (assistantContent || reasoningContent) {
          session.messages.push({ role: 'assistant', content: assistantContent || null });
        }
        break;
      }

      // Build assistant message with tool calls for history
      const assistantMessage = {
        role: 'assistant',
        content: assistantContent || null,
        tool_calls: completedToolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        }))
      };
      session.messages.push(assistantMessage);

      // Execute each tool call
      for (const toolCall of completedToolCalls) {
        const toolName = toolCall.function.name;
        let toolInput;
        try {
          toolInput = JSON.parse(toolCall.function.arguments);
        } catch {
          toolInput = {};
        }

        console.log('[CHAT] Tool use:', toolName);

        // Emit tool_use SSE event
        sseWrite(res, {
          type: 'tool_use',
          name: toolName,
          input: toolInput,
          id: toolCall.id
        });

        // Execute the tool
        const toolResult = await executeTool(toolName, toolInput, sandboxConfig);
        const resultStr = typeof toolResult === 'object' ? JSON.stringify(toolResult) : String(toolResult);

        // Emit tool_result SSE event
        sseWrite(res, {
          type: 'tool_result',
          result: resultStr,
          tool_use_id: toolCall.id
        });

        // Add tool result to messages
        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultStr
        });
      }

      // Trim messages after tool execution round
      trimMessages(session.messages);
    }

    if (turnCount >= maxTurns) {
      console.log('[CHAT] Reached max turns limit:', maxTurns);
    }

    // Save session
    chatSessions.set(chatId, session);

    // Send completion signal
    sseWrite(res, { type: 'done' });
    res.end();
    console.log('[CHAT] Stream completed');
  } catch (error) {
    console.error('[CHAT] Error:', error);
    sseWrite(res, { type: 'error', message: error.message });
    res.end();
  }
});

// ============================================
// Other endpoints
// ============================================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: {
      hasApiKey: !!serverConfig.apiKey,
      apiEndpoint: serverConfig.apiEndpoint
    }
  });
});

// Config endpoint - get current config
app.get('/api/config', (req, res) => {
  res.json({
    apiEndpoint: serverConfig.apiEndpoint,
    hasApiKey: !!serverConfig.apiKey,
    defaultModel: serverConfig.defaultModel,
    maxTurns: serverConfig.maxTurns,
    permissionMode: serverConfig.permissionMode,
    workspaceDir: serverConfig.workspaceDir,
    sandboxEnabled: serverConfig.sandboxEnabled
  });
});

// Config endpoint - update config
app.post('/api/config', (req, res) => {
  const { apiEndpoint, apiKey, defaultModel, maxTurns, permissionMode, workspaceDir, sandboxEnabled } = req.body;

  if (apiEndpoint !== undefined) serverConfig.apiEndpoint = apiEndpoint;
  if (apiKey !== undefined) serverConfig.apiKey = apiKey;
  if (defaultModel !== undefined) serverConfig.defaultModel = defaultModel;
  if (maxTurns !== undefined) serverConfig.maxTurns = maxTurns;
  if (permissionMode !== undefined) serverConfig.permissionMode = permissionMode;
  if (workspaceDir !== undefined) {
    serverConfig.workspaceDir = workspaceDir ? path.resolve(workspaceDir) : '';
  }
  if (sandboxEnabled !== undefined) serverConfig.sandboxEnabled = sandboxEnabled;

  saveConfig();

  console.log('[CONFIG] Config updated:', {
    apiEndpoint: serverConfig.apiEndpoint,
    hasApiKey: !!serverConfig.apiKey,
    defaultModel: serverConfig.defaultModel,
    maxTurns: serverConfig.maxTurns,
    workspaceDir: serverConfig.workspaceDir,
    sandboxEnabled: serverConfig.sandboxEnabled
  });

  res.json({
    success: true,
    config: {
      apiEndpoint: serverConfig.apiEndpoint,
      hasApiKey: !!serverConfig.apiKey,
      defaultModel: serverConfig.defaultModel,
      maxTurns: serverConfig.maxTurns,
      permissionMode: serverConfig.permissionMode,
      workspaceDir: serverConfig.workspaceDir,
      sandboxEnabled: serverConfig.sandboxEnabled
    }
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`\n✓ Backend server running on http://localhost:${PORT}`);
  console.log(`✓ Chat endpoint: POST http://localhost:${PORT}/api/chat`);
  console.log(`✓ Health check: GET http://localhost:${PORT}/api/health`);
  console.log('✓ Skills API: /api/skills/*');

  // 初始化技能目录
  const skillsInit = await initSkillsDirectory();
  if (skillsInit.success) {
    console.log('✓ Skills directory initialized');
    await seedExampleSkill();
  } else {
    console.log('⚠ Skills directory init failed:', skillsInit.error);
  }

  // Display sandbox status
  if (serverConfig.sandboxEnabled) {
    if (serverConfig.workspaceDir) {
      console.log(`✓ Sandbox enabled - Workspace: ${serverConfig.workspaceDir}`);
    } else {
      console.log('⚠ Sandbox enabled but no workspace directory set');
    }
  } else {
    console.log('⚠ Sandbox disabled - File access unrestricted');
  }

  // Display API config
  console.log(`✓ API endpoint: ${serverConfig.apiEndpoint}`);
  console.log(`✓ Model: ${serverConfig.defaultModel}`);
  console.log(`✓ API key: ${serverConfig.apiKey ? 'configured' : 'NOT SET'}`);
  console.log('');
});
