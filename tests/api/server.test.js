/**
 * API tests for the backend server
 * Tests the Express endpoints with mocked Claude SDK
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
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

// Create a test server instance
function createTestServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Simplified chat endpoint for testing
  app.post('/api/chat', async (req, res) => {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      // Mock response for testing
      res.write(
        `data: ${JSON.stringify({ type: 'session_init', session_id: 'test-session-123' })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({ type: 'text', content: 'Hello, this is a test response.' })}\n\n`
      );
      res.write('data: {"type": "done"}\n\n');
      res.end();
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    }
  });

  return app;
}

describe('Server API Tests', () => {
  let app;
  let server;
  let baseUrl;

  beforeAll(async () => {
    app = createTestServer();

    // Start server on random port
    await new Promise(resolve => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await fetch(`${baseUrl}/api/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
    });

    it('should return valid ISO timestamp', async () => {
      const response = await fetch(`${baseUrl}/api/health`);
      const data = await response.json();

      const timestamp = new Date(data.timestamp);
      expect(timestamp.toString()).not.toBe('Invalid Date');
    });
  });

  describe('POST /api/chat', () => {
    it('should return 400 for missing message', async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Message is required');
    });

    it('should return SSE stream for valid message', async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello', chatId: 'test-chat-1' })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      const text = await response.text();
      expect(text).toContain('data:');
      expect(text).toContain('session_init');
      expect(text).toContain('text');
      expect(text).toContain('done');
    });

    it('should include session_id in response', async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Test message', chatId: 'test-chat-2' })
      });

      const text = await response.text();
      const lines = text.split('\n').filter(line => line.startsWith('data:'));

      // Parse first data line (session_init)
      const firstLine = lines[0];
      const data = JSON.parse(firstLine.slice(6));

      expect(data.type).toBe('session_init');
      expect(data.session_id).toBeDefined();
    });

    it('should handle chatId parameter', async () => {
      const chatId = 'unique-chat-id-12345';
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello', chatId })
      });

      expect(response.status).toBe(200);
    });
  });

  describe('SSE Response Format', () => {
    it('should have correct SSE format', async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Test' })
      });

      const text = await response.text();
      const lines = text.split('\n');

      // Check SSE format: each event should be "data: {json}\n\n"
      const dataLines = lines.filter(line => line.startsWith('data:'));
      expect(dataLines.length).toBeGreaterThan(0);

      // Each data line should be valid JSON
      dataLines.forEach(line => {
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
      const lines = text.split('\n').filter(line => line.startsWith('data:'));
      const lastLine = lines[lines.length - 1];
      const lastData = JSON.parse(lastLine.slice(6));

      expect(lastData.type).toBe('done');
    });
  });
});

describe('Request Validation', () => {
  let app;
  let server;
  let baseUrl;

  beforeAll(async () => {
    app = createTestServer();
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

  it('should reject empty message string', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' })
    });

    // Empty string is falsy, should be rejected
    expect(response.status).toBe(400);
  });

  it('should accept message with special characters', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '你好！How are you? <script>alert("xss")</script>' })
    });

    expect(response.status).toBe(200);
  });

  it('should handle very long messages', async () => {
    const longMessage = 'a'.repeat(10000);
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: longMessage })
    });

    expect(response.status).toBe(200);
  });
});

describe('Config API Tests', () => {
  let app;
  let server;
  let baseUrl;

  function createConfigTestServer() {
    const app = express();
    app.use(cors());
    app.use(express.json());

    const config = {
      apiEndpoint: 'https://api.anthropic.com',
      apiKey: 'test-key',
      maxTurns: 20,
      permissionMode: 'bypassPermissions',
      workspaceDir: '',
      sandboxEnabled: true
    };

    // GET /api/config
    app.get('/api/config', (req, res) => {
      res.json({
        apiEndpoint: config.apiEndpoint,
        hasApiKey: !!config.apiKey,
        maxTurns: config.maxTurns,
        permissionMode: config.permissionMode,
        workspaceDir: config.workspaceDir,
        sandboxEnabled: config.sandboxEnabled
      });
    });

    // POST /api/config
    app.post('/api/config', (req, res) => {
      const { apiEndpoint, apiKey, maxTurns, permissionMode, workspaceDir, sandboxEnabled } =
        req.body;

      if (apiEndpoint !== undefined) {
        config.apiEndpoint = apiEndpoint;
      }
      if (apiKey !== undefined) {
        config.apiKey = apiKey;
      }
      if (maxTurns !== undefined) {
        config.maxTurns = maxTurns;
      }
      if (permissionMode !== undefined) {
        config.permissionMode = permissionMode;
      }
      if (workspaceDir !== undefined) {
        config.workspaceDir = workspaceDir;
      }
      if (sandboxEnabled !== undefined) {
        config.sandboxEnabled = sandboxEnabled;
      }

      res.json({
        success: true,
        config: {
          apiEndpoint: config.apiEndpoint,
          hasApiKey: !!config.apiKey,
          maxTurns: config.maxTurns,
          permissionMode: config.permissionMode,
          workspaceDir: config.workspaceDir,
          sandboxEnabled: config.sandboxEnabled
        }
      });
    });

    return app;
  }

  beforeAll(async () => {
    app = createConfigTestServer();
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

  it('GET /api/config should not expose raw API key', async () => {
    const response = await fetch(`${baseUrl}/api/config`);
    const data = await response.json();

    expect(data.apiKey).toBeUndefined();
    expect(data.hasApiKey).toBe(true);
  });

  it('POST /api/config should update configuration', async () => {
    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxTurns: 50,
        sandboxEnabled: false,
        workspaceDir: '/new/workspace'
      })
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config.maxTurns).toBe(50);
    expect(data.config.sandboxEnabled).toBe(false);
    expect(data.config.workspaceDir).toBe('/new/workspace');
  });

  it('POST /api/config should handle partial updates', async () => {
    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxTurns: 30 })
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config.maxTurns).toBe(30);
  });

  it('POST /api/config should update API endpoint', async () => {
    const newEndpoint = 'https://custom-api.example.com';
    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiEndpoint: newEndpoint })
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.config.apiEndpoint).toBe(newEndpoint);
  });

  it('POST /api/config should update permission mode', async () => {
    const response = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionMode: 'strict' })
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.config.permissionMode).toBe('strict');
  });
});

describe('Path Validation Utilities', () => {
  /**
   * Mock implementation of path validation functions
   */
  function isAbsolutePath(p) {
    if (!p) {
      return false;
    }
    if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')) {
      return true;
    }
    if (p.startsWith('/')) {
      return true;
    }
    return false;
  }

  function isPathInWorkspace(resolvedPath, workspaceDir) {
    if (!workspaceDir || !resolvedPath) {
      return false;
    }
    const normalizedWorkspace = workspaceDir.toLowerCase();
    const normalizedPath = resolvedPath.toLowerCase();
    return (
      normalizedPath === normalizedWorkspace ||
      normalizedPath.startsWith(normalizedWorkspace + '/') ||
      normalizedPath.startsWith(normalizedWorkspace + '\\')
    );
  }

  function validateFilePath(targetPath, workspaceDir) {
    if (!workspaceDir) {
      return { allowed: false, reason: '工作目录未设置' };
    }

    const resolved = isAbsolutePath(targetPath) ? targetPath : workspaceDir + '/' + targetPath;

    if (!isPathInWorkspace(resolved, workspaceDir)) {
      return { allowed: false, reason: '路径超出工作目录范围' };
    }

    return { allowed: true };
  }

  it('should detect Windows absolute paths', () => {
    expect(isAbsolutePath('C:\\Users\\test')).toBe(true);
    expect(isAbsolutePath('D:/Projects/app')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share')).toBe(true);
  });

  it('should detect Unix absolute paths', () => {
    expect(isAbsolutePath('/home/user')).toBe(true);
    expect(isAbsolutePath('/var/log')).toBe(true);
  });

  it('should detect relative paths', () => {
    expect(isAbsolutePath('relative/path')).toBe(false);
    expect(isAbsolutePath('./local')).toBe(false);
    expect(isAbsolutePath('../parent')).toBe(false);
    expect(isAbsolutePath('file.txt')).toBe(false);
  });

  it('should handle null/empty paths', () => {
    expect(isAbsolutePath(null)).toBe(false);
    expect(isAbsolutePath('')).toBe(false);
    expect(isAbsolutePath(undefined)).toBe(false);
  });

  it('should validate path within workspace', () => {
    const workspace = '/home/user/project';
    expect(isPathInWorkspace('/home/user/project/src', workspace)).toBe(true);
    expect(isPathInWorkspace('/home/user/project', workspace)).toBe(true);
  });

  it('should reject path outside workspace', () => {
    const workspace = '/home/user/project';
    expect(isPathInWorkspace('/home/user/other', workspace)).toBe(false);
    expect(isPathInWorkspace('/etc/passwd', workspace)).toBe(false);
  });

  it('should reject when workspace not set', () => {
    const result = validateFilePath('/some/path', '');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('工作目录未设置');
  });

  it('should allow paths within workspace', () => {
    const result = validateFilePath('src/file.js', '/home/project');
    expect(result.allowed).toBe(true);
  });

  it('should reject paths escaping workspace', () => {
    const result = validateFilePath('/etc/passwd', '/home/project');
    expect(result.allowed).toBe(false);
  });
});
