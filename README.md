# @unified-llm/core

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/%40unified-llm%2Fcore.svg)](https://badge.fury.io/js/%40unified-llm%2Fcore)

A unified interface for interacting with multiple Large Language Models (LLMs) including OpenAI, Anthropic, Google Gemini, DeepSeek, and Azure OpenAI, with local function execution capabilities and persistent conversation management.

## Features

- 🤖 **Multi-Provider Support** - OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Azure OpenAI
- 🔧 **Function Calling** - Execute local functions and integrate external tools
- 📊 **Structured Output** - Guaranteed JSON schema compliance across all providers
- 💬 **Conversation Persistence** - SQLite-based chat history and thread management

## Installation

```bash
npm install @unified-llm/core
```

## Quick Start

```typescript
import { LLMClient } from '@unified-llm/core';

// Create an LLM client
const gpt = new LLMClient({
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: 'You are a helpful assistant that answers concisely.'
});

const claude = new LLMClient({
  provider: 'anthropic', 
  model: 'claude-3-haiku-20240307',
  apiKey: process.env.ANTHROPIC_API_KEY,
  systemPrompt: 'You are a thoughtful assistant that provides detailed explanations.'
});

// Send a message using the chat method
const gptResponse = await gpt.chat({
  messages: [{
    id: '1',
    role: 'user',
    content: 'Hello, GPT!',
    createdAt: new Date()
  }]
});

// Send a message with Claude
const claudeResponse = await claude.chat({
  messages: [{
    id: '1',
    role: 'user',
    content: 'Hello, Claude!',
    createdAt: new Date()
  }]
});

// Returns responses in the same format
console.log(JSON.stringify(gptResponse, null, 2));
console.log(JSON.stringify(claudeResponse, null, 2));
```

## Streaming Responses

The streaming feature allows you to receive responses in real-time as they are generated, providing a better user experience for longer responses.

### Basic Streaming Example

```typescript
import { LLMClient } from '@unified-llm/core';

const client = new LLMClient({
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: 'You are a helpful assistant that answers questions in Japanese.',
});

const stream = await client.stream({
  messages: [
    {
      id: '1',
      role: 'user',
      content: 'What are some recommended tourist spots in Osaka?',
      createdAt: new Date()
    },
  ],
});

let fullResponse = '';

for await (const chunk of stream) {
  const content = chunk.message.content[0];
  if (content && typeof content !== 'string' && content.type === 'text') {
    fullResponse += content.text;
    console.log(content.text); // Print each chunk as it arrives
  }
}

console.log('Complete response:', fullResponse);
```

## Function Calling

The `defineTool` helper provides type safety for tool definitions, automatically inferring argument and return types from the handler function:

```typescript
import { LLMClient } from '@unified-llm/core';
import { defineTool } from '@unified-llm/core/tools';
import fs from 'fs/promises';

// Let AI read and analyze any file
const readFile = defineTool({
  type: 'function',
  function: {
    name: 'readFile',
    description: 'Read any text file',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Name of file to read' }
      },
      required: ['filename']
    }
  },
  handler: async (args: { filename: string }) => {
    const content = await fs.readFile(args.filename, 'utf8');
    return content;
  }
});

const client = new LLMClient({
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
  tools: [readFile]
});

// Create a sample log file for demo
await fs.writeFile('app.log', `
[ERROR] 2024-01-15 Database connection timeout
[WARN]  2024-01-15 Memory usage at 89%
[ERROR] 2024-01-15 Failed to authenticate user rhyizm
[ERROR] 2024-01-15 Database connection timeout
[INFO]  2024-01-15 Server restarted
`);

// Ask AI to analyze the log file
const response = await client.chat({
  messages: [{
    role: 'user',
    content: "Read app.log and tell me what's wrong with my application",
    createdAt: new Date()
  }]
});

console.log(response.message.content);
// AI will read the actual file and give you insights about the errors!
```

### Streaming with Function Calls

When using tools/functions, streaming will include both text content and function call information:

```typescript
import { LLMClient } from '@unified-llm/core';
import { defineTool } from '@unified-llm/core/tools';

const getWeather = defineTool({
  type: 'function',
  function: {
    name: 'getWeather',
    description: 'Get current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' }
      },
      required: ['location']
    }
  },
  handler: async (args: { location: string }) => {
    return `Weather in ${args.location}: Sunny, 27°C`;
  }
});

const client = new LLMClient({
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
  tools: [getWeather]
});

const stream = await client.stream({
  messages: [{
    id: '1',
    role: 'user',
    content: "What's the weather like in Tokyo?",
    createdAt: new Date()
  }]
});

for await (const chunk of stream) {
  if (chunk.message.content) {
    chunk.message.content.forEach(content => {
      if (content.type === 'text') {
        console.log('Text:', content.text);
      } else if (content.type === 'tool_use') {
        console.log('Tool called:', content.name, 'with args:', content.input);
      }
    });
  }
}
```

## Structured Output

Structured Output ensures that AI responses follow a specific JSON schema format across all supported providers. This is particularly useful for applications that need to parse and process AI responses programmatically.

### Basic Structured Output

```typescript
import { LLMClient, ResponseFormat } from '@unified-llm/core';

// Define the expected response structure
const weatherFormat = new ResponseFormat({
  name: 'weather_info',
  description: 'Weather information for a location',
  schema: {
    type: 'object',
    properties: {
      location: { type: 'string' },
      temperature: { type: 'number' },
      condition: { type: 'string' },
      humidity: { type: 'number' }
    },
    required: ['location', 'temperature', 'condition']
  }
});

const client = new LLMClient({
  provider: 'openai',
  model: 'gpt-4o-2024-08-06', // Structured output requires specific models
  apiKey: process.env.OPENAI_API_KEY
});

const response = await client.chat({
  messages: [{
    role: 'user',
    content: 'What is the weather like in Tokyo today?'
  }],
  generationConfig: {
    responseFormat: weatherFormat
  }
});

// Response will be guaranteed to follow the schema
console.log(JSON.parse(response.message.content[0].text));
// Output: { "location": "Tokyo", "temperature": 25, "condition": "Sunny", "humidity": 60 }
```

### Multi-Provider Structured Output

The same `ResponseFormat` works across all providers with automatic conversion:

```typescript
// Works with OpenAI (uses json_schema format internally)
const openaiClient = new LLMClient({
  provider: 'openai',
  model: 'gpt-4o-2024-08-06',
  apiKey: process.env.OPENAI_API_KEY
});

// Works with Google Gemini (uses responseSchema format internally)
const geminiClient = new LLMClient({
  provider: 'google',
  model: 'gemini-1.5-pro',
  apiKey: process.env.GOOGLE_API_KEY
});

// Works with Anthropic (uses prompt engineering internally)
const claudeClient = new LLMClient({
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-latest',
  apiKey: process.env.ANTHROPIC_API_KEY
});

const userInfoFormat = new ResponseFormat({
  name: 'user_profile',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
      email: { type: 'string' },
      interests: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['name', 'age', 'email']
  }
});

const request = {
  messages: [{ role: 'user', content: 'Create a sample user profile' }],
  generationConfig: { responseFormat: userInfoFormat }
};

// All three will return structured JSON in the same format
const openaiResponse = await openaiClient.chat(request);
const geminiResponse = await geminiClient.chat(request);
const claudeResponse = await claudeClient.chat(request);
```

### Pre-built Response Format Templates

The library provides convenient templates for common structured output patterns:

```typescript
import { ResponseFormats } from '@unified-llm/core';

// Key-value extraction
const contactFormat = ResponseFormats.keyValue(['name', 'email', 'phone']);

const contactResponse = await client.chat({
  messages: [{
    role: 'user',
    content: 'Extract contact info: John Doe, john@example.com, 555-1234'
  }],
  generationConfig: { responseFormat: contactFormat }
});

// Classification with confidence scores
const sentimentFormat = ResponseFormats.classification(['positive', 'negative', 'neutral']);

const sentimentResponse = await client.chat({
  messages: [{
    role: 'user',
    content: 'Analyze sentiment: "I absolutely love this new feature!"'
  }],
  generationConfig: { responseFormat: sentimentFormat }
});
// Returns: { "category": "positive", "confidence": 0.95 }

// List responses
const taskFormat = ResponseFormats.list({
  type: 'object',
  properties: {
    task: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    deadline: { type: 'string' }
  }
});

const taskResponse = await client.chat({
  messages: [{
    role: 'user',
    content: 'Create a task list for launching a mobile app'
  }],
  generationConfig: { responseFormat: taskFormat }
});
// Returns: { "items": [{ "task": "Design UI", "priority": "high", "deadline": "2024-02-01" }, ...] }
```

### Complex Nested Schemas

```typescript
const productReviewFormat = new ResponseFormat({
  name: 'product_review',
  schema: {
    type: 'object',
    properties: {
      rating: { type: 'number', minimum: 1, maximum: 5 },
      summary: { type: 'string' },
      pros: {
        type: 'array',
        items: { type: 'string' }
      },
      cons: {
        type: 'array',
        items: { type: 'string' }
      },
      recommendation: {
        type: 'object',
        properties: {
          wouldRecommend: { type: 'boolean' },
          targetAudience: { type: 'string' },
          alternatives: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    },
    required: ['rating', 'summary', 'pros', 'cons', 'recommendation']
  }
});

const reviewResponse = await client.chat({
  messages: [{
    role: 'user',
    content: 'Review this smartphone: iPhone 15 Pro - great camera, expensive, good battery life'
  }],
  generationConfig: { responseFormat: productReviewFormat }
});
```

### Provider-Specific Notes

- **OpenAI**: Supports native structured outputs with `gpt-4o-2024-08-06` and newer models
- **Google Gemini**: Uses `responseMimeType: 'application/json'` with `responseSchema`
- **Anthropic**: Uses prompt engineering to request JSON format responses
- **DeepSeek**: Similar to OpenAI, supports JSON mode

The `ResponseFormat` class automatically handles the conversion to each provider's specific format, ensuring consistent behavior across all supported LLMs.

## Multi-Provider Example

```typescript
import { LLMClient } from '@unified-llm/core';

// Create LLM clients for different providers
const gpt = new LLMClient({
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: 'You are a helpful assistant that answers concisely.'
});

const claude = new LLMClient({
  provider: 'anthropic', 
  model: 'claude-3-haiku-20240307',
  apiKey: process.env.ANTHROPIC_API_KEY,
  systemPrompt: 'You are a thoughtful assistant that provides detailed explanations.'
});

const gemini = new LLMClient({
  provider: 'google',
  model: 'gemini-2.0-flash',
  apiKey: process.env.GOOGLE_API_KEY,
  systemPrompt: 'You are a creative assistant that thinks outside the box.'
});

const deepseek = new LLMClient({
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  systemPrompt: 'You are a technical assistant specialized in coding.'
});

// Use the unified chat interface
const request = {
  messages: [{
    id: '1',
    role: 'user',
    content: 'What are your thoughts on AI?',
    createdAt: new Date()
  }]
};

// Each provider will respond according to their system prompt
const gptResponse = await gpt.chat(request);
const claudeResponse = await claude.chat(request);
const geminiResponse = await gemini.chat(request);
const deepseekResponse = await deepseek.chat(request);
```

### Multi-Provider Streaming

Streaming works consistently across all supported providers:

```typescript
const providers = [
  { name: 'OpenAI', provider: 'openai', model: 'gpt-4o-mini' },
  { name: 'Claude', provider: 'anthropic', model: 'claude-3-haiku-20240307' },
  { name: 'Gemini', provider: 'google', model: 'gemini-2.0-flash' },
  { name: 'DeepSeek', provider: 'deepseek', model: 'deepseek-chat' }
];

for (const config of providers) {
  const client = new LLMClient({
    provider: config.provider as any,
    model: config.model,
    apiKey: process.env[`${config.provider.toUpperCase()}_API_KEY`]
  });

  console.log(`\n--- ${config.name} Response ---`);
  const stream = await client.stream({
    messages: [{
      id: '1',
      role: 'user',
      content: 'Tell me a short story about AI.',
      createdAt: new Date()
    }]
  });

  for await (const chunk of stream) {
    const content = chunk.message.content[0];
    if (content && typeof content !== 'string' && content.type === 'text') {
      process.stdout.write(content.text); // Stream output without newlines
    }
  }
}
```

## Unified Response Format

All providers return responses in a consistent format, making it easy to switch between different LLMs:

### Chat Response Format

```typescript
{
  id: "chatcmpl-Blub8EgOvVaP7c3lxzmVF4TJpVCun",
  model: "gpt-4o-mini",
  provider: "openai",
  message: {
    id: "msg_1750758679093_r9hqdhfzh",
    role: "assistant",
    content: [
      {
        type: "text",
        text: "The author of this project is rhyizm."
      }
    ],
    createdAt: "2025-06-24T09:51:19.093Z"
  },
  usage: {
    inputTokens: 72,
    outputTokens: 10,
    totalTokens: 82
  },
  finishReason: "stop",
  createdAt: "2025-06-24T09:51:18.000Z",
  rawResponse: {
    /* Original response from the provider (as returned by OpenAI, Anthropic, Google, DeepSeek, etc.) */
  }
}
```

### Stream Response Format

Each streaming chunk follows the same unified format as regular responses:

```typescript
{
  id: "chatcmpl-example",
  model: "gpt-4o-mini", 
  provider: "openai",
  message: {
    id: "msg_example",
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Chunk of text..."
      }
    ],
    createdAt: "2025-01-01T00:00:00.000Z"
  },
  usage: {
    inputTokens: 50,
    outputTokens: 5,
    totalTokens: 55
  },
  finishReason: null, // "stop" on final chunk
  createdAt: "2025-01-01T00:00:00.000Z",
  rawResponse: {
    // Original response from the provider (as returned by OpenAI, Anthropic, Google, DeepSeek, etc.)
  }
}
```

Key benefits:
- **Consistent structure** across all providers (OpenAI, Anthropic, Google, DeepSeek, Azure)
- **Standardized content format** with type-based content blocks
- **Unified usage tracking** for token counting across providers
- **Provider identification** to know which service generated the response
- **Raw response access** for provider-specific features

## Persistent LLM Client Configuration

```typescript
import { LLMClient } from '@unified-llm/core';

// Save LLM client configuration
const savedClientId = await LLMClient.save({
  name: 'My AI Assistant',
  provider: 'openai',
  model: 'gpt-4o-mini',
  systemPrompt: 'You are a helpful coding assistant.',
  tags: ['development', 'coding'],
  isActive: true
});

// Load saved LLM client
const client = await LLMClient.fromSaved(
  savedClientId,
  process.env.OPENAI_API_KEY
);

// List all saved LLM clients
const clients = await LLMClient.list({
  provider: 'openai',
  includeInactive: false
});
```

## Azure OpenAI Example

Azure OpenAI requires a different initialization pattern compared to other providers:

```typescript
import { AzureOpenAIProvider } from '@unified-llm/core/providers/azure';

// Azure OpenAI uses a different constructor pattern
// First parameter: Azure-specific configuration
// Second parameter: Base options (apiKey, tools, etc.)
const azureOpenAI = new AzureOpenAIProvider(
  {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,        // Azure resource endpoint
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT!,   // Model deployment name
    apiVersion: '2024-10-21',  // Optional, defaults to 'preview'
    useV1: true                // Use /openai/v1 endpoint format
  },
  {
    apiKey: process.env.AZURE_OPENAI_KEY!,
    tools: []  // Optional tools
  }
);

// Compare with standard LLMClient initialization:
// const client = new LLMClient({
//   provider: 'openai',
//   model: 'gpt-4o-mini',
//   apiKey: process.env.OPENAI_API_KEY
// });

// Use it like any other provider
const response = await azureOpenAI.chat({
  messages: [{
    id: '1',
    role: 'user',
    content: 'Hello from Azure!',
    createdAt: new Date()
  }]
});
```

## Environment Variables

```env
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
GOOGLE_API_KEY=your-google-key
DEEPSEEK_API_KEY=your-deepseek-key
AZURE_OPENAI_KEY=your-azure-key  # For Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com  # For Azure OpenAI
AZURE_OPENAI_DEPLOYMENT=your-deployment-name  # For Azure OpenAI
UNIFIED_LLM_DB_PATH=./chat-history.db  # Optional custom DB path
```

## Supported Providers

| Provider | Models | Features |
|----------|---------|----------|
| **OpenAI** | GPT-4o, GPT-4o-mini, GPT-4, GPT-3.5 | Function calling, streaming, vision, structured output |
| **Anthropic** | Claude 3.5 (Sonnet), Claude 3 (Opus, Sonnet, Haiku) | Tool use, streaming, long context, structured output |
| **Google** | Gemini 2.0 Flash, Gemini 1.5 Pro/Flash | Function calling, multimodal, structured output |
| **DeepSeek** | DeepSeek-Chat, DeepSeek-Coder | Function calling, streaming, code generation, structured output |
| **Azure OpenAI** | GPT-4o, GPT-4, GPT-3.5 (via Azure deployments) | Function calling, streaming, structured output |

## API Methods

### Core Methods

```typescript
// Main chat method - returns complete response
await client.chat(request: UnifiedChatRequest)

// Streaming responses (returns async generator)
for await (const chunk of client.stream(request)) {
  console.log(chunk);
}
```

**Note:** Persistence methods are experimental; there is a possibility that they may be removed or moved to a separate package in the future.

### Persistence Methods

```typescript
// Save LLM client configuration
await LLMClient.save(config: LLMClientConfig)

// Load saved LLM client
await LLMClient.fromSaved(id: string, apiKey?: string)

// Get saved configuration
await LLMClient.getConfig(id: string)

// List saved LLM clients
await LLMClient.list(options?: { provider?: string, includeInactive?: boolean })

// Update configuration
await LLMClient.update(id: string, updates: Partial<LLMClientConfig>)

// Soft delete LLM client
await LLMClient.delete(id: string)
```

## Requirements

- Node.js 20 or higher
- TypeScript 5.4.5 or higher (for development)

## License

MIT - see [LICENSE](https://github.com/rhyizm/unified-llm/blob/main/LICENSE) for details.

## Links

- 🏠 [Homepage](https://github.com/rhyizm/unified-llm)
- 🐛 [Report Issues](https://github.com/rhyizm/unified-llm/issues)
- 💬 [Discussions](https://github.com/rhyizm/unified-llm/discussions)
