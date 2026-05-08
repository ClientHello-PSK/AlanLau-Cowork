/**
 * Unit tests for state module
 * Tests centralized state management and event subscriptions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appState, AppState } from '../../renderer/modules/state.js';

describe('AppState Class', () => {
  let state;

  beforeEach(() => {
    state = new AppState();
  });

  describe('Initial State', () => {
    it('should initialize with correct default values', () => {
      expect(state.isFirstMessage).toBe(true);
      expect(state.allChats).toEqual([]);
      expect(state.currentChatId).toBeNull();
      expect(state.todos).toEqual([]);
      expect(state.toolCalls).toEqual([]);
      expect(state.fileChanges).toEqual([]);
      expect(state.attachedFiles).toEqual([]);
      expect(state.selectedModel).toBe('deepseek-v4-flash');
      expect(state.thinkingMode).toBe('normal');
      expect(state.isWaitingForResponse).toBe(false);
      expect(state.currentRequestId).toBeNull();
    });

    it('should have empty listeners map', () => {
      expect(state._listeners).toBeInstanceOf(Map);
      expect(state._listeners.size).toBe(0);
    });
  });

  describe('resetSession', () => {
    it('should reset session state to defaults', () => {
      // Set some values first
      state.isFirstMessage = false;
      state.currentChatId = 'chat_123';
      state.todos = [{ id: 'todo_1' }];
      state.toolCalls = [{ id: 'tool_1' }];
      state.fileChanges = [{ name: 'file.js' }];
      state.attachedFiles = [{ name: 'attach.txt' }];

      state.resetSession();

      expect(state.isFirstMessage).toBe(true);
      expect(state.currentChatId).toBeNull();
      expect(state.todos).toEqual([]);
      expect(state.toolCalls).toEqual([]);
      expect(state.fileChanges).toEqual([]);
      expect(state.attachedFiles).toEqual([]);
    });

    it('should not reset other state properties', () => {
      state.selectedModel = 'gpt-4';
      state.thinkingMode = 'extended';
      state.isWaitingForResponse = true;

      state.resetSession();

      expect(state.selectedModel).toBe('gpt-4');
      expect(state.thinkingMode).toBe('extended');
      expect(state.isWaitingForResponse).toBe(true);
    });
  });

  describe('loadChat', () => {
    it('should load chat data into state', () => {
      const chat = {
        id: 'chat_456',
        title: 'Test Chat',
        todos: [{ id: 'todo_1', content: 'Task 1' }],
        toolCalls: [{ id: 'tool_1', name: 'Read' }],
        fileChanges: [{ name: 'file.js', type: 'added' }]
      };

      state.loadChat(chat);

      expect(state.currentChatId).toBe('chat_456');
      expect(state.isFirstMessage).toBe(false);
      expect(state.todos).toEqual(chat.todos);
      expect(state.toolCalls).toEqual(chat.toolCalls);
      expect(state.fileChanges).toEqual(chat.fileChanges);
    });

    it('should handle missing optional fields', () => {
      const chat = { id: 'chat_789' };

      state.loadChat(chat);

      expect(state.currentChatId).toBe('chat_789');
      expect(state.todos).toEqual([]);
      expect(state.toolCalls).toEqual([]);
      expect(state.fileChanges).toEqual([]);
    });
  });

  describe('addToolCall', () => {
    it('should add tool call to list', () => {
      const toolCall = { id: 'tool_1', name: 'Read', status: 'running' };

      state.addToolCall(toolCall);

      expect(state.toolCalls).toHaveLength(1);
      expect(state.toolCalls[0]).toEqual(toolCall);
    });

    it('should emit toolCallsChanged event', () => {
      const callback = vi.fn();
      state.on('toolCallsChanged', callback);

      state.addToolCall({ id: 'tool_1' });

      expect(callback).toHaveBeenCalledWith(state.toolCalls);
    });

    it('should add multiple tool calls', () => {
      state.addToolCall({ id: 'tool_1' });
      state.addToolCall({ id: 'tool_2' });
      state.addToolCall({ id: 'tool_3' });

      expect(state.toolCalls).toHaveLength(3);
    });
  });

  describe('updateToolCallStatus', () => {
    beforeEach(() => {
      state.addToolCall({ id: 'tool_1', name: 'Read', status: 'running' });
    });

    it('should update tool call status', () => {
      state.updateToolCallStatus('tool_1', 'success');

      expect(state.toolCalls[0].status).toBe('success');
    });

    it('should emit toolCallsChanged event', () => {
      const callback = vi.fn();
      state.on('toolCallsChanged', callback);
      callback.mockClear(); // Clear from addToolCall

      state.updateToolCallStatus('tool_1', 'error');

      expect(callback).toHaveBeenCalled();
    });

    it('should not modify anything for non-existent tool', () => {
      const callback = vi.fn();
      state.on('toolCallsChanged', callback);
      callback.mockClear();

      state.updateToolCallStatus('non_existent', 'success');

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('updateToolCallResult', () => {
    beforeEach(() => {
      state.addToolCall({ id: 'tool_1', name: 'Read', status: 'running', result: null });
    });

    it('should update tool call result', () => {
      state.updateToolCallResult('tool_1', 'file content');

      expect(state.toolCalls[0].result).toBe('file content');
    });

    it('should handle object results', () => {
      state.updateToolCallResult('tool_1', { success: true, data: [1, 2, 3] });

      expect(state.toolCalls[0].result).toEqual({ success: true, data: [1, 2, 3] });
    });

    it('should emit toolCallsChanged event', () => {
      const callback = vi.fn();
      state.on('toolCallsChanged', callback);
      callback.mockClear();

      state.updateToolCallResult('tool_1', 'result');

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('addFileChange', () => {
    it('should add file change to list', () => {
      const change = { name: 'file.js', path: '/src/file.js', type: 'added' };

      state.addFileChange(change);

      expect(state.fileChanges).toHaveLength(1);
      expect(state.fileChanges[0]).toEqual(change);
    });

    it('should emit fileChangesChanged event', () => {
      const callback = vi.fn();
      state.on('fileChangesChanged', callback);

      state.addFileChange({ name: 'file.js', type: 'modified' });

      expect(callback).toHaveBeenCalledWith(state.fileChanges);
    });
  });

  describe('Attached Files', () => {
    describe('addAttachedFile', () => {
      it('should add attached file', () => {
        const file = { name: 'doc.pdf', size: 1024 };

        const result = state.addAttachedFile(file);

        expect(result).toBe(true);
        expect(state.attachedFiles).toHaveLength(1);
        expect(state.attachedFiles[0]).toEqual(file);
      });

      it('should emit attachedFilesChanged event', () => {
        const callback = vi.fn();
        state.on('attachedFilesChanged', callback);

        state.addAttachedFile({ name: 'file.txt' });

        expect(callback).toHaveBeenCalledWith(state.attachedFiles);
      });

      it('should respect max limit of 5 files', () => {
        // Add 5 files
        for (let i = 1; i <= 5; i++) {
          state.addAttachedFile({ name: `file${i}.txt` });
        }

        // Try to add 6th file
        const result = state.addAttachedFile({ name: 'file6.txt' });

        expect(result).toBe(false);
        expect(state.attachedFiles).toHaveLength(5);
      });
    });

    describe('removeAttachedFile', () => {
      beforeEach(() => {
        state.addAttachedFile({ name: 'file1.txt' });
        state.addAttachedFile({ name: 'file2.txt' });
        state.addAttachedFile({ name: 'file3.txt' });
      });

      it('should remove file at specified index', () => {
        state.removeAttachedFile(1);

        expect(state.attachedFiles).toHaveLength(2);
        expect(state.attachedFiles[0].name).toBe('file1.txt');
        expect(state.attachedFiles[1].name).toBe('file3.txt');
      });

      it('should emit attachedFilesChanged event', () => {
        const callback = vi.fn();
        state.on('attachedFilesChanged', callback);
        callback.mockClear();

        state.removeAttachedFile(0);

        expect(callback).toHaveBeenCalled();
      });
    });

    describe('clearAttachedFiles', () => {
      it('should clear all attached files', () => {
        state.addAttachedFile({ name: 'file1.txt' });
        state.addAttachedFile({ name: 'file2.txt' });

        state.clearAttachedFiles();

        expect(state.attachedFiles).toEqual([]);
      });

      it('should emit attachedFilesChanged event', () => {
        const callback = vi.fn();
        state.addAttachedFile({ name: 'file.txt' });
        state.on('attachedFilesChanged', callback);
        callback.mockClear();

        state.clearAttachedFiles();

        expect(callback).toHaveBeenCalledWith([]);
      });
    });
  });

  describe('setWaitingState', () => {
    it('should set waiting state with request ID', () => {
      state.setWaitingState(true, 'req_123');

      expect(state.isWaitingForResponse).toBe(true);
      expect(state.currentRequestId).toBe('req_123');
    });

    it('should reset waiting state', () => {
      state.setWaitingState(true, 'req_123');
      state.setWaitingState(false);

      expect(state.isWaitingForResponse).toBe(false);
      expect(state.currentRequestId).toBeNull();
    });

    it('should emit waitingStateChanged event', () => {
      const callback = vi.fn();
      state.on('waitingStateChanged', callback);

      state.setWaitingState(true, 'req_456');

      expect(callback).toHaveBeenCalledWith({
        waiting: true,
        requestId: 'req_456'
      });
    });
  });

  describe('Event Subscription', () => {
    describe('on', () => {
      it('should register event listener', () => {
        const callback = vi.fn();

        state.on('toolCallsChanged', callback);

        expect(state._listeners.get('toolCallsChanged').has(callback)).toBe(true);
      });

      it('should return unsubscribe function', () => {
        const callback = vi.fn();

        const unsubscribe = state.on('toolCallsChanged', callback);
        unsubscribe();

        expect(state._listeners.get('toolCallsChanged').has(callback)).toBe(false);
      });

      it('should support multiple listeners for same event', () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();

        state.on('fileChangesChanged', callback1);
        state.on('fileChangesChanged', callback2);

        state.addFileChange({ name: 'file.js' });

        expect(callback1).toHaveBeenCalled();
        expect(callback2).toHaveBeenCalled();
      });

      it('should support different event types', () => {
        const toolCallback = vi.fn();
        const fileCallback = vi.fn();

        state.on('toolCallsChanged', toolCallback);
        state.on('fileChangesChanged', fileCallback);

        state.addToolCall({ id: 'tool_1' });

        expect(toolCallback).toHaveBeenCalled();
        expect(fileCallback).not.toHaveBeenCalled();
      });
    });

    describe('_emit', () => {
      it('should call all registered listeners', () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();
        const callback3 = vi.fn();

        state.on('testEvent', callback1);
        state.on('testEvent', callback2);
        state.on('testEvent', callback3);

        state._emit('testEvent', 'test data');

        expect(callback1).toHaveBeenCalledWith('test data');
        expect(callback2).toHaveBeenCalledWith('test data');
        expect(callback3).toHaveBeenCalledWith('test data');
      });

      it('should handle event with no listeners', () => {
        expect(() => {
          state._emit('nonExistentEvent', 'data');
        }).not.toThrow();
      });
    });
  });
});

describe('appState Singleton', () => {
  it('should export a singleton instance', () => {
    expect(appState).toBeInstanceOf(AppState);
  });

  it('should be the same instance across imports', async () => {
    const { appState: appState2 } = await import('../../renderer/modules/state.js');
    expect(appState).toBe(appState2);
  });
});

describe('Edge Cases', () => {
  let state;

  beforeEach(() => {
    state = new AppState();
  });

  it('should handle unsubscribing during event emission', () => {
    let unsubscribe;
    const callback1 = vi.fn(() => {
      unsubscribe();
    });
    const callback2 = vi.fn();

    unsubscribe = state.on('toolCallsChanged', callback1);
    state.on('toolCallsChanged', callback2);

    // This should not throw
    expect(() => {
      state.addToolCall({ id: 'tool_1' });
    }).not.toThrow();

    expect(callback2).toHaveBeenCalled();
  });

  it('should handle rapid state updates', () => {
    const callback = vi.fn();
    state.on('toolCallsChanged', callback);

    for (let i = 0; i < 100; i++) {
      state.addToolCall({ id: `tool_${i}` });
    }

    expect(state.toolCalls).toHaveLength(100);
    expect(callback).toHaveBeenCalledTimes(100);
  });

  it('should maintain data integrity with concurrent operations', () => {
    state.addToolCall({ id: 'tool_1', status: 'running' });
    state.addToolCall({ id: 'tool_2', status: 'running' });

    state.updateToolCallStatus('tool_1', 'success');
    state.updateToolCallResult('tool_2', 'result');

    expect(state.toolCalls[0].status).toBe('success');
    expect(state.toolCalls[1].result).toBe('result');
  });
});
