/**
 * Integration tests for full application flow
 * Tests end-to-end scenarios between frontend and backend
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

/**
 * Create a full-featured test server that mimics the real backend
 */
function createIntegrationTestServer() {
  const app = express();
  const chatSessions = new Map();
  const chatHistory = new Map();

  const serverConfig = {
    apiEndpoint: 'https://api.anthropic.com',
    apiKey: 'test-api-key',
    maxTurns: 20,
    permissionMode: 'bypassPermissions',
    workspaceDir: '/test/workspace',
    sandboxEnabled: true
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

  // Config endpoints
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

  app.post('/api/config', (req, res) => {
    Object.entries(req.body).forEach(([key, value]) => {
      if (key in serverConfig && value !== undefined) {
        serverConfig[key] = value;
      }
    });

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

  // Chat endpoint with session management
  app.post('/api/chat', async (req, res) => {
    const { message, chatId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Session management
    let sessionId = chatId ? chatSessions.get(chatId) : null;

    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      if (chatId) {
        chatSessions.set(chatId, sessionId);
      }
    }

    // Store message in history
    if (chatId) {
      if (!chatHistory.has(chatId)) {
        chatHistory.set(chatId, []);
      }
      chatHistory.get(chatId).push({ role: 'user', content: message });
    }

    // Send SSE events
    res.write(`data: ${JSON.stringify({ type: 'session_init', session_id: sessionId })}\n\n`);

    // Simulate AI response
    const responseText = `I received your message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`;

    // Simulate streaming text
    const words = responseText.split(' ');
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join(' ') + ' ';
      res.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
    }

    // Store assistant response
    if (chatId && chatHistory.has(chatId)) {
      chatHistory.get(chatId).push({ role: 'assistant', content: responseText });
    }

    res.write('data: {"type": "done"}\n\n');
    res.end();
  });

  // Skills endpoints
  app.get('/api/skills', (req, res) => {
    res.json({
      success: true,
      skills: [
        { name: 'code-review', source: 'local', enabled: true, description: 'Review code' },
        { name: 'debugging', source: 'local', enabled: false, description: 'Debug issues' }
      ]
    });
  });

  app.post('/api/skills/toggle', (req, res) => {
    const { name, enabled } = req.body;

    if (!name || typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Invalid request' });
    }

    res.json({ success: true, message: `Skill "${name}" ${enabled ? 'enabled' : 'disabled'}` });
  });

  return { app, chatSessions, chatHistory, serverConfig };
}

describe('Integration - Full Chat Flow', () => {
  let server;
  let baseUrl;
  let chatSessions;
  let chatHistory;

  beforeAll(async () => {
    const testServer = createIntegrationTestServer();
    chatSessions = testServer.chatSessions;
    chatHistory = testServer.chatHistory;

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

  it('should complete a full conversation flow', async () => {
    const chatId = 'full-flow-chat-1';

    // Step 1: Check server health
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    expect(healthResponse.status).toBe(200);

    // Step 2: Send first message
    const firstMessage = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello, how are you?', chatId })
    });

    expect(firstMessage.status).toBe(200);
    const firstText = await firstMessage.text();
    expect(firstText).toContain('session_init');
    expect(firstText).toContain('text');
    expect(firstText).toContain('done');

    // Step 3: Send follow-up message (session should persist)
    const secondMessage = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What is 2+2?', chatId })
    });

    expect(secondMessage.status).toBe(200);

    // Step 4: Verify session persistence
    expect(chatSessions.has(chatId)).toBe(true);

    // Step 5: Verify chat history
    expect(chatHistory.has(chatId)).toBe(true);
    const history = chatHistory.get(chatId);
    expect(history.length).toBe(4); // 2 user + 2 assistant messages
  });

  it('should maintain separate sessions for different chats', async () => {
    const chat1 = 'separate-chat-1';
    const chat2 = 'separate-chat-2';

    // Send message to first chat
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Message for chat 1', chatId: chat1 })
    });

    // Send message to second chat
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Message for chat 2', chatId: chat2 })
    });

    // Verify sessions are different
    const session1 = chatSessions.get(chat1);
    const session2 = chatSessions.get(chat2);

    expect(session1).not.toBe(session2);
  });
});

describe('Integration - Settings Flow', () => {
  let server;
  let baseUrl;
  let serverConfig;

  beforeAll(async () => {
    const testServer = createIntegrationTestServer();
    serverConfig = testServer.serverConfig;

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

  it('should read and update configuration', async () => {
    // Step 1: Get current config
    const getResponse = await fetch(`${baseUrl}/api/config`);
    const initialConfig = await getResponse.json();

    expect(initialConfig.maxTurns).toBeDefined();
    const originalMaxTurns = initialConfig.maxTurns;

    // Step 2: Update config
    const updateResponse = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxTurns: 50 })
    });

    const updateResult = await updateResponse.json();
    expect(updateResult.success).toBe(true);
    expect(updateResult.config.maxTurns).toBe(50);

    // Step 3: Verify persistence
    const verifyResponse = await fetch(`${baseUrl}/api/config`);
    const verifiedConfig = await verifyResponse.json();
    expect(verifiedConfig.maxTurns).toBe(50);

    // Cleanup: restore original
    await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxTurns: originalMaxTurns })
    });
  });

  it('should configure workspace sandbox', async () => {
    // Step 1: Disable sandbox
    const disableResponse = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandboxEnabled: false })
    });

    const disableResult = await disableResponse.json();
    expect(disableResult.config.sandboxEnabled).toBe(false);

    // Step 2: Enable sandbox with workspace
    const enableResponse = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sandboxEnabled: true,
        workspaceDir: '/new/workspace'
      })
    });

    const enableResult = await enableResponse.json();
    expect(enableResult.config.sandboxEnabled).toBe(true);
    expect(enableResult.config.workspaceDir).toBe('/new/workspace');
  });
});

describe('Integration - Skills Flow', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const testServer = createIntegrationTestServer();

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

  it('should list and toggle skills', async () => {
    // Step 1: List skills
    const listResponse = await fetch(`${baseUrl}/api/skills`);
    const listResult = await listResponse.json();

    expect(listResult.success).toBe(true);
    expect(Array.isArray(listResult.skills)).toBe(true);

    // Step 2: Find a disabled skill
    const disabledSkill = listResult.skills.find(s => !s.enabled);

    if (disabledSkill) {
      // Step 3: Enable it
      const toggleResponse = await fetch(`${baseUrl}/api/skills/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: disabledSkill.name, enabled: true })
      });

      const toggleResult = await toggleResponse.json();
      expect(toggleResult.success).toBe(true);
      expect(toggleResult.message).toContain('enabled');
    }
  });
});

describe('Integration - Error Recovery', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const testServer = createIntegrationTestServer();

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

  it('should handle invalid requests gracefully', async () => {
    // Missing message
    const invalidChat = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(invalidChat.status).toBe(400);

    // Invalid skill toggle
    const invalidToggle = await fetch(`${baseUrl}/api/skills/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }) // missing enabled
    });

    expect(invalidToggle.status).toBe(400);
  });

  it('should continue working after error', async () => {
    // Cause an error
    await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    // Verify server still works
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    expect(healthResponse.status).toBe(200);

    // Valid request should work
    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test after error' })
    });

    expect(chatResponse.status).toBe(200);
  });
});

describe('Integration - Concurrent Operations', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const testServer = createIntegrationTestServer();

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

  it('should handle concurrent chat requests', async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Concurrent message ${i}`,
          chatId: `concurrent-${i}`
        })
      })
    );

    const responses = await Promise.all(requests);

    // All requests should succeed
    responses.forEach(response => {
      expect(response.status).toBe(200);
    });
  });

  it('should handle mixed concurrent operations', async () => {
    const operations = [
      fetch(`${baseUrl}/api/health`),
      fetch(`${baseUrl}/api/config`),
      fetch(`${baseUrl}/api/skills`),
      fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Test' })
      })
    ];

    const responses = await Promise.all(operations);

    // All should succeed
    responses.forEach(response => {
      expect(response.status).toBe(200);
    });
  });
});

describe('Integration - State Persistence', () => {
  let server;
  let baseUrl;
  let chatHistory;

  beforeAll(async () => {
    const testServer = createIntegrationTestServer();
    chatHistory = testServer.chatHistory;

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

  it('should accumulate chat history', async () => {
    const chatId = 'history-test-chat';

    // Send multiple messages
    for (let i = 1; i <= 3; i++) {
      await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Message ${i}`, chatId })
      });
    }

    // Check history length
    const history = chatHistory.get(chatId);
    expect(history).toBeDefined();
    expect(history.length).toBe(6); // 3 user + 3 assistant messages
  });

  it('should preserve message order in history', async () => {
    const chatId = 'order-test-chat';

    // Send messages in order
    for (let i = 1; i <= 3; i++) {
      await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Order ${i}`, chatId })
      });
    }

    const history = chatHistory.get(chatId);

    // Verify order
    expect(history[0].role).toBe('user');
    expect(history[0].content).toContain('Order 1');
    expect(history[1].role).toBe('assistant');
    expect(history[2].role).toBe('user');
    expect(history[2].content).toContain('Order 2');
  });
});
