/**
 * Chat Store - 聊天状态管理模块
 * 提供聊天数据的纯函数操作，不依赖 DOM 或 localStorage
 */

/**
 * 创建聊天数据对象
 * @param {string} id - 聊天 ID
 * @param {string} title - 聊天标题
 * @param {Array} messages - 消息列表
 * @param {Array} todos - 待办事项列表
 * @param {Array} toolCalls - 工具调用列表
 * @param {Array} fileChanges - 文件变更列表
 * @returns {object} 聊天数据对象
 */
export function createChatData(
  id,
  title,
  messages = [],
  todos = [],
  toolCalls = [],
  fileChanges = []
) {
  return {
    id,
    title: title || 'New chat',
    messages,
    todos,
    toolCalls,
    fileChanges,
    updatedAt: Date.now()
  };
}

/**
 * 根据 ID 查找聊天
 * @param {Array} allChats - 所有聊天列表
 * @param {string} chatId - 要查找的聊天 ID
 * @returns {object|undefined} 找到的聊天对象或 undefined
 */
export function findChatById(allChats, chatId) {
  if (!Array.isArray(allChats) || !chatId) {
    return undefined;
  }
  return allChats.find(c => c.id === chatId);
}

/**
 * 更新聊天列表中的聊天数据
 * @param {Array} allChats - 所有聊天列表
 * @param {object} chatData - 要更新的聊天数据
 * @param {boolean} preserveUpdatedAt - 是否保留原有的 updatedAt（默认 false，会更新为当前时间）
 * @returns {Array} 更新后的聊天列表（新数组）
 */
export function updateChatInList(allChats, chatData, preserveUpdatedAt = false) {
  if (!Array.isArray(allChats) || !chatData || !chatData.id) {
    return allChats || [];
  }

  const index = allChats.findIndex(c => c.id === chatData.id);
  const newChats = [...allChats];

  if (index >= 0) {
    const existingChat = allChats[index];
    const updatedAt =
      preserveUpdatedAt && existingChat?.updatedAt ? existingChat.updatedAt : Date.now();
    newChats[index] = { ...chatData, updatedAt };
  } else {
    // 添加到开头
    newChats.unshift({ ...chatData, updatedAt: Date.now() });
  }

  return newChats;
}

/**
 * 从聊天列表中删除指定聊天
 * @param {Array} allChats - 所有聊天列表
 * @param {string} chatId - 要删除的聊天 ID
 * @returns {Array} 删除后的聊天列表（新数组）
 */
export function removeChatById(allChats, chatId) {
  if (!Array.isArray(allChats) || !chatId) {
    return allChats || [];
  }
  return allChats.filter(c => c.id !== chatId);
}

/**
 * 按更新时间排序聊天列表（最新在前）
 * @param {Array} allChats - 所有聊天列表
 * @returns {Array} 排序后的聊天列表（新数组）
 */
export function sortChatsByTime(allChats) {
  if (!Array.isArray(allChats)) {
    return [];
  }
  return [...allChats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * 保存聊天数据到存储
 * @param {object} storage - 存储对象（如 localStorage）
 * @param {Array} allChats - 所有聊天列表
 * @param {string|null} currentChatId - 当前聊天 ID
 */
export function saveChatToStorage(storage, allChats, currentChatId) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem('allChats', JSON.stringify(allChats || []));
    if (currentChatId) {
      storage.setItem('currentChatId', currentChatId);
    } else {
      storage.removeItem('currentChatId');
    }
  } catch (err) {
    console.error('Failed to save chats:', err);
  }
}

/**
 * 从存储加载聊天数据
 * @param {object} storage - 存储对象（如 localStorage）
 * @returns {object} { allChats, currentChatId }
 */
export function loadChatsFromStorage(storage) {
  if (!storage) {
    return { allChats: [], currentChatId: null };
  }

  try {
    const saved = storage.getItem('allChats');
    const allChats = saved ? JSON.parse(saved) : [];
    const currentChatId = storage.getItem('currentChatId') || null;
    return { allChats, currentChatId };
  } catch (err) {
    console.error('Failed to load chats:', err);
    return { allChats: [], currentChatId: null };
  }
}

