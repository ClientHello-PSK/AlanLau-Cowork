const { contextBridge, ipcRenderer } = require('electron');

const SERVER_URL = 'http://localhost:3001';

// Module-level state (accessible within preload context)
const activeRequests = new Map();

// Module-level helper function
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Expose safe API to renderer process via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  // Abort a specific request
  abortRequest: requestId => {
    const controller = activeRequests.get(requestId);
    if (controller) {
      console.log('[PRELOAD] Aborting request:', requestId);
      controller.abort();
      activeRequests.delete(requestId);
    }
  },

  // Send a chat message to the backend with chat ID for session management
  sendMessage: async (message, chatId, files = [], model = null, thinkingMode = 'normal') => {
    const requestId = generateRequestId();
    const controller = new AbortController();

    // Store controller for potential abort
    activeRequests.set(requestId, controller);

    return new Promise((resolve, reject) => {
      console.log('[PRELOAD] Sending message to backend:', message);
      console.log('[PRELOAD] Chat ID:', chatId);
      console.log('[PRELOAD] Files:', files.length);
      console.log('[PRELOAD] Request ID:', requestId);

      const timeoutId = setTimeout(() => {
        if (activeRequests.has(requestId)) {
          console.log('[PRELOAD] Request timeout, aborting:', requestId);
          controller.abort();
          activeRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 120000); // 2 minute timeout

      fetch(`${SERVER_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message, chatId, files, model, thinkingMode }),
        signal: controller.signal
      })
        .then(response => {
          clearTimeout(timeoutId);
          activeRequests.delete(requestId);

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          console.log('[PRELOAD] Connected to backend successfully');

          // Return a custom object with methods to read the stream
          resolve({
            requestId,
            getReader: async function () {
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              return {
                read: async () => {
                  const { done, value } = await reader.read();
                  return {
                    done,
                    value: done ? undefined : decoder.decode(value, { stream: true })
                  };
                }
              };
            }
          });
        })
        .catch(error => {
          clearTimeout(timeoutId);
          activeRequests.delete(requestId);

          if (error.name === 'AbortError') {
            console.log('[PRELOAD] Request was aborted:', requestId);
            reject(new Error('Request aborted'));
          } else {
            console.error('[PRELOAD] Connection error:', error.message);
            reject(new Error(`Failed to connect to backend: ${error.message}`));
          }
        });
    });
  },

  // Settings API
  getSettings: async () => {
    try {
      return await ipcRenderer.invoke('getSettings');
    } catch (error) {
      console.error('[PRELOAD] Failed to get settings:', error);
      throw error;
    }
  },

  saveSettings: async settings => {
    try {
      return await ipcRenderer.invoke('saveSettings', settings);
    } catch (error) {
      console.error('[PRELOAD] Failed to save settings:', error);
      throw error;
    }
  },

  resetSettings: async () => {
    try {
      return await ipcRenderer.invoke('resetSettings');
    } catch (error) {
      console.error('[PRELOAD] Failed to reset settings:', error);
      throw error;
    }
  },

  // Health check for diagnosis
  checkHealth: async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${SERVER_URL}/api/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('[PRELOAD] Health check failed:', error.message);
      return {
        status: 'error',
        message: error.name === 'AbortError' ? '连接超时' : error.message
      };
    }
  },

  // Select directory dialog for workspace sandbox
  selectDirectory: async () => {
    try {
      return await ipcRenderer.invoke('selectDirectory');
    } catch (error) {
      console.error('[PRELOAD] Failed to select directory:', error);
      throw error;
    }
  }
});
