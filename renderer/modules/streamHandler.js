/**
 * SSE 流式处理模块
 * 负责处理服务器发送的 SSE 事件流
 */

import { logSSEData, logToolUse, logToolResult, logToolMatch, logDone } from './logger.js';
import {
  createToolCallData,
  createSidebarToolCallElement,
  updateSidebarToolCallStatus,
  updateSidebarToolCallResult,
  createInlineToolCallElement,
  updateInlineToolCallResult
} from './toolCalls.js';
import { appendToContent, incrementChunkCounter } from './markdownRenderer.js';
import {
  removeLoadingIndicator,
  showMessageActions,
  updateGenerationStatus,
  removeGenerationStatus,
  scrollToBottom
} from './messageHandler.js';

/**
 * SSE 事件处理回调接口
 * @typedef {Object} StreamCallbacks
 * @property {Function} onToolCall - 工具调用回调 (toolCall) => void
 * @property {Function} onToolResult - 工具结果回调 (toolId, result) => void
 * @property {Function} onTodoUpdate - Todo 更新回调 (todos) => void
 * @property {Function} onFileChange - 文件变更回调 (name, path, type) => void
 * @property {Function} onSaveState - 保存状态回调 () => void
 */

/**
 * 处理 SSE 流
 * @param {ReadableStreamDefaultReader} reader - SSE 读取器
 * @param {HTMLElement} contentDiv - 消息内容容器
 * @param {HTMLElement} assistantMessage - 助手消息元素
 * @param {HTMLElement} messagesContainer - 消息容器
 * @param {StreamCallbacks} callbacks - 回调函数
 * @returns {Promise<void>}
 */
export async function processSSEStream(
  reader,
  contentDiv,
  assistantMessage,
  messagesContainer,
  callbacks
) {
  let buffer = '';
  let hasContent = false;
  let receivedStreamingText = false;
  const pendingToolCalls = new Map();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      // 流结束，清理状态
      if (hasContent) {
        removeLoadingIndicator(contentDiv);
      }
      showMessageActions(assistantMessage);

      // 标记所有待处理工具为成功
      for (const [, localId] of pendingToolCalls) {
        updateToolCallStatus(localId, 'success', callbacks);
      }
      break;
    }

    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines[lines.length - 1];

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];

      if (line.startsWith('data: ')) {
        try {
          const jsonStr = line.slice(6);
          const data = JSON.parse(jsonStr);
          logSSEData(data);

          const eventResult = handleSSEEvent(data, {
            contentDiv,
            assistantMessage,
            messagesContainer,
            pendingToolCalls,
            hasContent,
            receivedStreamingText,
            callbacks
          });

          // 更新状态
          hasContent = eventResult.hasContent;
          receivedStreamingText = eventResult.receivedStreamingText;

          // 如果是 done 事件，退出
          if (eventResult.isDone) {
            return;
          }

          scrollToBottom(messagesContainer);
        } catch (parseError) {
          // 静默处理解析错误
        }
      }
    }
  }
}

/**
 * 处理单个 SSE 事件
 * @param {Object} data - SSE 事件数据
 * @param {Object} context - 处理上下文
 * @returns {Object} { hasContent, receivedStreamingText, isDone }
 */
function handleSSEEvent(data, context) {
  const { contentDiv, assistantMessage, pendingToolCalls, callbacks } = context;

  let { hasContent, receivedStreamingText } = context;
  let isDone = false;

  if (data.type === 'done') {
    logDone(pendingToolCalls.size, Array.from(pendingToolCalls.keys()));

    // SDK 不在 tool_result 中提供单独的 tool_use_id
    // 当流结束时，标记所有待处理工具为完成
    for (const [, localId] of pendingToolCalls) {
      updateToolCallStatus(localId, 'success', callbacks);
      updateInlineToolCallResult(localId, null);
    }
    pendingToolCalls.clear();

    removeGenerationStatus(assistantMessage);
    isDone = true;
  } else if (data.type === 'text' && data.content) {
    if (!hasContent) {
      removeLoadingIndicator(contentDiv);
    }
    hasContent = true;
    receivedStreamingText = true;
    updateGenerationStatus(assistantMessage, '正在生成回复...');
    appendToContent(contentDiv, data.content);
    if (callbacks.onSaveState) {
      callbacks.onSaveState();
    }
  } else if (data.type === 'reasoning' && data.content) {
    if (!hasContent) {
      removeLoadingIndicator(contentDiv);
    }
    hasContent = true;
    updateGenerationStatus(assistantMessage, '正在深度思考...');
    appendReasoningContent(contentDiv, data.content);
  } else if (data.type === 'tool_use') {
    hasContent = handleToolUseEvent(
      data,
      contentDiv,
      assistantMessage,
      pendingToolCalls,
      callbacks
    );
  } else if (data.type === 'tool_result' || data.type === 'result') {
    hasContent = handleToolResultEvent(
      data,
      contentDiv,
      assistantMessage,
      pendingToolCalls,
      hasContent,
      callbacks
    );
  } else if (data.type === 'assistant' && data.message) {
    const result = handleAssistantEvent(
      data,
      contentDiv,
      assistantMessage,
      pendingToolCalls,
      hasContent,
      receivedStreamingText,
      callbacks
    );
    hasContent = result.hasContent;
    receivedStreamingText = result.receivedStreamingText;
  }

  return { hasContent, receivedStreamingText, isDone };
}

/**
 * 处理 tool_use 事件
 */
function handleToolUseEvent(data, contentDiv, assistantMessage, pendingToolCalls, callbacks) {
  const toolName = data.name || data.tool || 'Tool';
  const toolInput = data.input || {};
  const apiId = data.id;

  logToolUse(toolName, apiId, toolInput);
  updateGenerationStatus(assistantMessage, `正在调用工具: ${toolName}...`);

  // 创建工具调用
  const toolCall = createToolCallData(toolName, toolInput, 'running');

  // 添加到侧边栏
  const timelineList = document.getElementById('timelineList');
  const emptyTimeline = document.getElementById('emptyTimeline');
  if (emptyTimeline) {
    emptyTimeline.style.display = 'none';
  }
  const toolDiv = createSidebarToolCallElement(toolCall);
  if (timelineList) {
    timelineList.appendChild(toolDiv);
  }

  // 添加内联工具调用
  const inlineToolDiv = createInlineToolCallElement(toolName, toolInput, toolCall.id);
  contentDiv.appendChild(inlineToolDiv);
  incrementChunkCounter(contentDiv);

  // 建立 API ID 到本地 ID 的映射
  if (apiId) {
    pendingToolCalls.set(apiId, toolCall.id);
  }

  // 通知回调
  if (callbacks.onToolCall) {
    callbacks.onToolCall(toolCall);
  }

  // 处理 TodoWrite 工具
  if (toolName === 'TodoWrite' && toolInput.todos) {
    if (callbacks.onTodoUpdate) {
      callbacks.onTodoUpdate(toolInput.todos);
    }
  }

  // 跟踪文件变更
  if (['Write', 'Edit', 'StrReplace', 'Delete'].includes(toolName)) {
    trackFileChange(toolName, toolInput, callbacks);
  }

  return true;
}

/**
 * 处理 tool_result 事件
 */
function handleToolResultEvent(
  data,
  contentDiv,
  assistantMessage,
  pendingToolCalls,
  hasContent,
  callbacks
) {
  const result = data.result || data.content || data;
  const apiId = data.tool_use_id;

  logToolResult(apiId, pendingToolCalls.has(apiId), Array.from(pendingToolCalls.keys()));
  updateGenerationStatus(assistantMessage, '收到工具执行结果，正在处理...');

  // 根据 API ID 查找匹配的工具调用
  const localId = apiId ? pendingToolCalls.get(apiId) : null;
  logToolMatch(apiId, localId);

  if (localId) {
    updateToolCallStatus(localId, 'success', callbacks);
    updateSidebarToolCallResult(localId, result);
    updateInlineToolCallResult(localId, result);
    pendingToolCalls.delete(apiId);
  }

  if (!hasContent) {
    removeLoadingIndicator(contentDiv);
  }

  return true;
}

/**
 * 处理 assistant 事件
 */
function handleAssistantEvent(
  data,
  contentDiv,
  assistantMessage,
  pendingToolCalls,
  hasContent,
  receivedStreamingText,
  callbacks
) {
  if (data.message.content && Array.isArray(data.message.content)) {
    for (const block of data.message.content) {
      if (block.type === 'tool_use') {
        const toolName = block.name || 'Tool';
        const toolInput = block.input || {};
        const apiId = block.id;

        updateGenerationStatus(assistantMessage, `准备使用工具: ${toolName}...`);

        // 创建工具调用
        const toolCall = createToolCallData(toolName, toolInput, 'running');

        // 添加到侧边栏
        const timelineList = document.getElementById('timelineList');
        const emptyTimeline = document.getElementById('emptyTimeline');
        if (emptyTimeline) {
          emptyTimeline.style.display = 'none';
        }
        const toolDiv = createSidebarToolCallElement(toolCall);
        if (timelineList) {
          timelineList.appendChild(toolDiv);
        }

        // 添加内联工具调用
        const inlineToolDiv = createInlineToolCallElement(toolName, toolInput, toolCall.id);
        contentDiv.appendChild(inlineToolDiv);
        incrementChunkCounter(contentDiv);

        if (apiId) {
          pendingToolCalls.set(apiId, toolCall.id);
        }

        // 通知回调
        if (callbacks.onToolCall) {
          callbacks.onToolCall(toolCall);
        }

        // 跟踪文件变更
        if (['Write', 'Edit', 'StrReplace', 'Delete'].includes(toolName)) {
          trackFileChange(toolName, toolInput, callbacks);
        }

        hasContent = true;
      } else if (block.type === 'text' && block.text) {
        if (!receivedStreamingText) {
          if (!hasContent) {
            removeLoadingIndicator(contentDiv);
          }
          hasContent = true;
          updateGenerationStatus(assistantMessage, '正在组织语言...');
          appendToContent(contentDiv, block.text);
        }
      }
    }

    // 处理 TodoWrite
    for (const block of data.message.content) {
      if (block.type === 'tool_use' && block.name === 'TodoWrite') {
        if (callbacks.onTodoUpdate) {
          callbacks.onTodoUpdate(block.input.todos);
        }
      }
    }
  }

  return { hasContent, receivedStreamingText };
}

/**
 * 更新工具调用状态
 */
function updateToolCallStatus(localId, status, callbacks) {
  updateSidebarToolCallStatus(localId, status);
  if (callbacks.onToolResult) {
    callbacks.onToolResult(localId, status);
  }
}

/**
 * 跟踪文件变更
 */
function trackFileChange(toolName, toolInput, callbacks) {
  const filePath = toolInput.path || toolInput.file_path || '';
  const pathSeparator = filePath.includes('\\') ? '\\' : '/';
  const fileName = filePath.split(pathSeparator).pop() || 'unknown';

  let changeType = 'modified';
  if (toolName === 'Delete') {
    changeType = 'deleted';
  } else if (toolName === 'Write') {
    changeType = 'added';
  }

  if (callbacks.onFileChange) {
    callbacks.onFileChange(fileName, filePath, changeType);
  }
}

/**
 * 追加推理内容到折叠区域
 */
function appendReasoningContent(contentDiv, content) {
  let reasoningSection = contentDiv.querySelector('.reasoning-section');
  if (!reasoningSection) {
    reasoningSection = document.createElement('div');
    reasoningSection.className = 'reasoning-section collapsed';
    reasoningSection.innerHTML = `
      <div class="reasoning-header" onclick="this.parentElement.classList.toggle('expanded');this.parentElement.classList.toggle('collapsed')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <span class="reasoning-label">Thinking</span>
        <svg class="expand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="reasoning-body"></div>
    `;
    contentDiv.insertBefore(reasoningSection, contentDiv.firstChild);
  }
  const bodyEl = reasoningSection.querySelector('.reasoning-body');
  bodyEl.textContent += content;
}
