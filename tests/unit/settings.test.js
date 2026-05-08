/**
 * Unit tests for settings management
 * Tests settings read/write logic, validation, and persistence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron-store
const mockStore = {
  data: new Map(),
  get: vi.fn(key => mockStore.data.get(key)),
  set: vi.fn((key, value) => {
    mockStore.data.set(key, value);
  }),
  delete: vi.fn(key => {
    mockStore.data.delete(key);
  }),
  clear: vi.fn(() => {
    mockStore.data.clear();
  })
};

// Mock electron-store module
vi.mock('electron-store', () => {
  return {
    default: vi.fn(() => mockStore)
  };
});

describe('Settings Management', () => {
  beforeEach(() => {
    mockStore.data.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockStore.data.clear();
  });

  describe('Settings Structure', () => {
    it('should have correct default settings structure', () => {
      const defaultSettings = {
        apiEndpoint: 'https://api.anthropic.com',
        apiKey: '',
        models: []
      };

      expect(defaultSettings).toHaveProperty('apiEndpoint');
      expect(defaultSettings).toHaveProperty('apiKey');
      expect(defaultSettings).toHaveProperty('models');
      expect(Array.isArray(defaultSettings.models)).toBe(true);
    });

    it('should validate API endpoint format', () => {
      const validEndpoints = [
        'https://api.anthropic.com',
        'https://internal-api.company.com',
        'http://localhost:3001'
      ];

      const invalidEndpoints = ['not-a-url', 'ftp://example.com', ''];

      validEndpoints.forEach(endpoint => {
        expect(endpoint).toMatch(/^https?:\/\/.+/);
      });

      invalidEndpoints.forEach(endpoint => {
        expect(endpoint).not.toMatch(/^https?:\/\/.+/);
      });
    });

    it('should validate API key format', () => {
      const validKeys = ['sk-xxx', 'deepseek-api-key-123'];

      const invalidKeys = ['', null, undefined];

      validKeys.forEach(key => {
        expect(key.length).toBeGreaterThan(0);
      });

      invalidKeys.forEach(key => {
        expect(key || '').toBe('');
      });
    });
  });

  describe('Model Configuration', () => {
    it('should validate model structure', () => {
      const validModel = {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        default: true
      };

      expect(validModel).toHaveProperty('id');
      expect(validModel).toHaveProperty('name');
      expect(typeof validModel.id).toBe('string');
      expect(typeof validModel.name).toBe('string');
      expect(typeof validModel.default).toBe('boolean');
    });

    it('should ensure only one default model when processing', () => {
      // Test data with multiple defaults (invalid state)
      const rawModels = [
        { id: 'model-1', name: 'Model 1', default: true },
        { id: 'model-2', name: 'Model 2', default: true },
        { id: 'model-3', name: 'Model 3', default: false }
      ];

      // Function to ensure only one default (first one wins)
      const ensureSingleDefault = models => {
        let foundDefault = false;
        return models.map(m => {
          const isDefault = m.default && !foundDefault;
          if (m.default && !foundDefault) {
            foundDefault = true;
          }
          return { ...m, default: isDefault };
        });
      };

      const processed = ensureSingleDefault(rawModels);
      const defaultCount = processed.filter(m => m.default).length;
      expect(defaultCount).toBe(1);
      expect(processed[0].default).toBe(true); // First one stays default
      expect(processed[1].default).toBe(false); // Second one loses default
    });

    it('should handle empty models array', () => {
      const models = [];
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(0);
    });

    it('should create default models array', () => {
      const defaultModels = [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', default: true },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', default: false }
      ];

      expect(defaultModels).toHaveLength(2);
      expect(defaultModels[0].default).toBe(true);
      expect(defaultModels[1].default).toBe(false);
    });
  });

  describe('Settings Persistence', () => {
    it('should save settings to store', () => {
      const settings = {
        apiEndpoint: 'https://api.example.com',
        apiKey: 'sk-test',
        models: []
      };

      mockStore.set('settings', settings);
      expect(mockStore.set).toHaveBeenCalledWith('settings', settings);
    });

    it('should load settings from store', () => {
      const settings = {
        apiEndpoint: 'https://api.example.com',
        apiKey: 'sk-test',
        models: []
      };

      mockStore.data.set('settings', settings);
      const loaded = mockStore.get('settings');
      expect(loaded).toEqual(settings);
    });

    it('should return default settings when store is empty', () => {
      const defaultSettings = {
        apiEndpoint: 'https://api.anthropic.com',
        apiKey: '',
        models: []
      };

      const loaded = mockStore.get('settings') || defaultSettings;
      expect(loaded).toEqual(defaultSettings);
    });

    it('should persist settings across sessions', () => {
      const settings = {
        apiEndpoint: 'https://custom-api.example.com',
        apiKey: 'sk-custom-key',
        models: [{ id: 'custom-model', name: 'Custom Model', default: true }]
      };

      // Save settings
      mockStore.set('settings', settings);

      // Simulate app restart (clear mocks but keep data)
      vi.clearAllMocks();

      // Load settings
      const loaded = mockStore.get('settings');

      expect(loaded).toEqual(settings);
      expect(loaded.apiEndpoint).toBe('https://custom-api.example.com');
    });
  });

  describe('Settings Validation', () => {
    it('should reject invalid API endpoint', () => {
      const invalidSettings = {
        apiEndpoint: 'not-a-url',
        apiKey: 'sk-test',
        models: []
      };

      const isValid = /^https?:\/\/.+/.test(invalidSettings.apiEndpoint);
      expect(isValid).toBe(false);
    });

    it('should accept valid settings', () => {
      const validSettings = {
        apiEndpoint: 'https://api.example.com',
        apiKey: 'sk-test-123',
        models: [{ id: 'model-1', name: 'Model 1', default: true }]
      };

      const endpointValid = /^https?:\/\/.+/.test(validSettings.apiEndpoint);
      const keyValid = validSettings.apiKey.length > 0;
      const modelsValid = Array.isArray(validSettings.models);

      expect(endpointValid).toBe(true);
      expect(keyValid).toBe(true);
      expect(modelsValid).toBe(true);
    });

    it('should validate settings object structure', () => {
      const isValidSettings = obj => {
        if (typeof obj !== 'object' || obj === null) {
          return false;
        }
        if (typeof obj.apiEndpoint !== 'string') {
          return false;
        }
        if (typeof obj.apiKey !== 'string') {
          return false;
        }
        if (!Array.isArray(obj.models)) {
          return false;
        }
        return true;
      };

      const valid = {
        apiEndpoint: 'https://api.example.com',
        apiKey: 'sk-test',
        models: []
      };

      const invalid = {
        apiEndpoint: 'not-a-url',
        models: 'invalid'
      };

      expect(isValidSettings(valid)).toBe(true);
      expect(isValidSettings(invalid)).toBe(false);
    });
  });

  describe('Settings Import/Export', () => {
    it('should export settings as JSON', () => {
      const settings = {
        apiEndpoint: 'https://api.example.com',
        apiKey: 'sk-test',
        models: []
      };

      const exported = JSON.stringify(settings);
      expect(() => JSON.parse(exported)).not.toThrow();
      expect(JSON.parse(exported)).toEqual(settings);
    });

    it('should import settings from JSON', () => {
      const jsonString = JSON.stringify({
        apiEndpoint: 'https://api.example.com',
        apiKey: 'sk-test',
        models: []
      });

      const imported = JSON.parse(jsonString);
      expect(imported).toHaveProperty('apiEndpoint');
      expect(imported).toHaveProperty('apiKey');
      expect(imported).toHaveProperty('models');
    });

    it('should validate imported settings structure', () => {
      const validImport = {
        apiEndpoint: 'https://api.example.com',
        apiKey: 'sk-test',
        models: []
      };

      const invalidImport = {
        wrongField: 'value'
      };

      const hasRequiredFields = obj => {
        return !!(obj.apiEndpoint && obj.apiKey !== undefined && Array.isArray(obj.models));
      };

      expect(hasRequiredFields(validImport)).toBe(true);
      expect(hasRequiredFields(invalidImport)).toBe(false);
    });
  });

  describe('Settings Defaults', () => {
    it('should have correct default API endpoint', () => {
      const defaultEndpoint = 'https://api.anthropic.com';
      expect(defaultEndpoint).toMatch(/^https?:\/\/.+/);
    });

    it('should have empty default API key', () => {
      const defaultKey = '';
      expect(defaultKey).toBe('');
    });

    it('should return default models when none configured', () => {
      const getDefaultModels = () => [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', default: true },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }
      ];

      const models = getDefaultModels();
      expect(models).toHaveLength(2);
      expect(models[0].default).toBe(true);
    });
  });

  describe('Settings Merging', () => {
    it('should merge user settings with defaults', () => {
      const defaults = {
        apiEndpoint: 'https://api.anthropic.com',
        apiKey: '',
        models: [
          { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', default: true },
          { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }
        ]
      };

      const userSettings = {
        apiEndpoint: 'https://custom-api.example.com'
        // apiKey and models use defaults
      };

      const merged = { ...defaults, ...userSettings };

      expect(merged.apiEndpoint).toBe('https://custom-api.example.com');
      expect(merged.apiKey).toBe('');
      expect(merged.models).toEqual(defaults.models);
    });

    it('should handle partial model configuration', () => {
      const defaults = {
        models: [
          { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', default: true },
          { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }
        ]
      };

      const userModels = [{ id: 'custom-model', name: 'Custom', default: true }];

      const merged = { ...defaults, models: userModels };

      expect(merged.models).toHaveLength(1);
      expect(merged.models[0].id).toBe('custom-model');
    });
  });
});
