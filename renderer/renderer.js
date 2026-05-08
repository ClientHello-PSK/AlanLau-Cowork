/**
 * renderer.js - 主渲染进程入口
 * 协调各模块完成 UI 交互
 */

// ==================== 模块导入 ====================

// 工具函数
import { generateId, hasUnclosedCodeBlock, debounce } from './utils.js';
import { getTemplateContent, matchesSearch } from './uiHelpers.js';

// 核心模块
import { initTheme } from './modules/theme.js';
import { showToast, showErrorWithRetry, initFeedbackCallbacks } from './modules/feedback.js';
import { initSettings, setupSettingsListeners } from './modules/settings.js';
import { setupSkillsListeners } from './modules/skillsManager.js';
import { updateChatHistoryActiveState } from './modules/chatHistory.js';

// 新模块
import {
  addUserMessage as addUserMessageModule,
  createAssistantMessage as createAssistantMessageModule,
  scrollToBottom as scrollToBottomModule
} from './modules/messageHandler.js';
import {
  saveCurrentChat,
  loadAllChats as loadAllChatsModule,
  loadChat as loadChatModule,
  startNewChat as startNewChatModule,
  renderChatHistory as renderChatHistoryModule
} from './modules/chatManager.js';
import { processSSEStream } from './modules/streamHandler.js';
import {
  setGeneratingState as setGeneratingStateModule,
  updateSendButton as updateSendButtonModule,
  autoResizeTextarea,
  insertNewlineAtCursor
} from './modules/generationControl.js';
import {
  handleFileSelect as handleFileSelectModule,
  renderAttachedFiles as renderAttachedFilesModule,
  addFileChange as addFileChangeModule,
  renderFileChanges as renderFileChangesModule
} from './modules/fileHandler.js';

// ==================== DOM 元素 ====================

const homeView = document.getElementById('homeView');
const chatView = document.getElementById('chatView');
const homeForm = document.getElementById('homeForm');
const homeInput = document.getElementById('homeInput');
const homeSendBtn = document.getElementById('homeSendBtn');
const homeStopBtn = document.getElementById('homeStopBtn');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatStopBtn = document.getElementById('chatStopBtn');
const chatMessages = document.getElementById('chatMessages');
const chatTitle = document.getElementById('chatTitle');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const chatHistoryList = document.getElementById('chatHistoryList');

// ==================== 状态 ====================

const state = {
  isFirstMessage: true,
  todos: [],
  toolCalls: [],
  fileChanges: [],
  attachedFiles: [],
  selectedModel: 'deepseek-v4-flash',
  thinkingMode: 'normal',
  isWaitingForResponse: false,
  currentRequestId: null,
  allChats: [],
  currentChatId: null
};

// DOM 元素集合（用于传递给模块）
const elements = {
  homeView,
  chatView,
  homeInput,
  messageInput,
  homeSendBtn,
  chatSendBtn,
  homeStopBtn,
  chatStopBtn,
  chatMessages,
  chatTitle,
  chatHistoryList
};

// ==================== 初始化 ====================

function init() {
  setupEventListeners();
  loadAllChats();
  renderChatHistory();
  initializeSearch();
  setupResizers();
  initializeSidebarState();
  homeInput.focus();
}

// ==================== 事件监听 ====================

function setupEventListeners() {
  // 表单提交
  homeForm.addEventListener('submit', handleSendMessage);
  chatForm.addEventListener('submit', handleSendMessage);

  // 输入框事件
  homeInput.addEventListener('input', () => {
    updateSendButton(homeInput, homeSendBtn);
    autoResizeTextarea(homeInput);
  });
  homeInput.addEventListener('paste', () => setTimeout(() => autoResizeTextarea(homeInput), 0));
  homeInput.addEventListener('keydown', e => handleKeyPress(e, homeForm));

  messageInput.addEventListener('input', () => {
    updateSendButton(messageInput, chatSendBtn);
    autoResizeTextarea(messageInput);
  });
  messageInput.addEventListener('paste', () =>
    setTimeout(() => autoResizeTextarea(messageInput), 0)
  );
  messageInput.addEventListener('keydown', e => handleKeyPress(e, chatForm));

  // 侧边栏切换
  sidebarToggle.addEventListener('click', window.toggleSidebar);

  // 文件附件
  const homeAttachBtn = document.getElementById('homeAttachBtn');
  const chatAttachBtn = document.getElementById('chatAttachBtn');
  const homeFileInput = document.getElementById('homeFileInput');
  const chatFileInput = document.getElementById('chatFileInput');

  homeAttachBtn.addEventListener('click', () => homeFileInput.click());
  chatAttachBtn.addEventListener('click', () => chatFileInput.click());
  homeFileInput.addEventListener('change', e => handleFileSelect(e, 'home'));
  chatFileInput.addEventListener('change', e => handleFileSelect(e, 'chat'));

  // 下拉菜单
  setupDropdowns();

  // 停止按钮
  if (homeStopBtn) {
    homeStopBtn.addEventListener('click', handleStopGeneration);
  }
  if (chatStopBtn) {
    chatStopBtn.addEventListener('click', handleStopGeneration);
  }

  // 模板卡片
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => loadTemplate(card.dataset.template));
  });
}

// ==================== 核心功能 ====================

function handleKeyPress(e, form) {
  if (e.key === 'Enter' && !e.shiftKey) {
    const input = state.isFirstMessage ? homeInput : messageInput;
    if (hasUnclosedCodeBlock(input.value)) {
      e.preventDefault();
      insertNewlineAtCursor(input);
      showToast('Code block not closed - Enter adds newline', 'info', 2000);
      return;
    }
    e.preventDefault();
    form.dispatchEvent(new Event('submit'));
  }
}

async function handleSendMessage(e) {
  e.preventDefault();

  const input = state.isFirstMessage ? homeInput : messageInput;
  const message = input.value.trim();

  if (!message || state.isWaitingForResponse) {
    return;
  }

  if (state.isFirstMessage) {
    state.currentChatId = generateId();
    switchToChatView();
    state.isFirstMessage = false;
    chatTitle.textContent = message.length > 30 ? message.substring(0, 30) + '...' : message;
  }

  // 添加用户消息
  addUserMessageModule(chatMessages, message);
  saveState();

  // 清空输入
  input.value = '';
  updateSendButton(input, homeSendBtn);
  updateSendButton(messageInput, chatSendBtn);
  hideTemplates();

  // 设置加载状态
  state.isWaitingForResponse = true;
  setGeneratingState(true);

  // 创建助手消息
  const assistantMessage = createAssistantMessageModule(chatMessages);
  const contentDiv = assistantMessage.querySelector('.message-content');

  try {
    // 准备文件附件
    const filesToSend = state.attachedFiles.map(f => ({
      name: f.name,
      type: f.type,
      data: f.data
    }));

    const response = await window.electronAPI.sendMessage(
      message,
      state.currentChatId,
      filesToSend,
      state.selectedModel,
      state.thinkingMode
    );
    state.currentRequestId = response.requestId;
    const reader = await response.getReader();

    // 使用 streamHandler 处理 SSE 流
    await processSSEStream(reader, contentDiv, assistantMessage, chatMessages, {
      onToolCall: toolCall => {
        state.toolCalls.push(toolCall);
      },
      onToolResult: (toolId, status) => {
        const tc = state.toolCalls.find(t => t.id === toolId);
        if (tc) {
          tc.status = status;
        }
      },
      onTodoUpdate: todos => {
        state.todos = todos;
      },
      onFileChange: (name, path, type) => {
        const { updatedChanges } = addFileChangeModule(state.fileChanges, name, path, type);
        state.fileChanges = updatedChanges;
        renderFileChanges();
      },
      onSaveState: () => saveState()
    });
  } catch (error) {
    console.error('Error sending message:', error);
    if (error.message === 'Request aborted') {
      showToast('Generation stopped', 'info');
      assistantMessage.remove();
    } else {
      const loadingIndicator = contentDiv.querySelector('.loading-indicator');
      if (loadingIndicator) {
        loadingIndicator.remove();
      }
      showErrorWithRetry(
        error.message || 'Network error - please retry',
        message,
        state.currentChatId
      );
      showToast('Message failed - click retry to resend', 'error');
    }
  } finally {
    state.isWaitingForResponse = false;
    state.currentRequestId = null;
    setGeneratingState(false);
    saveState();
    updateSendButton(messageInput, chatSendBtn);
    messageInput.focus();

    // 发送后清空附件
    if (state.attachedFiles.length > 0) {
      state.attachedFiles = [];
      const context = state.isFirstMessage ? 'home' : 'chat';
      renderAttachedFiles(state.attachedFiles, context);
    }
  }
}

// ==================== 状态管理 ====================

function saveState(preserveUpdatedAt = false, skipRenderHistory = false) {
  if (!state.currentChatId) {
    return;
  }

  state.allChats = saveCurrentChat(state, elements, { preserveUpdatedAt, skipRenderHistory });

  if (!skipRenderHistory) {
    renderChatHistory();
  } else {
    updateChatHistoryActiveState(chatHistoryList, state.currentChatId);
  }
}

function loadAllChats() {
  const loaded = loadAllChatsModule();
  state.allChats = loaded.allChats;
  state.currentChatId = loaded.currentChatId;

  if (state.currentChatId) {
    const chat = state.allChats.find(c => c.id === state.currentChatId);
    if (chat) {
      loadChat(chat);
    }
  }
}

function loadChat(chat) {
  loadChatModule(chat, state, elements, {
    switchToChatView,
    renderFileChanges,
    scrollToBottom: () => scrollToBottomModule(chatMessages)
  });
}

function switchToChat(chatId) {
  if (state.currentChatId) {
    saveState(true, true);
  }
  const chat = state.allChats.find(c => c.id === chatId);
  if (chat) {
    loadChat(chat);
  }
}

function renderChatHistory() {
  renderChatHistoryModule(state, chatHistoryList, switchToChat);
}

// ==================== 视图切换 ====================

function switchToChatView() {
  homeView.classList.add('hidden');
  chatView.classList.remove('hidden');
  initializeSidebarState();
  messageInput.focus();
}

function switchToHomeView() {
  homeView.classList.remove('hidden');
  chatView.classList.add('hidden');
}

// ==================== UI 辅助 ====================

function updateSendButton(input, button) {
  updateSendButtonModule(input, button, state.isWaitingForResponse);
}

function setGeneratingState(generating) {
  setGeneratingStateModule(generating, elements);
}

function handleStopGeneration() {
  if (state.currentRequestId) {
    console.log('Stopping generation:', state.currentRequestId);
    window.electronAPI.abortRequest(state.currentRequestId);
    showToast('Stopping generation...', 'info');
    setGeneratingState(false);
  }
}

// ==================== 模板 ====================

function loadTemplate(templateType) {
  const prompt = getTemplateContent(templateType);
  if (!prompt) {
    return;
  }

  const input = homeView.classList.contains('hidden') ? messageInput : homeInput;
  input.value = prompt;
  autoResizeTextarea(input);
  input.focus();
  hideTemplates();
  showToast('Template loaded - customize and send!', 'info', 2000);
}

function hideTemplates() {
  const templates = document.getElementById('quickStartTemplates');
  if (templates) {
    templates.classList.add('hidden');
  }
}

function showTemplates() {
  const templates = document.getElementById('quickStartTemplates');
  if (templates) {
    templates.classList.remove('hidden');
  }
}

// ==================== 文件处理 ====================

function handleFileSelect(event, context) {
  state.attachedFiles = handleFileSelectModule(
    event,
    context,
    state.attachedFiles,
    renderAttachedFiles
  );
}

function renderAttachedFiles(files, context) {
  const inputWrapper =
    context === 'home'
      ? document.querySelector('#homeForm .input-wrapper')
      : document.querySelector('#chatForm .input-wrapper');
  renderAttachedFilesModule(inputWrapper, files, context);
}

function renderFileChanges() {
  const container = document.getElementById('fileChangesList');
  renderFileChangesModule(container, state.fileChanges);
}

window.removeAttachedFile = function (index, context) {
  state.attachedFiles.splice(index, 1);
  renderAttachedFiles(state.attachedFiles, context);
};

// ==================== 搜索 ====================

function initializeSearch() {
  const searchInput = document.getElementById('chatSearch');
  if (!searchInput) {
    return;
  }

  const debouncedSearch = debounce(e => searchChats(e.target.value), 200);
  searchInput.addEventListener('input', debouncedSearch);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchChats('');
      searchInput.blur();
    }
  });
}

function searchChats(query) {
  const chatItems = chatHistoryList.querySelectorAll('.task-item, .chat-item');
  const existingNoResults = chatHistoryList.querySelector('.no-search-results');
  if (existingNoResults) {
    existingNoResults.remove();
  }

  let visibleCount = 0;
  chatItems.forEach(item => {
    const titleEl = item.querySelector('.task-title') || item.querySelector('.chat-item-title');
    const title = titleEl?.textContent || '';

    if (matchesSearch(title, query)) {
      item.classList.remove('hidden-by-search');
      const section = item.closest('.task-section');
      if (section) {
        section.classList.remove('hidden-by-search');
      }
      visibleCount++;
    } else {
      item.classList.add('hidden-by-search');
      const section = item.closest('.task-section');
      if (section) {
        const visibleItems = section.querySelectorAll('.task-item:not(.hidden-by-search)');
        if (visibleItems.length === 0) {
          section.classList.add('hidden-by-search');
        }
      }
    }
  });

  if (query && query.trim() && visibleCount === 0) {
    const noResultsEl = document.createElement('div');
    noResultsEl.className = 'no-search-results visible';
    noResultsEl.textContent = '没有匹配的聊天';
    chatHistoryList.appendChild(noResultsEl);
  }
}

// ==================== 下拉菜单 ====================

function setupDropdowns() {
  ['homeThinkingBtn', 'chatThinkingBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) {
      return;
    }
    btn.addEventListener('click', e => {
      e.stopPropagation();
      state.thinkingMode = state.thinkingMode === 'normal' ? 'extended' : 'normal';
      document.querySelectorAll('.thinking-btn').forEach(b => {
        b.classList.toggle('active', state.thinkingMode === 'extended');
      });
    });
  });

  ['homeModelSelect', 'chatModelSelect'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) {
      return;
    }
    select.addEventListener('change', e => {
      state.selectedModel = e.target.value;
      document.querySelectorAll('.model-select').forEach(s => {
        s.value = state.selectedModel;
      });
    });
  });
}

// ==================== 侧边栏 ====================

function initializeSidebarState() {
  const sidebarExpandBtn = document.getElementById('sidebarExpandBtn');
  if (sidebar && sidebarExpandBtn) {
    const hasCollapsedClass = sidebar.classList.contains('collapsed');
    const sidebarWidth = sidebar.offsetWidth;
    const computedWidth = parseFloat(window.getComputedStyle(sidebar).width);
    const isCollapsed = hasCollapsedClass || sidebarWidth <= 1 || computedWidth <= 1;
    sidebarExpandBtn.style.display = isCollapsed ? 'flex' : 'none';
  }
}

window.toggleSidebar = function () {
  sidebar.classList.toggle('collapsed');
  const isNowCollapsed = sidebar.classList.contains('collapsed');
  if (!isNowCollapsed) {
    sidebar.style.width = '';
    localStorage.removeItem('rightSidebarWidth');
  }
  const sidebarExpandBtn = document.getElementById('sidebarExpandBtn');
  if (sidebarExpandBtn) {
    const hasCollapsedClass = sidebar.classList.contains('collapsed');
    const sidebarWidth = sidebar.offsetWidth;
    const shouldShow = hasCollapsedClass || sidebarWidth <= 1;
    sidebarExpandBtn.style.display = shouldShow ? 'flex' : 'none';
  }
};

window.switchPanelTab = function (tabId) {
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  const targetPane = document.getElementById('tab-' + tabId);
  if (targetPane) {
    targetPane.classList.add('active');
  }
};

// ==================== Resizers ====================

function setupResizers() {
  const leftSidebar = document.getElementById('leftSidebar');
  const rightSidebar = document.getElementById('sidebar');
  const leftResizer = document.getElementById('leftResizer');
  const rightResizer = document.getElementById('rightResizer');

  if (!leftResizer || !rightResizer) {
    return;
  }

  const savedLeftWidth = localStorage.getItem('leftSidebarWidth');
  const savedRightWidth = localStorage.getItem('rightSidebarWidth');

  if (savedLeftWidth) {
    leftSidebar.style.width = savedLeftWidth + 'px';
    leftSidebar.style.minWidth = savedLeftWidth + 'px';
  }
  if (savedRightWidth && parseInt(savedRightWidth) >= 200) {
    rightSidebar.style.width = savedRightWidth + 'px';
  } else if (savedRightWidth) {
    localStorage.removeItem('rightSidebarWidth');
  }

  leftResizer.addEventListener('mousedown', e => {
    e.preventDefault();
    leftResizer.classList.add('active');
    const handleMove = ev => {
      const newWidth = ev.clientX;
      if (newWidth > 150 && newWidth < 500) {
        leftSidebar.style.width = newWidth + 'px';
        leftSidebar.style.minWidth = newWidth + 'px';
      }
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener(
      'mouseup',
      () => {
        leftResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleMove);
        localStorage.setItem('leftSidebarWidth', leftSidebar.offsetWidth);
      },
      { once: true }
    );
  });

  rightResizer.addEventListener('mousedown', e => {
    e.preventDefault();
    rightResizer.classList.add('active');
    const handleMove = ev => {
      const newWidth = window.innerWidth - ev.clientX;
      if (newWidth > 200 && newWidth < 600) {
        rightSidebar.style.width = newWidth + 'px';
      }
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener(
      'mouseup',
      () => {
        rightResizer.classList.remove('active');
        document.removeEventListener('mousemove', handleMove);
        localStorage.setItem('rightSidebarWidth', rightSidebar.offsetWidth);
      },
      { once: true }
    );
  });
}

// ==================== 全局函数 ====================

window.startNewChat = function () {
  startNewChatModule(state, elements, {
    switchToHomeView,
    autoResizeTextarea,
    updateSendButton,
    showTemplates,
    renderChatHistory
  });
};

window.deleteChat = function (chatId, event) {
  event.stopPropagation();
  state.allChats = state.allChats.filter(c => c.id !== chatId);

  const newCurrentChatId = state.currentChatId === chatId ? null : state.currentChatId;
  localStorage.setItem('allChats', JSON.stringify(state.allChats));
  if (newCurrentChatId) {
    localStorage.setItem('currentChatId', newCurrentChatId);
  } else {
    localStorage.removeItem('currentChatId');
  }

  if (state.currentChatId === chatId) {
    if (state.allChats.length > 0) {
      loadChat(state.allChats[0]);
    } else {
      state.currentChatId = null;
      switchToHomeView();
      state.isFirstMessage = true;
    }
  }
  renderChatHistory();
};

window.toggleInlineToolCall = function (header) {
  const toolDiv = header.closest('.inline-tool-call');
  toolDiv.classList.toggle('expanded');
};

window.toggleToolCall = function (header) {
  const toolDiv = header.closest('.tool-call-item');
  toolDiv.classList.toggle('expanded');
};

window.copyMessage = function (button) {
  const messageDiv = button.closest('.message');
  const contentDiv = messageDiv.querySelector('.message-content');
  const text = contentDiv.dataset.rawContent || contentDiv.textContent;

  navigator.clipboard.writeText(text).then(() => {
    button.style.color = '#27ae60';
    setTimeout(() => {
      button.style.color = '';
    }, 1000);
  });
};

window.regenerateMessage = async function (button) {
  if (state.isWaitingForResponse) {
    showToast('请等待当前响应完成', 'info');
    return;
  }

  const messageDiv = button.closest('.message');
  if (!messageDiv || !messageDiv.classList.contains('assistant')) {
    return;
  }

  const messages = Array.from(chatMessages.children);
  const index = messages.indexOf(messageDiv);
  if (index <= 0) {
    return;
  }

  let userMessageIndex = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].classList.contains('user')) {
      userMessageIndex = i;
      break;
    }
  }

  if (userMessageIndex === -1) {
    showToast('找不到可以重新生成的消息', 'error');
    return;
  }

  const userMessageDiv = messages[userMessageIndex];
  const userContent = userMessageDiv.querySelector('.message-content').textContent;

  while (chatMessages.children.length > userMessageIndex) {
    chatMessages.lastElementChild.remove();
  }

  const input = state.isFirstMessage ? homeInput : messageInput;
  input.value = userContent;
  autoResizeTextarea(input);
  handleSendMessage(new Event('submit'));
};

// ==================== 初始化 ====================

window.addEventListener('load', async () => {
  init();
  initTheme();
  await initSettings();
  setupSettingsListeners();
  setupSkillsListeners();
  initFeedbackCallbacks({
    scrollToBottom: scrollToBottomModule,
    handleSendMessage: (message, chatId) => {
      state.currentChatId = chatId || state.currentChatId;
      handleSendMessage({ preventDefault: () => {} });
    }
  });
  autoResizeTextarea(homeInput);
  autoResizeTextarea(messageInput);
});
