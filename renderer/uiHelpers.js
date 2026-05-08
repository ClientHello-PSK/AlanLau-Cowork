/**
 * UI Helpers - UI 操作逻辑模块
 * 提供可测试的 UI 相关纯函数
 */

import {
  escapeHtmlPure,
  formatToolPreview,
  getToolDescription,
  calculateDiffStats
} from './utils.js';

/**
 * 创建 Toast 配置
 * @param {string} type - Toast 类型 ('success' | 'error' | 'info')
 * @returns {object} { icon, color }
 */
export function createToastConfig(type) {
  switch (type) {
    case 'success':
      return { icon: '✓', color: '#10b981' };
    case 'error':
      return { icon: '✕', color: '#ef4444' };
    case 'info':
    default:
      return { icon: 'ℹ', color: '#3b82f6' };
  }
}

/**
 * 构建 Diff 统计 HTML
 * @param {object} stats - Diff 统计 { added, removed, isFile, read }
 * @returns {string} HTML 字符串
 */
export function buildDiffStatsHTML(stats) {
  if (!stats) {
    return '';
  }

  let html = '<div class="diff-stats">';

  if (stats.read) {
    html += `<span class="read-lines">${stats.read} 行</span>`;
  } else if (stats.isFile) {
    html += '<span class="file-deleted">已删除</span>';
  } else {
    if (stats.added > 0) {
      html += `<span class="additions">+${stats.added}</span>`;
    }
    if (stats.removed > 0) {
      html += `<span class="deletions">-${stats.removed}</span>`;
    }
  }

  html += '</div>';
  return html;
}

/**
 * 构建内联工具调用 HTML（Cursor 风格）
 * @param {string} toolName - 工具名称
 * @param {object} toolInput - 工具输入
 * @param {string} toolId - 工具 ID
 * @param {string} status - 状态 ('running' | 'success' | 'error')
 * @param {*} result - 结果（可选）
 * @returns {string} HTML 字符串
 */
export function buildInlineToolCallHTML(
  toolName,
  toolInput,
  toolId,
  status = 'running',
  result = null
) {
  const inputPreview = formatToolPreview(toolInput);
  const inputStr = JSON.stringify(toolInput, null, 2);

  // Calculate diff stats for file operation tools
  const diffStats = calculateDiffStats(toolName, toolInput);
  const diffStatsHtml = status === 'success' ? buildDiffStatsHTML(diffStats) : '';

  let resultHtml = '';
  if (result !== null && result !== undefined) {
    const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    const truncatedResult = resultStr.substring(0, 2000) + (resultStr.length > 2000 ? '...' : '');
    resultHtml = `
      <div class="tool-section tool-output-section">
        <div class="tool-section-label">Output</div>
        <pre class="tool-output-content">${escapeHtmlPure(truncatedResult)}</pre>
      </div>`;
  } else {
    resultHtml = `
      <div class="tool-section tool-output-section" style="display: none;">
        <div class="tool-section-label">Output</div>
        <pre class="tool-output-content"></pre>
      </div>`;
  }

  // Spinner SVG for running state, checkmark for success, X for error
  let statusIcon;
  if (status === 'running') {
    // Circular spinner
    statusIcon = `
      <svg class="tool-status-icon running tool-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
      </svg>`;
  } else if (status === 'success') {
    statusIcon = `
      <svg class="tool-status-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>`;
  } else {
    statusIcon = `
      <svg class="tool-status-icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>`;
  }

  return `
    <div class="inline-tool-header" onclick="toggleInlineToolCall(this)">
      ${statusIcon}
      <span class="tool-name">${escapeHtmlPure(toolName)}</span>
      <span class="tool-preview">${escapeHtmlPure(inputPreview)}</span>
      ${diffStatsHtml}
      <svg class="expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>
    <div class="inline-tool-result">
      <div class="tool-section">
        <div class="tool-section-label">Input</div>
        <pre>${escapeHtmlPure(inputStr)}</pre>
      </div>
      ${resultHtml}
    </div>
  `;
}

/**
 * 构建侧边栏工具调用项 HTML
 * @param {object} toolCall - 工具调用对象
 * @returns {string} HTML 字符串
 */
export function buildSidebarToolCallHTML(toolCall) {
  const { name, input, status, result } = toolCall;

  let resultHtml = '';
  if (result !== null && result !== undefined) {
    const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    const truncatedResult = resultStr.substring(0, 2000) + (resultStr.length > 2000 ? '...' : '');
    resultHtml = `
      <div class="tool-detail-section tool-output-section">
        <div class="tool-detail-label">Output</div>
        <pre class="sidebar-tool-output">${escapeHtmlPure(truncatedResult)}</pre>
      </div>`;
  } else {
    resultHtml = `
      <div class="tool-detail-section tool-output-section" style="display: none;">
        <div class="tool-detail-label">Output</div>
        <pre class="sidebar-tool-output"></pre>
      </div>`;
  }

  const statusText =
    status === 'success' ? 'Completed' : status === 'error' ? 'Failed' : 'Running...';

  return `
    <div class="tool-call-header" onclick="toggleToolCall(this)">
      <div class="tool-call-icon ${status}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
        </svg>
      </div>
      <div class="tool-call-info">
        <div class="tool-call-name">${escapeHtmlPure(name)}</div>
        <div class="tool-call-status">${statusText}</div>
      </div>
      <div class="tool-call-expand">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    </div>
    <div class="tool-call-details">
      <div class="tool-detail-section">
        <div class="tool-detail-label">Input</div>
        <pre>${escapeHtmlPure(JSON.stringify(input, null, 2))}</pre>
      </div>
      ${resultHtml}
    </div>
  `;
}

/**
 * 构建聊天历史项 HTML
 * @param {object} chat - 聊天对象
 * @param {boolean} isActive - 是否为当前活动聊天
 * @param {string} status - 聊天状态 ('running' | 'completed' | 'error')
 * @param {string} relativeTime - 相对时间字符串（如"2 分钟前"）
 * @param {string} path - 路径信息（可选）
 * @returns {string} HTML 字符串
 */
export function buildChatItemHTML(
  chat,
  isActive,
  status = 'completed',
  relativeTime = '',
  path = ''
) {
  const title = chat.title || 'New chat';
  const statusClass = status || 'completed';
  const timeDisplay = relativeTime || '';
  const pathDisplay = path || '';

  return `
    <div class="task-item-header">
      <div class="task-status ${statusClass}"></div>
      <div class="task-title">${escapeHtmlPure(title)}</div>
    </div>
    <div class="task-meta">
      ${pathDisplay ? `<span>${escapeHtmlPure(pathDisplay)}</span>` : ''}
      ${timeDisplay ? `<span>${escapeHtmlPure(timeDisplay)}</span>` : ''}
      <button class="delete-chat-btn" onclick="deleteChat('${chat.id}', event)" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;
}

/**
 * 构建任务分组标题 HTML
 * @param {string} groupName - 分组名称（如"进行中"、"今天"）
 * @returns {string} HTML 字符串
 */
export function buildTaskSectionTitleHTML(groupName) {
  return `<div class="task-section-title">${escapeHtmlPure(groupName)}</div>`;
}

/**
 * 构建消息操作按钮 HTML
 * @returns {string} HTML 字符串
 */
export function buildMessageActionsHTML() {
  return `
    <button class="action-btn regenerate-btn" title="Regenerate" onclick="regenerateMessage(this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 4v6h6"></path>
        <path d="M23 20v-6h-6"></path>
        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
      </svg>
    </button>
    <button class="action-btn" title="Copy" onclick="copyMessage(this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
  `;
}

/**
 * 构建加载指示器 HTML
 * @returns {string} HTML 字符串
 */
export function buildLoadingIndicatorHTML() {
  return `
    <svg class="loading-asterisk" viewBox="0 0 24 24" fill="none">
      <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
}

/**
 * 构建错误重试 HTML
 * @param {string} errorMessage - 错误消息
 * @returns {string} HTML 字符串
 */
export function buildErrorRetryHTML(errorMessage) {
  return `
    <div class="message-error-content">
      <span class="message-error-icon">⚠</span>
      <span class="message-error-text">${escapeHtmlPure(errorMessage)}</span>
      <button class="message-error-retry">重新发送</button>
    </div>
  `;
}

/**
 * 获取模板内容
 * @param {string} templateType - 模板类型
 * @returns {string|null} 模板内容或 null
 */
export function getTemplateContent(templateType) {
  const templates = {
    'config-translate': `请帮我进行跨厂商配置翻译。我需要将以下配置翻译为华为设备脚本：

[请粘贴源配置文件内容]

要求：
1. 识别配置意图并生成目标脚本
2. 标注无法直接翻译的配置项
3. 生成差异对比报告`,

    'lld-calibration': `请帮我进行LLD与现网数据校准。

LLD文档：[请上传或粘贴LLD设计文档]
现网数据：[请上传CME导出的CSV文件]

要求：
1. 对比资源分配差异
2. 识别潜在的资源冲突
3. 生成校准建议报告`,

    'pac-review': `请帮我审核验收交付件。

验收要求：[请描述合同中的验收标准]
待审核截图：[请上传测试截图]

要求：
1. 识别截图中的关键指标
2. 对比合同要求判断是否达标
3. 标记不合格项并建议重命名`,

    'fault-evidence': `请帮我梳理故障证据链。

故障描述：[请简述故障现象]
相关日志：[请上传或粘贴日志片段]
处理记录：[请粘贴处理过程记录]

要求：
1. 生成故障时间轴
2. 分析可能的根本原因
3. 输出复盘草稿`,

    'soc-response': `请帮我应答技术规范书要求。

规范书要求：[请上传或粘贴SOC技术需求条目]
产品范围：[请说明涉及的产品线]

要求：
1. 逐条判断是否支持
2. 生成应答初稿
3. 标注需要专家确认的条目`,

    'subcon-audit': `请帮我审计分包商作业质量。

审计范围：[请描述需要审计的作业类型]
操作日志：[请上传分包商提交的操作日志]

要求：
1. 检查操作步骤完整性
2. 识别跳步执行等违规操作
3. 生成审计报告摘要`
  };

  return templates[templateType] || null;
}

/**
 * 判断搜索是否匹配
 * @param {string} text - 要搜索的文本
 * @param {string} query - 搜索查询
 * @returns {boolean} 是否匹配
 */
export function matchesSearch(text, query) {
  if (!query || !query.trim()) {
    return true;
  }
  if (!text) {
    return false;
  }
  return text.toLowerCase().includes(query.toLowerCase().trim());
}
