import { UnifiedChatRequest, Message } from '../types/unified-api';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateChatRequest(request: UnifiedChatRequest): void {
  if (!request || typeof request !== 'object') {
    throw new ValidationError('Request must be a valid object');
  }

  if (!request.messages || !Array.isArray(request.messages)) {
    throw new ValidationError('Messages must be an array in the request');
  }

  if (request.messages.length === 0) {
    throw new ValidationError('Messages array cannot be empty');
  }

  request.messages.forEach((msg, index) => {
    validateMessage(msg, index);
  });
}

export function validateMessage(message: Message, index: number): void {
  if (!message || typeof message !== 'object') {
    throw new ValidationError(`Message at index ${index} must be a valid object`);
  }

  const validRoles = ['system', 'user', 'assistant', 'tool', 'function', 'developer'];
  if (!message.role || !validRoles.includes(message.role)) {
    throw new ValidationError(`Message at index ${index} has invalid role: ${message.role}. Valid roles are: ${validRoles.join(', ')}`);
  }

  if (message.content === undefined || message.content === null) {
    throw new ValidationError(`Message at index ${index} must have content`);
  }

  if (typeof message.content === 'string' && message.content.trim() === '') {
    throw new ValidationError(`Message at index ${index} cannot have empty content`);
  }

  if (Array.isArray(message.content) && message.content.length === 0) {
    throw new ValidationError(`Message at index ${index} cannot have empty content array`);
  }
}