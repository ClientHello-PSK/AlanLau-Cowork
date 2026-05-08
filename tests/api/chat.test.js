/**
 * Comprehensive tests for /api/chat endpoint
 * Tests SSE streaming, session management, tool calls, and error handling
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import cors from 'cors';

// Mock OpenAI SDK
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn()
      }
    }
  }))
}));

// Mock skill-loader module
vi.mock('../../server/skill-loader.js', () => ({
  initSkillsDirectory: vi.fn(() => Promise.resolve({ success: true })),
  buildSkillsPrompt: vi.fn(() => Promise.resolve('')),
  seedExampleSkill: vi.fn(() => Promise.resolve())
}));

// Mock skills-api module
vi.mock('../../server/skills-api.js', () => {
  const router = express.Router();
  router.get('/', (req, res) => res.json({ skills: [] }));
  return { default: router };
});

/**
 * Helper: Create SSE event generator for testing
 */
function* createMockSSEEvents(events) {
  for (const event of events) {
    yield event;
  }
}

/**
 * Create a comprehensive test server matching real server behavior
 */
function createChatTestServer(options = {}) {
  const app = express();
  const chatSessions = new Map();
  const serverConfig = {
    apiEndpoint: 'https://api.anthropic.com',
    apiKey: 'test-api-key',
    maxTurns: 20,
    permissionMode: 'bypassPermissions',
    workspaceDir: options.workspaceDir || '',
    sandboxEnabled: options.sandboxEnabled !== false
  };

  app.use(cors());
  app.use(express.json());

  // Health check
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

  // Config endpoint - GET
  app.get('/api/config', (req, res) => {
    res.json({
      apiEndpoint: serverConfig.apiEndpoint,
      hasApiKey: !!serverConfig.apiKey,
      maxTurns: serverConfig.maxTurns,
      permissionMode: serverConfig.permissionMode,
      workspaceDir: serverConfig.workspaceDir,
      sandboxEnabled: serverConfig.sandboxEnabled
    });
  });

  // Config endpoint - POST
  app.post('/api/config', (req, res) => {
    const { apiEndpoint, apiKey, maxTurns, permissionMode, workspaceDir, sandboxEnabled } =
      req.body;

    if (apiEndpoint !== undefined) {
      serverConfig.apiEndpoint = apiEndpoint;
    }
    if (apiKey !== undefined) {
      serverConfig.apiKey = apiKey;
    }
    if (maxTurns !== undefined) {
      serverConfig.maxTurns = maxTurns;
    }
    if (permissionMode !== undefined) {
      serverConfig.permissionMode = permissionMode;
    }
    if (workspaceDir !== undefined) {
      serverConfig.workspaceDir = workspaceDir;
    }
    if (sandboxEnabled !== undefined) {
      serverConfig.sandboxEnabled = sandboxEnabled;
    }

    res.json({
      success: true,
      config: {
        apiEndpoint: serverConfig.apiEndpoint,
        hasApiKey: !!serverConfig.apiKey,
        maxTurns: serverConfig.maxTurns,
        permissionMode: serverConfig.permissionMode,
        workspaceDir: serverConfig.workspaceDir,
        sandboxEnabled: serverConfig.sandboxEnabled
      }
    });
  });

  // Chat endpoint with full SSE support
  app.post('/api/chat', async (req, res) => {
    const { message, chatId, userId = 'default-user' } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check workspace configuration when sandbox is enabled
    if (serverConfig.sandboxEnabled && !serverConfig.workspaceDir) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: '请先在设置中配置工作目录（Workspace Directory）'
        })}\n\n`
      );
      res.end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      // Check for existing session
      const existingSessionId = chatId ? chatSessions.get(chatId) : null;

      // Generate new session ID if needed
      const sessionId =
        existingSessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (chatId && !existingSessionId) {
        chatSessions.set(chatId, sessionId);
      }

      // Send session_init event
      res.write(`data: ${JSON.stringify({ type: 'session_init', session_id: sessionId })}\n\n`);

      // Simulate mock responses based on message content
      if (options.mockResponses) {
        for (const event of options.mockResponses) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } else {
        // Default mock response
        res.write(
          `data: ${JSON.stringify({ type: 'text', content: `Response to: ${message}` })}\n\n`
        );
      }

      // Send completion signal
      res.write('data: {"type": "done"}\n\n');
      res.end();
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    }
  });

  return { app, chatSessions, serverConfig };
}

describe('Chat API - Basic Functionality', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const { app } = createChatTestServer({ sandboxEnabled: false });
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should return 400 when message is missing', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Message is required');
  });

  it('should return 400 when message is empty string', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' })
    });

    expect(response.status).toBe(400);
  });

  it('should return SSE stream for valid request', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('should set correct SSE headers', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test' })
    });

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
  });
});

describe('Chat API - Session Management', () => {
  let server;
  let baseUrl;
  let chatSessions;

  beforeAll(async () => {
    const testServer = createChatTestServer({ sandboxEnabled: false });
    chatSessions = testServer.chatSessions;
    await new Promise(resolve => {
      server = testServer.app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should create new session for new chat', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello', chatId: 'new-chat-123' })
    });

    const text = await response.text();
    expect(text).toContain('session_init');
    expect(text).toContain('session_id');
  });

  it('should include session_id in session_init event', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test', chatId: 'chat-with-session' })
    });

    const text = await response.text();
    const lines = text.split('\n').filter(l => l.startsWith('data:'));
    const sessionInitLine = lines.find(l => l.includes('session_init'));

    expect(sessionInitLine).toBeDefined();
    const data = JSON.parse(sessionInitLine.slice(6));
    expect(data.type).toBe('session_init');
    expect(data.session_id).toBeDefined();
    expect(typeof data.session_id).toBe('string');
  });

  it('should handle chatId for session tracking', async () => {
    const chatId = 'track-session-chat';

    // First request
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'First message', chatId })
    });

    // Session should be stored
    expect(chatSessions.has(chatId)).toBe(true);
  });

  it('should work without chatId', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'No chatId' })
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('session_init');
  });
});

describe('Chat API - SSE Event Format', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const mockResponses = [
      { type: 'text', content: 'Hello ' },
      { type: 'text', content: 'World!' },
      { type: 'tool_use', name: 'Read', input: { path: '/test.txt' }, id: 'tool-1' },
      { type: 'tool_result', result: 'File content', tool_use_id: 'tool-1' }
    ];

    const { app } = createChatTestServer({
      sandboxEnabled: false,
      mockResponses
    });

    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should have valid SSE format for all events', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test' })
    });

    const text = await response.text();
    const lines = text.split('\n').filter(l => l.startsWith('data:'));

    // Each line should be valid JSON after "data: "
    lines.forEach(line => {
      const jsonStr = line.slice(6).trim();
      expect(() => JSON.parse(jsonStr)).not.toThrow();
    });
  });

  it('should end with done event', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test' })
    });

    const text = await response.text();
    const lines = text.split('\n').filter(l => l.startsWith('data:'));
    const lastLine = lines[lines.length - 1];
    const lastData = JSON.parse(lastLine.slice(6));

    expect(lastData.type).toBe('done');
  });

  it('should include text events', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test' })
    });

    const text = await response.text();
    expect(text).toContain('"type":"text"');
  });

  it('should include tool_use events', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test' })
    });

    const text = await response.text();
    expect(text).toContain('"type":"tool_use"');
    expect(text).toContain('"name":"Read"');
  });

  it('should include tool_result events', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test' })
    });

    const text = await response.text();
    expect(text).toContain('"type":"tool_result"');
    expect(text).toContain('"tool_use_id":"tool-1"');
  });
});

describe('Chat API - Sandbox Configuration', () => {
  it('should return error when sandbox enabled but no workspace', async () => {
    const { app } = createChatTestServer({
      sandboxEnabled: true,
      workspaceDir: ''
    });

    const server = await new Promise(resolve => {
      const s = app.listen(0, () => resolve(s));
    });

    try {
      const baseUrl = `http://localhost:${server.address().port}`;
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Test' })
      });

      const text = await response.text();
      expect(text).toContain('error');
      expect(text).toContain('工作目录');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should work when sandbox disabled', async () => {
    const { app } = createChatTestServer({
      sandboxEnabled: false
    });

    const server = await new Promise(resolve => {
      const s = app.listen(0, () => resolve(s));
    });

    try {
      const baseUrl = `http://localhost:${server.address().port}`;
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Test' })
      });

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('done');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should work when sandbox enabled with workspace', async () => {
    const { app } = createChatTestServer({
      sandboxEnabled: true,
      workspaceDir: '/test/workspace'
    });

    const server = await new Promise(resolve => {
      const s = app.listen(0, () => resolve(s));
    });

    try {
      const baseUrl = `http://localhost:${server.address().port}`;
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Test' })
      });

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('done');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

describe('Chat API - Config Endpoints', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const { app } = createChatTestServer({ sandboxEnabled: false });
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('GET /api/config should return current config', async () => {
    const response = await fetch(`${baseUrl}/api/config`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.apiEndpoint).toBeDefined();
    expect(data.hasApiKey).toBeDefined();
    expect(data.maxTurns).toBeDefined();
    expect(data.permissionMode).toBeDefined();
    expect(data.sandboxEnabled).toBeDefined();
  });

  it('POST /api/config should update config', async () => {
    const newConfig = {
      apiEndpoint: 'https://new-api.example.com',
      maxTurns: 30,
      sandboxEnabled: true,
      workspaceDir: '/new/workspace'
    };

    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config.apiEndpoint).toBe('https://new-api.example.com');
    expect(data.config.maxTurns).toBe(30);
    expect(data.config.sandboxEnabled).toBe(true);
    expect(data.config.workspaceDir).toBe('/new/workspace');
  });

  it('POST /api/config should handle partial updates', async () => {
    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxTurns: 50 })
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config.maxTurns).toBe(50);
  });
});

describe('Chat API - Health Check', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const { app } = createChatTestServer({ sandboxEnabled: false });
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should return health status with config info', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
    expect(data.config).toBeDefined();
    expect(data.config.hasApiKey).toBeDefined();
    expect(data.config.apiEndpoint).toBeDefined();
  });

  it('should return valid ISO timestamp', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const data = await response.json();

    const timestamp = new Date(data.timestamp);
    expect(timestamp.toString()).not.toBe('Invalid Date');
  });
});

describe('Chat API - Input Validation', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const { app } = createChatTestServer({ sandboxEnabled: false });
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should handle special characters in message', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '你好！<script>alert("xss")</script> & more'
      })
    });

    expect(response.status).toBe(200);
  });

  it('should handle very long messages', async () => {
    const longMessage = 'a'.repeat(50000);
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: longMessage })
    });

    expect(response.status).toBe(200);
  });

  it('should handle unicode characters', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '🎉 Emoji test 你好世界 مرحبا العالم'
      })
    });

    expect(response.status).toBe(200);
  });

  it('should handle multiline messages', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Line 1\nLine 2\nLine 3\n\nLine 5'
      })
    });

    expect(response.status).toBe(200);
  });

  it('should handle JSON in message', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Parse this: {"key": "value", "array": [1,2,3]}'
      })
    });

    expect(response.status).toBe(200);
  });

  it('should handle code blocks in message', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '```javascript\nconst x = 1;\nconsole.log(x);\n```'
      })
    });

    expect(response.status).toBe(200);
  });
});

describe('Chat API - Concurrent Requests', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const { app } = createChatTestServer({ sandboxEnabled: false });
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should handle multiple concurrent requests', async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Request ${i}`,
          chatId: `concurrent-${i}`
        })
      })
    );

    const responses = await Promise.all(requests);

    responses.forEach(response => {
      expect(response.status).toBe(200);
    });
  });

  it('should maintain separate sessions for concurrent chats', async () => {
    const chatIds = ['chat-a', 'chat-b', 'chat-c'];

    const responses = await Promise.all(
      chatIds.map(chatId =>
        fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Test', chatId })
        }).then(r => r.text())
      )
    );

    // Each response should have its own session_id
    const sessionIds = responses.map(text => {
      const line = text.split('\n').find(l => l.includes('session_init'));
      if (line) {
        const data = JSON.parse(line.slice(6));
        return data.session_id;
      }
      return null;
    });

    // All session IDs should be unique
    const uniqueIds = new Set(sessionIds.filter(Boolean));
    expect(uniqueIds.size).toBe(chatIds.length);
  });
});
