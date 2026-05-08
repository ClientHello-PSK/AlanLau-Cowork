/**
 * Utility functions for the renderer process
 * These are pure functions that can be unit tested
 */

/**
 * Generate a unique ID for chats
 * @returns {string} Unique chat ID
 */
export function generateId() {
  return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Escape HTML for safe display
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escape HTML without DOM dependency (for Node.js testing)
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtmlPure(str) {
  if (typeof str !== 'string') {
    return '';
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Check if text has unclosed code block
 * @param {string} text - Text to check
 * @returns {boolean} True if code block is unclosed
 */
export function hasUnclosedCodeBlock(text) {
  if (typeof text !== 'string') {
    return false;
  }
  // Count occurrences of triple backticks
  const backtickMatches = text.match(/```/g);
  const count = backtickMatches ? backtickMatches.length : 0;
  // Odd count means unclosed code block
  return count % 2 !== 0;
}

/**
 * Format relative time for display (e.g., "2 分钟前", "1 小时前")
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Relative time string
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return '';
  }

  const now = Date.now();
  const diff = now - timestamp;

  // Less than 1 minute
  if (diff < 60 * 1000) {
    return '刚刚';
  }

  // Less than 1 hour
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes} 分钟前`;
  }

  // Less than 24 hours
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours} 小时前`;
  }

  // Less than 7 days
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days} 天前`;
  }

  // Format as date
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日`;
}

/**
 * Format tool input for preview display
 * @param {object} toolInput - Tool input object
 * @returns {string} Formatted preview string
 */
export function formatToolPreview(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') {
    return String(toolInput || '').substring(0, 50);
  }

  const keys = Object.keys(toolInput);
  if (keys.length === 0) {
    return '';
  }

  const previewKeys = [
    'pattern',
    'command',
    'file_path',
    'path',
    'query',
    'content',
    'description'
  ];
  const key = previewKeys.find(k => toolInput[k]) || keys[0];
  const value = toolInput[key];

  if (typeof value === 'string') {
    return `${key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`;
  } else if (Array.isArray(value)) {
    return `${key}: [${value.length} items]`;
  } else if (typeof value === 'object') {
    return `${key}: {...}`;
  }
  return `${key}: ${String(value).substring(0, 30)}`;
}

/**
 * Extract short description from tool input
 * @param {string} name - Tool name
 * @param {object} input - Tool input
 * @returns {string} Short description
 */
export function getToolDescription(name, input) {
  if (!input) {
    return '';
  }

  // Common patterns for description extraction
  if (input.description) {
    return input.description;
  }
  if (input.command) {
    // Truncate long commands
    const cmd = input.command.split('\n')[0];
    return cmd.length > 40 ? cmd.substring(0, 37) + '...' : cmd;
  }
  if (input.file_path) {
    return input.file_path.split('/').pop();
  }
  if (input.path) {
    return input.path.split('/').pop();
  }
  if (input.query) {
    return input.query.substring(0, 40);
  }
  if (input.pattern) {
    return input.pattern.substring(0, 40);
  }
  if (input.url) {
    return input.url.substring(0, 40);
  }
  if (input.message) {
    return input.message.substring(0, 40);
  }

  return '';
}

/**
 * Debounce function to limit execution frequency
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Calculate diff statistics for file operation tools
 * @param {string} toolName - Name of the tool
 * @param {object} toolInput - Tool input parameters
 * @returns {object|null} Diff stats { added, removed, isFile } or null
 */
export function calculateDiffStats(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') {
    return null;
  }

  // Write tool - all lines are additions
  if (toolName === 'Write') {
    const content = toolInput.contents || toolInput.content || '';
    const lines = content ? content.split('\n').length : 0;
    return { added: lines, removed: 0 };
  }

  // StrReplace/Edit tool - compare old and new strings
  if (toolName === 'StrReplace' || toolName === 'Edit') {
    const newStr = toolInput.new_string || '';
    const oldStr = toolInput.old_string || '';
    const added = newStr ? newStr.split('\n').length : 0;
    const removed = oldStr ? oldStr.split('\n').length : 0;
    return { added, removed };
  }

  // Delete tool - file removed
  if (toolName === 'Delete') {
    return { added: 0, removed: 0, isFile: true };
  }

  // Read tool - show lines read (informational)
  if (toolName === 'Read') {
    const limit = toolInput.limit;
    if (limit) {
      return { read: limit };
    }
    return null;
  }

  return null;
}
