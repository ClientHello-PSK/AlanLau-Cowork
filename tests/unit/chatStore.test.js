/**
 * Unit tests for chatStore module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createChatData,
  findChatById,
  updateChatInList,
  removeChatById,
  sortChatsByTime,
  saveChatToStorage,
  loadChatsFromStorage
} from '../../renderer/chatStore.js';

describe('createChatData', () => {
  it('should create a chat data object with all properties', () => {
    const chat = createChatData('chat_123', 'Test Chat', [], [], []);

    expect(chat.id).toBe('chat_123');
    expect(chat.title).toBe('Test Chat');
    expect(chat.messages).toEqual([]);
    expect(chat.todos).toEqual([]);
    expect(chat.toolCalls).toEqual([]);
    expect(typeof chat.updatedAt).toBe('number');
  });

  it('should use default title if not provided', () => {
    const chat = createChatData('chat_123', null);
    expect(chat.title).toBe('New chat');
  });

  it('should use empty arrays as defaults', () => {
    const chat = createChatData('chat_123', 'Title');
    expect(chat.messages).toEqual([]);
    expect(chat.todos).toEqual([]);
    expect(chat.toolCalls).toEqual([]);
  });
});

describe('findChatById', () => {
  const mockChats = [
    { id: 'chat_1', title: 'Chat 1' },
    { id: 'chat_2', title: 'Chat 2' },
    { id: 'chat_3', title: 'Chat 3' }
  ];

  it('should find a chat by ID', () => {
    const result = findChatById(mockChats, 'chat_2');
    expect(result).toEqual({ id: 'chat_2', title: 'Chat 2' });
  });

  it('should return undefined for non-existent ID', () => {
    const result = findChatById(mockChats, 'chat_999');
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    const result = findChatById([], 'chat_1');
    expect(result).toBeUndefined();
  });

  it('should handle null/undefined inputs', () => {
    expect(findChatById(null, 'chat_1')).toBeUndefined();
    expect(findChatById(mockChats, null)).toBeUndefined();
    expect(findChatById(undefined, undefined)).toBeUndefined();
  });
});

describe('updateChatInList', () => {
  it('should update existing chat', () => {
    const chats = [
      { id: 'chat_1', title: 'Old Title' },
      { id: 'chat_2', title: 'Chat 2' }
    ];
    const updatedChat = { id: 'chat_1', title: 'New Title' };

    const result = updateChatInList(chats, updatedChat);

    expect(result[0].title).toBe('New Title');
    expect(result.length).toBe(2);
  });

  it('should add new chat to the beginning', () => {
    const chats = [{ id: 'chat_1', title: 'Chat 1' }];
    const newChat = { id: 'chat_2', title: 'Chat 2' };

    const result = updateChatInList(chats, newChat);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe('chat_2');
  });

  it('should not mutate original array', () => {
    const chats = [{ id: 'chat_1', title: 'Chat 1' }];
    const newChat = { id: 'chat_2', title: 'Chat 2' };

    updateChatInList(chats, newChat);

    expect(chats.length).toBe(1);
  });

  it('should handle invalid inputs', () => {
    expect(updateChatInList(null, { id: 'chat_1' })).toEqual([]);
    expect(updateChatInList([], null)).toEqual([]);
    expect(updateChatInList([], { title: 'No ID' })).toEqual([]);
  });
});

describe('removeChatById', () => {
  it('should remove chat by ID', () => {
    const chats = [
      { id: 'chat_1', title: 'Chat 1' },
      { id: 'chat_2', title: 'Chat 2' }
    ];

    const result = removeChatById(chats, 'chat_1');

    expect(result.length).toBe(1);
    expect(result[0].id).toBe('chat_2');
  });

  it('should return same array if ID not found', () => {
    const chats = [{ id: 'chat_1', title: 'Chat 1' }];

    const result = removeChatById(chats, 'chat_999');

    expect(result.length).toBe(1);
  });

  it('should not mutate original array', () => {
    const chats = [{ id: 'chat_1', title: 'Chat 1' }];

    removeChatById(chats, 'chat_1');

    expect(chats.length).toBe(1);
  });

  it('should handle invalid inputs', () => {
    expect(removeChatById(null, 'chat_1')).toEqual([]);
    expect(removeChatById([], null)).toEqual([]);
  });
});

describe('sortChatsByTime', () => {
  it('should sort chats by updatedAt descending', () => {
    const chats = [
      { id: 'chat_1', updatedAt: 1000 },
      { id: 'chat_2', updatedAt: 3000 },
      { id: 'chat_3', updatedAt: 2000 }
    ];

    const result = sortChatsByTime(chats);

    expect(result[0].id).toBe('chat_2');
    expect(result[1].id).toBe('chat_3');
    expect(result[2].id).toBe('chat_1');
  });

  it('should not mutate original array', () => {
    const chats = [
      { id: 'chat_1', updatedAt: 1000 },
      { id: 'chat_2', updatedAt: 2000 }
    ];

    sortChatsByTime(chats);

    expect(chats[0].id).toBe('chat_1');
  });

  it('should handle missing updatedAt', () => {
    const chats = [{ id: 'chat_1' }, { id: 'chat_2', updatedAt: 1000 }];

    const result = sortChatsByTime(chats);

    expect(result[0].id).toBe('chat_2');
  });

  it('should handle invalid input', () => {
    expect(sortChatsByTime(null)).toEqual([]);
    expect(sortChatsByTime(undefined)).toEqual([]);
  });
});

describe('saveChatToStorage', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = {
      setItem: vi.fn(),
      removeItem: vi.fn()
    };
  });

  it('should save chats to storage', () => {
    const chats = [{ id: 'chat_1', title: 'Chat 1' }];

    saveChatToStorage(mockStorage, chats, 'chat_1');

    expect(mockStorage.setItem).toHaveBeenCalledWith('allChats', JSON.stringify(chats));
    expect(mockStorage.setItem).toHaveBeenCalledWith('currentChatId', 'chat_1');
  });

  it('should remove currentChatId if null', () => {
    saveChatToStorage(mockStorage, [], null);

    expect(mockStorage.removeItem).toHaveBeenCalledWith('currentChatId');
  });

  it('should handle null storage gracefully', () => {
    expect(() => saveChatToStorage(null, [], 'chat_1')).not.toThrow();
  });
});

describe('loadChatsFromStorage', () => {
  it('should load chats from storage', () => {
    const mockStorage = {
      getItem: vi.fn(key => {
        if (key === 'allChats') {
          return JSON.stringify([{ id: 'chat_1' }]);
        }
        if (key === 'currentChatId') {
          return 'chat_1';
        }
        return null;
      })
    };

    const result = loadChatsFromStorage(mockStorage);

    expect(result.allChats).toEqual([{ id: 'chat_1' }]);
    expect(result.currentChatId).toBe('chat_1');
  });

  it('should return empty array if no saved chats', () => {
    const mockStorage = {
      getItem: vi.fn(() => null)
    };

    const result = loadChatsFromStorage(mockStorage);

    expect(result.allChats).toEqual([]);
    expect(result.currentChatId).toBeNull();
  });

  it('should handle null storage', () => {
    const result = loadChatsFromStorage(null);

    expect(result.allChats).toEqual([]);
    expect(result.currentChatId).toBeNull();
  });

  it('should handle invalid JSON gracefully', () => {
    const mockStorage = {
      getItem: vi.fn(() => 'invalid json')
    };

    const result = loadChatsFromStorage(mockStorage);

    expect(result.allChats).toEqual([]);
  });
});

