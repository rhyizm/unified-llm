import { validateChatRequest, validateMessage, ValidationError } from '../src/utils/validation';
import { UnifiedChatRequest, Message } from '../src/types/unified-api';

describe('Validation', () => {
  describe('validateChatRequest', () => {
    it('should pass with valid request', () => {
      const request: UnifiedChatRequest = {
        messages: [
          {
            id: '1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
        ],
        model: 'test-model',
      };

      expect(() => validateChatRequest(request)).not.toThrow();
    });

    it('should throw when request is null', () => {
      expect(() => validateChatRequest(null as any)).toThrow(
        'Request must be a valid object'
      );
    });

    it('should throw when request is undefined', () => {
      expect(() => validateChatRequest(undefined as any)).toThrow(
        'Request must be a valid object'
      );
    });

    it('should throw when request is not an object', () => {
      expect(() => validateChatRequest('string' as any)).toThrow(
        'Request must be a valid object'
      );
    });

    it('should throw when messages is missing', () => {
      const request = { model: 'test' } as any;
      expect(() => validateChatRequest(request)).toThrow(
        'Messages must be an array in the request'
      );
    });

    it('should throw when messages is not an array', () => {
      const request = {
        messages: { role: 'user', content: 'test' },
        model: 'test',
      } as any;
      expect(() => validateChatRequest(request)).toThrow(
        'Messages must be an array in the request'
      );
    });

    it('should throw when messages array is empty', () => {
      const request: UnifiedChatRequest = {
        messages: [],
        model: 'test-model',
      };
      expect(() => validateChatRequest(request)).toThrow(
        'Messages array cannot be empty'
      );
    });
  });

  describe('validateMessage', () => {
    it('should pass with valid message', () => {
      const message: Message = {
        id: '1',
        role: 'user',
        content: 'Hello',
        created_at: new Date(),
      };
      expect(() => validateMessage(message, 0)).not.toThrow();
    });

    it('should throw when message is null', () => {
      expect(() => validateMessage(null as any, 0)).toThrow(
        'Message at index 0 must be a valid object'
      );
    });

    it('should throw when role is invalid', () => {
      const message = {
        id: '1',
        role: 'invalid',
        content: 'Hello',
        created_at: new Date(),
      } as any;
      expect(() => validateMessage(message, 0)).toThrow(
        'Message at index 0 has invalid role: invalid. Valid roles are: system, user, assistant, tool, function, developer'
      );
    });

    it('should throw when content is missing', () => {
      const message = {
        id: '1',
        role: 'user',
        created_at: new Date(),
      } as any;
      expect(() => validateMessage(message, 0)).toThrow(
        'Message at index 0 must have content'
      );
    });

    it('should throw when string content is empty', () => {
      const message: Message = {
        id: '1',
        role: 'user',
        content: '   ',
        created_at: new Date(),
      };
      expect(() => validateMessage(message, 0)).toThrow(
        'Message at index 0 cannot have empty content'
      );
    });

    it('should throw when content array is empty', () => {
      const message: Message = {
        id: '1',
        role: 'user',
        content: [],
        created_at: new Date(),
      };
      expect(() => validateMessage(message, 0)).toThrow(
        'Message at index 0 cannot have empty content array'
      );
    });

    it('should accept valid content array', () => {
      const message: Message = {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        created_at: new Date(),
      };
      expect(() => validateMessage(message, 0)).not.toThrow();
    });
  });

  describe('ValidationError', () => {
    it('should be instance of Error', () => {
      const error = new ValidationError('Test error');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Test error');
    });
  });
});