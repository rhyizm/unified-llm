/**
 * ResponseFormat class for unified structured output interface
 * Provides a consistent way to define structured output across different LLM providers
 */

export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  enum?: any[];
  [key: string]: any;
}

export interface ResponseFormatConfig {
  name: string;
  description?: string;
  schema: JsonSchema;
  strict?: boolean;
}

export class ResponseFormat {
  private config: ResponseFormatConfig;

  constructor(config: ResponseFormatConfig) {
    // Validate name format for OpenAI compatibility
    if (!/^[a-zA-Z0-9_-]+$/.test(config.name)) {
      throw new Error(
        `Invalid response format name: "${config.name}". ` +
        'Name must contain only letters, numbers, underscores, and hyphens (pattern: ^[a-zA-Z0-9_-]+$)'
      );
    }
    this.config = config;
  }

  /**
   * Convert to OpenAI's response_format structure
   */
  toOpenAI(): any {
    // OpenAI requires additionalProperties: false for strict mode
    const schema = this.ensureAdditionalPropertiesFalse(this.config.schema);
    
    return {
      type: 'json_schema',
      json_schema: {
        name: this.config.name,
        description: this.config.description,
        schema,
        strict: this.config.strict ?? true
      }
    };
  }

  /**
   * Convert to Google's responseSchema structure
   */
  toGoogle(): any {
    return {
      responseMimeType: 'application/json',
      responseSchema: this.convertToGoogleSchema(this.config.schema)
    };
  }

  /**
   * Convert to Anthropic's format using prompt engineering
   */
  toAnthropic(): any {
    const schemaString = JSON.stringify(this.config.schema, null, 2);
    return {
      type: 'json_object',
      schema: this.config.schema,
      promptSuffix: `\n\nAnalyze this feedback and output in JSON format with ${schemaString}`
    };
  }

  /**
   * Get the raw unified format
   */
  toUnified(): any {
    return {
      type: 'json_object',
      schema: this.config.schema
    };
  }

  /**
   * Add response format instruction to messages (for Anthropic)
   */
  addRequestSuffix(messages: any[]): any[] {
    const schemaString = JSON.stringify(this.config.schema, null, 2);
    const promptSuffix = `\n\nAnalyze this feedback and output in JSON format with ${schemaString}`;
    
    const result = [...messages];
    let lastUserMessageIndex = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }
    
    if (lastUserMessageIndex !== -1) {
      const lastMessage = result[lastUserMessageIndex];
      const lastTextContent = lastMessage.content.find((c: any) => c.type === 'text');
      
      if (lastTextContent) {
        result[lastUserMessageIndex] = {
          ...lastMessage,
          content: lastMessage.content.map((c: any) => 
            c.type === 'text' && c === lastTextContent 
              ? { ...c, text: c.text + promptSuffix }
              : c
          )
        };
      }
    }
    
    return result;
  }

  /**
   * Convert JSON Schema to Google's Schema format
   */
  private convertToGoogleSchema(schema: JsonSchema): any {
    const converted: any = {
      type: this.mapToGoogleType(schema.type)
    };

    if (schema.description) {
      converted.description = schema.description;
    }

    if (schema.type === 'object' && schema.properties) {
      converted.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        converted.properties[key] = this.convertToGoogleSchema(value);
      }
      if (schema.required) {
        converted.required = schema.required;
      }
    }

    if (schema.type === 'array' && schema.items) {
      converted.items = this.convertToGoogleSchema(schema.items);
    }

    if (schema.enum) {
      converted.enum = schema.enum;
    }

    return converted;
  }

  private mapToGoogleType(type: string): string {
    const typeMap: Record<string, string> = {
      'object': 'OBJECT',
      'array': 'ARRAY',
      'string': 'STRING',
      'number': 'NUMBER',
      'boolean': 'BOOLEAN',
      'null': 'NULL'
    };
    return typeMap[type] || 'STRING';
  }

  /**
   * Ensure all object schemas have additionalProperties: false for OpenAI compatibility
   */
  private ensureAdditionalPropertiesFalse(schema: JsonSchema): JsonSchema {
    const result = { ...schema };

    if (schema.type === 'object') {
      // Set additionalProperties to false if not explicitly set
      if (result.additionalProperties === undefined) {
        result.additionalProperties = false;
      }

      // Recursively apply to nested object properties
      if (schema.properties) {
        result.properties = {};
        for (const [key, value] of Object.entries(schema.properties)) {
          result.properties[key] = this.ensureAdditionalPropertiesFalse(value);
        }
      }
    }

    // Handle array items
    if (schema.type === 'array' && schema.items) {
      result.items = this.ensureAdditionalPropertiesFalse(schema.items);
    }

    return result;
  }
}

/**
 * Helper function to create a ResponseFormat instance
 */
export function createResponseFormat(config: ResponseFormatConfig): ResponseFormat {
  return new ResponseFormat(config);
}

/**
 * Pre-defined response format templates
 */
export const ResponseFormats = {
  /**
   * Simple key-value pair response
   */
  keyValue: (keys: string[]) => new ResponseFormat({
    name: 'key_value_response',
    schema: {
      type: 'object',
      properties: keys.reduce((acc, key) => ({
        ...acc,
        [key]: { type: 'string' }
      }), {}),
      required: keys,
      additionalProperties: false
    },
    strict: true
  }),

  /**
   * List of items
   */
  list: (itemSchema: JsonSchema) => new ResponseFormat({
    name: 'list_response',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: itemSchema
        }
      },
      required: ['items'],
      additionalProperties: false
    },
    strict: true
  }),

  /**
   * Classification response
   */
  classification: (categories: string[]) => new ResponseFormat({
    name: 'classification_response',
    schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: categories
        },
        confidence: {
          type: 'number'
        }
      },
      required: ['category', 'confidence'],
      additionalProperties: false
    },
    strict: true
  })
};