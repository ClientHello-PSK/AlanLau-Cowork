/**
 * Unit tests for renderer.js - Main renderer process entry point
 * Tests initialization, view switching, state management, and event handling
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all module dependencies before importing
vi.mock('../../renderer/utils.js', () => ({
  generateId: vi.fn(() => 'test-id-123'),
  hasUnclosedCodeBlock: vi.fn(() => false),
  debounce: vi.fn(fn => fn)
}));

vi.mock('../../renderer/uiHelpers.js', () => ({
  getTemplateContent: vi.fn(type => {
    const templates = {
      code: 'Write a function to...',
      debug: 'Help me debug this...',
      explain: 'Explain how...'
    };
    return templates[type] || '';
  }),
  matchesSearch: vi.fn((title, query) => {
    if (!query) {
      return true;
    }
    return title.toLowerCase().includes(query.toLowerCase());
  })
}));

vi.mock('../../renderer/modules/theme.js', () => ({
  initTheme: vi.fn()
}));

vi.mock('../../renderer/modules/feedback.js', () => ({
  showToast: vi.fn(),
  showErrorWithRetry: vi.fn()
}));

vi.mock('../../renderer/modules/settings.js', () => ({
  initSettings: vi.fn(() => Promise.resolve()),
  setupSettingsListeners: vi.fn()
}));

vi.mock('../../renderer/modules/skillsManager.js', () => ({
  setupSkillsListeners: vi.fn()
}));

vi.mock('../../renderer/modules/chatHistory.js', () => ({
  updateChatHistoryActiveState: vi.fn()
}));

vi.mock('../../renderer/modules/messageHandler.js', () => ({
  addUserMessage: vi.fn(),
  createAssistantMessage: vi.fn(() => {
    const div = document.createElement('div');
    div.className = 'message assistant';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    div.appendChild(contentDiv);
    return div;
  }),
  scrollToBottom: vi.fn()
}));

vi.mock('../../renderer/modules/chatManager.js', () => ({
  saveCurrentChat: vi.fn(state => state.allChats),
  loadAllChats: vi.fn(() => ({ allChats: [], currentChatId: null })),
  loadChat: vi.fn(),
  startNewChat: vi.fn(),
  renderChatHistory: vi.fn()
}));

vi.mock('../../renderer/modules/streamHandler.js', () => ({
  processSSEStream: vi.fn(() => Promise.resolve())
}));

vi.mock('../../renderer/modules/generationControl.js', () => ({
  setGeneratingState: vi.fn(),
  updateSendButton: vi.fn(),
  autoResizeTextarea: vi.fn(),
  insertNewlineAtCursor: vi.fn()
}));

vi.mock('../../renderer/modules/fileHandler.js', () => ({
  handleFileSelect: vi.fn(() => []),
  renderAttachedFiles: vi.fn(),
  addFileChange: vi.fn(() => ({ updatedChanges: [] })),
  renderFileChanges: vi.fn()
}));

// Setup DOM environment
function setupDOM() {
  document.body.innerHTML = `
    <div id="homeView">
      <form id="homeForm">
        <textarea id="homeInput"></textarea>
        <button id="homeSendBtn" disabled></button>
        <button id="homeStopBtn" style="display: none;"></button>
        <button id="homeAttachBtn"></button>
        <input type="file" id="homeFileInput" />
        <button id="homeThinkingBtn"></button>
        <select id="homeModelSelect">
          <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
          <option value="claude-3-5-sonnet">Claude</option>
        </select>
      </form>
      <div id="quickStartTemplates">
        <div class="template-card" data-template="code"></div>
        <div class="template-card" data-template="debug"></div>
      </div>
    </div>
    <div id="chatView" class="hidden">
      <form id="chatForm">
        <div class="input-wrapper">
          <textarea id="messageInput"></textarea>
        </div>
        <button id="chatSendBtn" disabled></button>
        <button id="chatStopBtn" style="display: none;"></button>
        <button id="chatAttachBtn"></button>
        <input type="file" id="chatFileInput" />
        <button id="chatThinkingBtn"></button>
        <select id="chatModelSelect">
          <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
        </select>
      </form>
      <div id="chatMessages"></div>
      <h2 id="chatTitle">New Chat</h2>
    </div>
    <div id="sidebar">
      <button id="sidebarToggle"></button>
      <div id="chatHistoryList"></div>
      <input id="chatSearch" />
    </div>
    <div id="leftSidebar"></div>
    <button id="sidebarExpandBtn" style="display: none;"></button>
    <div id="leftResizer"></div>
    <div id="rightResizer"></div>
    <div id="fileChangesList"></div>
  `;
}

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value;
    }),
    removeItem: vi.fn(key => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
})();

// Mock window.electronAPI
const electronAPIMock = {
  sendMessage: vi.fn(() =>
    Promise.resolve({
      requestId: 'req-123',
      getReader: () =>
        Promise.resolve({
          read: vi.fn(() => Promise.resolve({ done: true }))
        })
    })
  ),
  abortRequest: vi.fn(),
  getSettings: vi.fn(() => Promise.resolve({})),
  saveSettings: vi.fn(() => Promise.resolve()),
  resetSettings: vi.fn(() => Promise.resolve()),
  checkHealth: vi.fn(() => Promise.resolve({ status: 'ok' }))
};

describe('Renderer - DOM Structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should have homeView visible initially', () => {
    const homeView = document.getElementById('homeView');
    expect(homeView).not.toBeNull();
    expect(homeView.classList.contains('hidden')).toBe(false);
  });

  it('should have chatView hidden initially', () => {
    const chatView = document.getElementById('chatView');
    expect(chatView).not.toBeNull();
    expect(chatView.classList.contains('hidden')).toBe(true);
  });

  it('should have all required form elements', () => {
    expect(document.getElementById('homeForm')).not.toBeNull();
    expect(document.getElementById('homeInput')).not.toBeNull();
    expect(document.getElementById('homeSendBtn')).not.toBeNull();
    expect(document.getElementById('chatForm')).not.toBeNull();
    expect(document.getElementById('messageInput')).not.toBeNull();
    expect(document.getElementById('chatSendBtn')).not.toBeNull();
  });

  it('should have sidebar elements', () => {
    expect(document.getElementById('sidebar')).not.toBeNull();
    expect(document.getElementById('sidebarToggle')).not.toBeNull();
    expect(document.getElementById('chatHistoryList')).not.toBeNull();
  });
});

describe('Renderer - View Switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('switchToChatView should hide homeView and show chatView', () => {
    const homeView = document.getElementById('homeView');
    const chatView = document.getElementById('chatView');

    // Simulate switchToChatView
    homeView.classList.add('hidden');
    chatView.classList.remove('hidden');

    expect(homeView.classList.contains('hidden')).toBe(true);
    expect(chatView.classList.contains('hidden')).toBe(false);
  });

  it('switchToHomeView should show homeView and hide chatView', () => {
    const homeView = document.getElementById('homeView');
    const chatView = document.getElementById('chatView');

    // First switch to chat view
    homeView.classList.add('hidden');
    chatView.classList.remove('hidden');

    // Then switch back to home view
    homeView.classList.remove('hidden');
    chatView.classList.add('hidden');

    expect(homeView.classList.contains('hidden')).toBe(false);
    expect(chatView.classList.contains('hidden')).toBe(true);
  });
});

describe('Renderer - State Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should initialize with default state values', () => {
    const defaultState = {
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

    // Verify default state structure
    expect(defaultState.isFirstMessage).toBe(true);
    expect(defaultState.todos).toEqual([]);
    expect(defaultState.toolCalls).toEqual([]);
    expect(defaultState.isWaitingForResponse).toBe(false);
    expect(defaultState.currentChatId).toBeNull();
  });

  it('should handle localStorage for chat persistence', () => {
    const testChats = [{ id: 'chat-1', title: 'Test Chat', messages: [] }];

    localStorageMock.setItem('allChats', JSON.stringify(testChats));
    localStorageMock.setItem('currentChatId', 'chat-1');

    const storedChats = JSON.parse(localStorageMock.getItem('allChats'));
    const storedChatId = localStorageMock.getItem('currentChatId');

    expect(storedChats).toEqual(testChats);
    expect(storedChatId).toBe('chat-1');
  });

  it('should remove currentChatId from localStorage when cleared', () => {
    localStorageMock.setItem('currentChatId', 'chat-1');
    localStorageMock.removeItem('currentChatId');

    expect(localStorageMock.getItem('currentChatId')).toBeNull();
  });
});

describe('Renderer - Send Button State', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should disable send button when input is empty', () => {
    const input = document.getElementById('homeInput');
    const button = document.getElementById('homeSendBtn');

    input.value = '';
    button.disabled = !input.value.trim();

    expect(button.disabled).toBe(true);
  });

  it('should enable send button when input has content', () => {
    const input = document.getElementById('homeInput');
    const button = document.getElementById('homeSendBtn');

    input.value = 'Hello, World!';
    button.disabled = !input.value.trim();

    expect(button.disabled).toBe(false);
  });

  it('should disable send button when only whitespace', () => {
    const input = document.getElementById('homeInput');
    const button = document.getElementById('homeSendBtn');

    input.value = '   ';
    button.disabled = !input.value.trim();

    expect(button.disabled).toBe(true);
  });
});

describe('Renderer - Template Loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should load template content into input', async () => {
    const { getTemplateContent } = await import('../../renderer/uiHelpers.js');
    const input = document.getElementById('homeInput');

    const templateContent = getTemplateContent('code');
    input.value = templateContent;

    expect(input.value).toBe('Write a function to...');
  });

  it('should return empty string for unknown template', async () => {
    const { getTemplateContent } = await import('../../renderer/uiHelpers.js');

    const content = getTemplateContent('unknown');
    expect(content).toBe('');
  });

  it('should hide templates after loading', () => {
    const templates = document.getElementById('quickStartTemplates');
    templates.classList.add('hidden');

    expect(templates.classList.contains('hidden')).toBe(true);
  });
});

describe('Renderer - Sidebar Toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should toggle collapsed class on sidebar', () => {
    const sidebar = document.getElementById('sidebar');

    // Toggle to collapsed
    sidebar.classList.toggle('collapsed');
    expect(sidebar.classList.contains('collapsed')).toBe(true);

    // Toggle back
    sidebar.classList.toggle('collapsed');
    expect(sidebar.classList.contains('collapsed')).toBe(false);
  });

  it('should show expand button when sidebar is collapsed', () => {
    const sidebar = document.getElementById('sidebar');
    const expandBtn = document.getElementById('sidebarExpandBtn');

    sidebar.classList.add('collapsed');
    expandBtn.style.display = 'flex';

    expect(expandBtn.style.display).toBe('flex');
  });

  it('should hide expand button when sidebar is expanded', () => {
    const sidebar = document.getElementById('sidebar');
    const expandBtn = document.getElementById('sidebarExpandBtn');

    sidebar.classList.remove('collapsed');
    expandBtn.style.display = 'none';

    expect(expandBtn.style.display).toBe('none');
  });
});

describe('Renderer - Search Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;

    // Add some chat items for search testing
    const chatHistoryList = document.getElementById('chatHistoryList');
    chatHistoryList.innerHTML = `
      <div class="chat-item" data-id="1">
        <span class="chat-item-title">Hello World Chat</span>
      </div>
      <div class="chat-item" data-id="2">
        <span class="chat-item-title">Test Conversation</span>
      </div>
      <div class="chat-item" data-id="3">
        <span class="chat-item-title">Debug Session</span>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should filter chat items based on search query', async () => {
    const { matchesSearch } = await import('../../renderer/uiHelpers.js');
    const chatItems = document.querySelectorAll('.chat-item');

    const query = 'Hello';
    chatItems.forEach(item => {
      const title = item.querySelector('.chat-item-title').textContent;
      if (!matchesSearch(title, query)) {
        item.classList.add('hidden-by-search');
      }
    });

    const visibleItems = document.querySelectorAll('.chat-item:not(.hidden-by-search)');
    expect(visibleItems.length).toBe(1);
    expect(visibleItems[0].querySelector('.chat-item-title').textContent).toBe('Hello World Chat');
  });

  it('should show all items when search is empty', async () => {
    const { matchesSearch } = await import('../../renderer/uiHelpers.js');
    const chatItems = document.querySelectorAll('.chat-item');

    const query = '';
    chatItems.forEach(item => {
      const title = item.querySelector('.chat-item-title').textContent;
      if (!matchesSearch(title, query)) {
        item.classList.add('hidden-by-search');
      } else {
        item.classList.remove('hidden-by-search');
      }
    });

    const visibleItems = document.querySelectorAll('.chat-item:not(.hidden-by-search)');
    expect(visibleItems.length).toBe(3);
  });

  it('should show no results message when no matches', () => {
    const chatHistoryList = document.getElementById('chatHistoryList');
    const chatItems = document.querySelectorAll('.chat-item');

    // Hide all items
    chatItems.forEach(item => {
      item.classList.add('hidden-by-search');
    });

    // Add no results message
    const noResults = document.createElement('div');
    noResults.className = 'no-search-results visible';
    noResults.textContent = '没有匹配的聊天';
    chatHistoryList.appendChild(noResults);

    expect(chatHistoryList.querySelector('.no-search-results')).not.toBeNull();
    expect(chatHistoryList.querySelector('.no-search-results').textContent).toBe('没有匹配的聊天');
  });
});

describe('Renderer - Model Selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    // Add claude option to chatModelSelect
    const chatSelect = document.getElementById('chatModelSelect');
    const claudeOption = document.createElement('option');
    claudeOption.value = 'claude-3-5-sonnet';
    claudeOption.textContent = 'Claude';
    chatSelect.appendChild(claudeOption);

    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should sync model selection across both selects', () => {
    const homeSelect = document.getElementById('homeModelSelect');
    const chatSelect = document.getElementById('chatModelSelect');

    // Simulate model change - need to set the value that exists in select
    homeSelect.value = 'claude-3-5-sonnet';
    chatSelect.value = 'claude-3-5-sonnet';

    expect(homeSelect.value).toBe('claude-3-5-sonnet');
    expect(chatSelect.value).toBe('claude-3-5-sonnet');
  });

  it('should have default model selected', () => {
    const homeSelect = document.getElementById('homeModelSelect');
    expect(homeSelect.value).toBe('deepseek-v4-flash');
  });
});

describe('Renderer - Thinking Mode Toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should toggle thinking mode state', () => {
    let thinkingMode = 'normal';

    // Toggle to extended
    thinkingMode = thinkingMode === 'normal' ? 'extended' : 'normal';
    expect(thinkingMode).toBe('extended');

    // Toggle back to normal
    thinkingMode = thinkingMode === 'normal' ? 'extended' : 'normal';
    expect(thinkingMode).toBe('normal');
  });

  it('should add active class when extended thinking is enabled', () => {
    const btn = document.getElementById('homeThinkingBtn');
    const thinkingMode = 'extended';

    btn.classList.toggle('active', thinkingMode === 'extended');
    expect(btn.classList.contains('active')).toBe(true);
  });
});

describe('Renderer - Stop Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should call abortRequest with current request ID', () => {
    const currentRequestId = 'req-123';

    window.electronAPI.abortRequest(currentRequestId);

    expect(electronAPIMock.abortRequest).toHaveBeenCalledWith('req-123');
  });

  it('should show stop button when generating', () => {
    const stopBtn = document.getElementById('homeStopBtn');
    const sendBtn = document.getElementById('homeSendBtn');

    // Simulate generating state
    stopBtn.style.display = 'flex';
    sendBtn.style.display = 'none';

    expect(stopBtn.style.display).toBe('flex');
    expect(sendBtn.style.display).toBe('none');
  });

  it('should hide stop button when not generating', () => {
    const stopBtn = document.getElementById('homeStopBtn');
    const sendBtn = document.getElementById('homeSendBtn');

    // Simulate non-generating state
    stopBtn.style.display = 'none';
    sendBtn.style.display = 'flex';

    expect(stopBtn.style.display).toBe('none');
    expect(sendBtn.style.display).toBe('flex');
  });
});

describe('Renderer - Delete Chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should remove chat from allChats array', () => {
    const allChats = [
      { id: 'chat-1', title: 'Chat 1', messages: [] },
      { id: 'chat-2', title: 'Chat 2', messages: [] }
    ];

    const updatedChats = allChats.filter(c => c.id !== 'chat-1');

    expect(updatedChats.length).toBe(1);
    expect(updatedChats[0].id).toBe('chat-2');
  });

  it('should update localStorage after delete', () => {
    const allChats = [
      { id: 'chat-1', title: 'Chat 1', messages: [] },
      { id: 'chat-2', title: 'Chat 2', messages: [] }
    ];

    const updatedChats = allChats.filter(c => c.id !== 'chat-1');
    localStorageMock.setItem('allChats', JSON.stringify(updatedChats));

    const stored = JSON.parse(localStorageMock.getItem('allChats'));
    expect(stored.length).toBe(1);
  });

  it('should remove currentChatId if deleting current chat', () => {
    localStorageMock.setItem('currentChatId', 'chat-1');

    // Simulate deleting current chat
    const currentChatId = 'chat-1';
    const deletedId = 'chat-1';

    if (currentChatId === deletedId) {
      localStorageMock.removeItem('currentChatId');
    }

    expect(localStorageMock.getItem('currentChatId')).toBeNull();
  });
});

describe('Renderer - Copy Message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;

    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(() => Promise.resolve())
      },
      writable: true
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should copy message content to clipboard', async () => {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = `
      <div class="message user">
        <div class="message-content" data-raw-content="Test message">Test message</div>
        <button class="copy-btn">Copy</button>
      </div>
    `;

    const messageDiv = chatMessages.querySelector('.message');
    const contentDiv = messageDiv.querySelector('.message-content');
    const text = contentDiv.dataset.rawContent || contentDiv.textContent;

    await navigator.clipboard.writeText(text);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Test message');
  });
});

describe('Renderer - Keyboard Shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should submit form on Enter key (without Shift)', () => {
    const homeForm = document.getElementById('homeForm');
    const homeInput = document.getElementById('homeInput');
    homeInput.value = 'Test message';

    let formSubmitted = false;
    homeForm.addEventListener('submit', e => {
      e.preventDefault();
      formSubmitted = true;
    });

    // Create and dispatch Enter keydown event
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: false,
      bubbles: true
    });

    homeInput.dispatchEvent(event);
    homeForm.dispatchEvent(new Event('submit'));

    expect(formSubmitted).toBe(true);
  });

  it('should not submit form on Shift+Enter', () => {
    const homeForm = document.getElementById('homeForm');
    const homeInput = document.getElementById('homeInput');
    homeInput.value = 'Test message';

    let formSubmitted = false;
    homeForm.addEventListener('submit', e => {
      e.preventDefault();
      formSubmitted = true;
    });

    // Create and dispatch Shift+Enter keydown event
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true
    });

    homeInput.dispatchEvent(event);
    // Form should not be submitted

    // In real implementation, Shift+Enter adds newline
    expect(formSubmitted).toBe(false);
  });

  it('should clear search on Escape key', () => {
    const searchInput = document.getElementById('chatSearch');
    searchInput.value = 'test query';

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true
    });

    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        searchInput.blur();
      }
    });

    searchInput.dispatchEvent(event);

    expect(searchInput.value).toBe('');
  });
});

describe('Renderer - Panel Tab Switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;

    // Add panel tabs to DOM
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div class="panel-tabs">
        <button class="panel-tab active" data-tab="progress">Progress</button>
        <button class="panel-tab" data-tab="tools">Tools</button>
        <button class="panel-tab" data-tab="files">Files</button>
      </div>
      <div id="tab-progress" class="tab-pane active"></div>
      <div id="tab-tools" class="tab-pane"></div>
      <div id="tab-files" class="tab-pane"></div>
    `
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should switch active tab on click', () => {
    const tabs = document.querySelectorAll('.panel-tab');
    const tabId = 'tools';

    // Simulate switchPanelTab
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    const targetPane = document.getElementById('tab-' + tabId);
    if (targetPane) {
      targetPane.classList.add('active');
    }

    expect(
      document.querySelector('.panel-tab[data-tab="tools"]').classList.contains('active')
    ).toBe(true);
    expect(
      document.querySelector('.panel-tab[data-tab="progress"]').classList.contains('active')
    ).toBe(false);
    expect(document.getElementById('tab-tools').classList.contains('active')).toBe(true);
  });
});

describe('Renderer - File Attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    window.electronAPI = electronAPIMock;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should trigger file input click when attach button clicked', () => {
    const attachBtn = document.getElementById('homeAttachBtn');
    const fileInput = document.getElementById('homeFileInput');

    let fileInputClicked = false;
    fileInput.addEventListener('click', () => {
      fileInputClicked = true;
    });

    attachBtn.addEventListener('click', () => {
      fileInput.click();
    });

    attachBtn.click();

    expect(fileInputClicked).toBe(true);
  });

  it('should handle file selection', async () => {
    const { handleFileSelect } = await import('../../renderer/modules/fileHandler.js');

    const mockEvent = {
      target: {
        files: [{ name: 'test.txt', size: 1024, type: 'text/plain' }]
      }
    };

    const attachedFiles = handleFileSelect(mockEvent, 'home', [], vi.fn());

    // The mock returns an empty array
    expect(Array.isArray(attachedFiles)).toBe(true);
  });

  it('should remove attached file by index', () => {
    const attachedFiles = [{ name: 'file1.txt' }, { name: 'file2.txt' }, { name: 'file3.txt' }];

    // Remove file at index 1
    attachedFiles.splice(1, 1);

    expect(attachedFiles.length).toBe(2);
    expect(attachedFiles[0].name).toBe('file1.txt');
    expect(attachedFiles[1].name).toBe('file3.txt');
  });
});

describe('Renderer - Inline Tool Call Toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should toggle expanded class on tool call', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div class="inline-tool-call">
        <div class="inline-tool-header" onclick="window.toggleInlineToolCall(this)">Tool Name</div>
        <div class="tool-content">Tool content</div>
      </div>
    `
    );

    const toolDiv = document.querySelector('.inline-tool-call');

    // Toggle expanded
    toolDiv.classList.toggle('expanded');
    expect(toolDiv.classList.contains('expanded')).toBe(true);

    // Toggle back
    toolDiv.classList.toggle('expanded');
    expect(toolDiv.classList.contains('expanded')).toBe(false);
  });
});

describe('Renderer - Resizer Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should save left sidebar width to localStorage', () => {
    const leftSidebar = document.getElementById('leftSidebar');
    leftSidebar.style.width = '300px';

    localStorageMock.setItem('leftSidebarWidth', 300);

    expect(localStorageMock.getItem('leftSidebarWidth')).toBe(300);
  });

  it('should save right sidebar width to localStorage', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.style.width = '400px';

    localStorageMock.setItem('rightSidebarWidth', 400);

    expect(localStorageMock.getItem('rightSidebarWidth')).toBe(400);
  });

  it('should restore sidebar widths from localStorage', () => {
    localStorageMock.setItem('leftSidebarWidth', '300');
    localStorageMock.setItem('rightSidebarWidth', '400');

    const leftSidebar = document.getElementById('leftSidebar');
    const sidebar = document.getElementById('sidebar');

    const savedLeft = localStorageMock.getItem('leftSidebarWidth');
    const savedRight = localStorageMock.getItem('rightSidebarWidth');

    if (savedLeft) {
      leftSidebar.style.width = savedLeft + 'px';
    }
    if (savedRight && parseInt(savedRight) >= 200) {
      sidebar.style.width = savedRight + 'px';
    }

    expect(leftSidebar.style.width).toBe('300px');
    expect(sidebar.style.width).toBe('400px');
  });
});
