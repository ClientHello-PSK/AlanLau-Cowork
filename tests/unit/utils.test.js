/**
 * Unit tests for renderer utility functions
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateId,
  escapeHtmlPure,
  hasUnclosedCodeBlock,
  formatToolPreview,
  getToolDescription,
  debounce
} from '../../renderer/utils.js';

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId();
    const id2 = generateId();

    expect(id1).not.toBe(id2);
  });

  it('should start with "chat_" prefix', () => {
    const id = generateId();
    expect(id.startsWith('chat_')).toBe(true);
  });

  it('should contain timestamp', () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();

    // Extract timestamp from ID (format: chat_TIMESTAMP_RANDOM)
    const parts = id.split('_');
    const timestamp = parseInt(parts[1], 10);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('escapeHtmlPure', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtmlPure('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('should escape ampersands', () => {
    expect(escapeHtmlPure('foo & bar')).toBe('foo &amp; bar');
  });

  it('should escape single quotes', () => {
    expect(escapeHtmlPure("it's")).toBe('it&#039;s');
  });

  it('should handle empty string', () => {
    expect(escapeHtmlPure('')).toBe('');
  });

  it('should handle non-string input', () => {
    expect(escapeHtmlPure(null)).toBe('');
    expect(escapeHtmlPure(undefined)).toBe('');
    expect(escapeHtmlPure(123)).toBe('');
  });

  it('should preserve normal text', () => {
    expect(escapeHtmlPure('Hello World')).toBe('Hello World');
  });
});

describe('hasUnclosedCodeBlock', () => {
  it('should return false for text without code blocks', () => {
    expect(hasUnclosedCodeBlock('Hello world')).toBe(false);
  });

  it('should return false for properly closed code blocks', () => {
    expect(hasUnclosedCodeBlock('```javascript\nconst x = 1;\n```')).toBe(false);
  });

  it('should return true for unclosed code block', () => {
    expect(hasUnclosedCodeBlock('```javascript\nconst x = 1;')).toBe(true);
  });

  it('should handle multiple code blocks', () => {
    const text = '```js\ncode1\n```\n\n```py\ncode2\n```';
    expect(hasUnclosedCodeBlock(text)).toBe(false);
  });

  it('should return true for odd number of backticks', () => {
    expect(hasUnclosedCodeBlock('```\n```\n```')).toBe(true);
  });

  it('should handle empty string', () => {
    expect(hasUnclosedCodeBlock('')).toBe(false);
  });

  it('should handle non-string input', () => {
    expect(hasUnclosedCodeBlock(null)).toBe(false);
    expect(hasUnclosedCodeBlock(undefined)).toBe(false);
  });
});

describe('formatToolPreview', () => {
  it('should format command input', () => {
    const input = { command: 'npm install express' };
    expect(formatToolPreview(input)).toBe('command: npm install express');
  });

  it('should format path input', () => {
    const input = { path: '/home/user/project/src/index.js' };
    expect(formatToolPreview(input)).toBe('path: /home/user/project/src/index.js');
  });

  it('should truncate long values', () => {
    const input = { query: 'a'.repeat(100) };
    const result = formatToolPreview(input);
    expect(result.length).toBeLessThan(70);
    expect(result).toContain('...');
  });

  it('should handle array values', () => {
    const input = { files: ['a.js', 'b.js', 'c.js'] };
    expect(formatToolPreview(input)).toBe('files: [3 items]');
  });

  it('should handle nested objects', () => {
    const input = { config: { key: 'value' } };
    expect(formatToolPreview(input)).toBe('config: {...}');
  });

  it('should handle empty object', () => {
    expect(formatToolPreview({})).toBe('');
  });

  it('should handle null/undefined', () => {
    expect(formatToolPreview(null)).toBe('');
    expect(formatToolPreview(undefined)).toBe('');
  });

  it('should prioritize common keys', () => {
    const input = { pattern: '*.js', random: 'value' };
    expect(formatToolPreview(input)).toContain('pattern');
  });
});

describe('getToolDescription', () => {
  it('should extract description field', () => {
    const input = { description: 'Test description' };
    expect(getToolDescription('Tool', input)).toBe('Test description');
  });

  it('should extract command and truncate', () => {
    const longCommand =
      'npm install --save-dev eslint prettier typescript @types/node some-very-long-package-name';
    const input = { command: longCommand };
    const result = getToolDescription('Bash', input);
    expect(result.length).toBeLessThanOrEqual(43); // 40 + "..."
  });

  it('should extract filename from path', () => {
    const input = { path: '/home/user/project/src/utils.js' };
    expect(getToolDescription('Read', input)).toBe('utils.js');
  });

  it('should extract filename from file_path', () => {
    const input = { file_path: '/home/user/app.py' };
    expect(getToolDescription('Write', input)).toBe('app.py');
  });

  it('should handle multiline commands', () => {
    const input = { command: 'echo "line1"\necho "line2"' };
    expect(getToolDescription('Bash', input)).toBe('echo "line1"');
  });

  it('should return empty string for null input', () => {
    expect(getToolDescription('Tool', null)).toBe('');
    expect(getToolDescription('Tool', undefined)).toBe('');
  });
});

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delay function execution', () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn();
    expect(mockFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should only execute once for rapid calls', () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn();
    debouncedFn();
    debouncedFn();

    vi.advanceTimersByTime(100);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should pass arguments to the function', () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn('arg1', 'arg2');
    vi.advanceTimersByTime(100);

    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should use the last arguments when called multiple times', () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn('first');
    debouncedFn('second');
    debouncedFn('third');

    vi.advanceTimersByTime(100);
    expect(mockFn).toHaveBeenCalledWith('third');
  });
});

