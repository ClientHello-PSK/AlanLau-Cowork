/**
 * tools.js - 工具定义与执行器
 * 定义 9 种工具的 OpenAI function-calling schema，并提供执行函数
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const MAX_OUTPUT_SIZE = 50 * 1024; // 50KB

// ============================================
// 工具 Schema 定义（OpenAI function-calling 格式）
// ============================================

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read the contents of a file. Returns the file content as text.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read' },
          offset: { type: 'integer', description: 'Line number to start reading from (0-based)' },
          limit: { type: 'integer', description: 'Maximum number of lines to read' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description:
        'Write content to a file. Creates the file and any parent directories if they do not exist.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to write' },
          contents: { type: 'string', description: 'Content to write to the file' }
        },
        required: ['path', 'contents']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description:
        'Perform a string replacement in a file. Replaces the first occurrence of old_string with new_string.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to edit' },
          old_string: { type: 'string', description: 'The text to find and replace' },
          new_string: { type: 'string', description: 'The replacement text' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Execute a shell command and return its output.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          timeout: {
            type: 'integer',
            description: 'Timeout in milliseconds (default 30000)'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Find files matching a glob pattern. Returns matching file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match (e.g. "**/*.js", "src/**/*.ts")'
          },
          path: { type: 'string', description: 'Base directory to search in' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description:
        'Search for a pattern in file contents. Returns matching lines with file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression pattern to search for' },
          path: { type: 'string', description: 'File or directory to search in' },
          glob: { type: 'string', description: 'File pattern to include (e.g. "*.js")' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'WebFetch',
      description: 'Fetch the content of a web page and return it as text.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'TodoWrite',
      description: 'Update the task list displayed to the user.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'List of todo items',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Task description' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Task status'
                },
                activeForm: { type: 'string', description: 'Present continuous form' }
              },
              required: ['content', 'status']
            }
          }
        },
        required: ['todos']
      }
    }
  }
];

// ============================================
// 工具执行器
// ============================================

/**
 * 执行指定工具
 * @param {string} toolName - 工具名称
 * @param {object} toolInput - 工具输入参数
 * @param {object} sandboxConfig - 沙箱配置
 * @param {string} sandboxConfig.workspaceDir - 工作目录
 * @param {boolean} sandboxConfig.sandboxEnabled - 是否启用沙箱
 * @param {Function} sandboxConfig.validateFilePath - 路径校验函数
 * @returns {Promise<string>} 工具执行结果
 */
export async function executeTool(toolName, toolInput, sandboxConfig = {}) {
  try {
    switch (toolName) {
      case 'Read':
        return executeRead(toolInput, sandboxConfig);
      case 'Write':
        return executeWrite(toolInput, sandboxConfig);
      case 'Edit':
        return executeEdit(toolInput, sandboxConfig);
      case 'Bash':
        return executeBash(toolInput, sandboxConfig);
      case 'Glob':
        return executeGlob(toolInput, sandboxConfig);
      case 'Grep':
        return executeGrep(toolInput, sandboxConfig);
      case 'WebFetch':
        return executeWebFetch(toolInput);
      case 'TodoWrite':
        return executeTodoWrite(toolInput);
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    return `Error executing ${toolName}: ${err.message}`;
  }
}

// ------------------------------------------
// 各工具实现
// ------------------------------------------

function validatePath(filePath, sandboxConfig) {
  if (sandboxConfig.sandboxEnabled && sandboxConfig.validateFilePath) {
    const result = sandboxConfig.validateFilePath(filePath, sandboxConfig.workspaceDir);
    if (!result.allowed) {
      throw new Error(result.reason);
    }
  }
}

function resolvePath(filePath, sandboxConfig) {
  if (!filePath) return sandboxConfig.workspaceDir || process.cwd();
  if (path.isAbsolute(filePath)) return path.resolve(filePath);
  return path.resolve(sandboxConfig.workspaceDir || process.cwd(), filePath);
}

function truncateOutput(output) {
  if (output.length > MAX_OUTPUT_SIZE) {
    return output.substring(0, MAX_OUTPUT_SIZE) + '\n... (output truncated)';
  }
  return output;
}

function executeRead(input, sandboxConfig) {
  const filePath = resolvePath(input.path, sandboxConfig);
  validatePath(filePath, sandboxConfig);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (fs.statSync(filePath).isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const offset = input.offset || 0;
  const limit = input.limit || lines.length;

  const selectedLines = lines.slice(offset, offset + limit);
  const numbered = selectedLines.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');

  return truncateOutput(numbered);
}

function executeWrite(input, sandboxConfig) {
  const filePath = resolvePath(input.path, sandboxConfig);
  validatePath(filePath, sandboxConfig);

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, input.contents, 'utf-8');
  return `Successfully wrote ${input.contents.length} bytes to ${filePath}`;
}

function executeEdit(input, sandboxConfig) {
  const filePath = resolvePath(input.path, sandboxConfig);
  validatePath(filePath, sandboxConfig);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const index = content.indexOf(input.old_string);

  if (index === -1) {
    // Show a helpful error with context
    const lines = content.split('\n');
    const preview = lines.slice(0, 5).map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(
      `old_string not found in ${filePath}. File has ${lines.length} lines. First lines:\n${preview}`
    );
  }

  const newContent = content.substring(0, index) + input.new_string + content.substring(index + input.old_string.length);
  fs.writeFileSync(filePath, newContent, 'utf-8');

  const replacements = content.split(input.old_string).length - 1;
  return `Successfully replaced${replacements > 1 ? ` (1 of ${replacements} occurrences)` : ''} in ${filePath}`;
}

function executeBash(input, sandboxConfig) {
  const cwd = sandboxConfig.workspaceDir || process.cwd();
  const timeout = input.timeout || 30000;

  try {
    const output = execSync(input.command, {
      cwd,
      timeout: Math.min(timeout, 120000),
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      shell: true
    });
    return truncateOutput(output || '(no output)');
  } catch (err) {
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    let result = '';
    if (stdout) result += stdout;
    if (stderr) result += (result ? '\n' : '') + stderr;
    if (err.killed) result += (result ? '\n' : '') + 'Process was killed (timeout)';
    return truncateOutput(result || `Command failed with exit code ${err.status}`);
  }
}

function executeGlob(input, sandboxConfig) {
  const baseDir = resolvePath(input.path || '.', sandboxConfig);
  validatePath(baseDir, sandboxConfig);

  if (!fs.existsSync(baseDir)) {
    throw new Error(`Directory not found: ${baseDir}`);
  }

  const pattern = input.pattern;
  const results = [];

  // Simple glob: support **/*.ext and basic patterns
  walkDir(baseDir, baseDir, pattern, results, 0);

  results.sort();
  if (results.length > 200) {
    return results.slice(0, 200).join('\n') + '\n... (truncated, too many results)';
  }
  return results.length > 0 ? results.join('\n') : 'No files matched the pattern';
}

function walkDir(baseDir, currentDir, pattern, results, depth) {
  if (depth > 20) return;

  let entries;
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;

    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        walkDir(baseDir, fullPath, pattern, results, depth + 1);
      }
    } else if (entry.isFile() && matchGlob(path.relative(baseDir, fullPath), pattern)) {
      results.push(fullPath);
    }
  }
}

function shouldSkipDir(name) {
  return ['node_modules', '.git', 'dist', 'coverage', '__pycache__', '.next', 'build'].includes(name);
}

function matchGlob(filePath, pattern) {
  // Convert simple glob patterns to regex
  // Support: **/*.ext, *.ext, dir/**/*.ext
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\?/g, '[^/]');
  try {
    const regex = new RegExp(regexStr + '$', 'i');
    return regex.test(filePath.replace(/\\/g, '/'));
  } catch {
    return filePath.includes(pattern.replace(/\*/g, ''));
  }
}

function executeGrep(input, sandboxConfig) {
  const searchPath = resolvePath(input.path || '.', sandboxConfig);
  validatePath(searchPath, sandboxConfig);

  const pattern = input.pattern;
  const results = [];
  let regex;
  try {
    regex = new RegExp(pattern, 'i');
  } catch {
    return `Invalid regex pattern: ${pattern}`;
  }

  const globFilter = input.glob;

  if (fs.statSync(searchPath).isFile()) {
    grepFile(searchPath, searchPath, regex, globFilter, results);
  } else {
    grepDir(searchPath, searchPath, regex, globFilter, results, 0);
  }

  if (results.length > 100) {
    return results.slice(0, 100).join('\n') + '\n... (truncated)';
  }
  return results.length > 0 ? results.join('\n') : `No matches found for pattern: ${pattern}`;
}

function grepDir(baseDir, currentDir, regex, globFilter, results, depth) {
  if (depth > 15) return;
  let entries;
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        grepDir(baseDir, fullPath, regex, globFilter, results, depth + 1);
      }
    } else if (entry.isFile()) {
      grepFile(baseDir, fullPath, regex, globFilter, results);
    }
  }
}

function grepFile(baseDir, filePath, regex, globFilter, results) {
  if (globFilter && !matchGlob(path.relative(baseDir, filePath), globFilter)) return;

  // Skip binary files
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.exe', '.dll', '.so', '.zip', '.gz', '.tar', '.woff', '.woff2', '.ttf', '.eot', '.pdf'].includes(ext)) return;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relPath = path.relative(baseDir, filePath);
    for (let i = 0; i < lines.length && results.length < 200; i++) {
      if (regex.test(lines[i])) {
        results.push(`${relPath}:${i + 1}: ${lines[i].substring(0, 200)}`);
      }
    }
  } catch {
    // Skip unreadable files
  }
}

async function executeWebFetch(input) {
  const url = input.url;
  if (!url) throw new Error('URL is required');

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cowork/1.0)' },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/') || contentType.includes('json') || contentType.includes('xml')) {
      const text = await response.text();
      return truncateOutput(text);
    }

    return `Fetched ${url} - Content-Type: ${contentType} (${response.headers.get('content-length') || 'unknown'} bytes)`;
  } catch (err) {
    return `Failed to fetch ${url}: ${err.message}`;
  }
}

function executeTodoWrite(input) {
  const count = input.todos?.length || 0;
  return `Todo list updated with ${count} items`;
}
