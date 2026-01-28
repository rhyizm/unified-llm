import dotenv from 'dotenv';
import { callGeminiAgent } from '../src/providers/google/gemini-agent.js';
import { callResponsesApiAgent } from '../src/providers/openai/responses-api-agent.js';
import type { OpenAiTool } from '../src/utils/mcp/mcp-tool-catalog.js';
import type { LocalToolHandler } from '../src/utils/tools/execute-tool-calls.js';

dotenv.config();

// const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/';
// const apiKey = process.env.GOOGLE_API_KEY;
// const model = 'gemini-3-flash-preview:generateContent';
// const model = 'gemini-3-flash-preview:streamGenerateContent?alt=sse';

const endpoint = process.env.AZURE_OPENAI_ENDPOINT || 'https://api.openai.com/v1/responses';
const apiKey = process.env.AZURE_OPENAI_KEY;
const model = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5-mini';

if (!apiKey) {
  throw new Error('Missing GOOGLE_API_KEY (or GOOGLE_API_KEY/OPENAI_API_KEY).');
}

const base = endpoint.trim().endsWith('/') ? endpoint.trim() : `${endpoint.trim()}/`;
const encodedUrl = `${base}${encodeURIComponent(model)}`;

let rawUrl = base;
if (model.startsWith('gemini-')) {
  rawUrl = `${base}${model}`;
}

console.log('agent.debug.endpoint', {
  endpoint,
  model,
  encodedUrl,
  rawUrl,
});

const baseInput = [
  {
    role: 'system',
    content:
      [
        '個人情報をダミーに置換し、items は文章中の出現順で並べてください。items の position/length は calc_positions ツールの結果を必ず使ってください。',
        '名前は「ダミー今泉」、電話番号は「01-2345-6789」、住所は「東京都千代田区1-1-1」、郵便番号は「123-4567」置換してください。',
        'その他の個人情報も同様にダミー値に置換してください。',
      ].join('\n'),
  },
  {
    role: 'user',
    content:
      [
        '今泉の住所は「989-1606宮城県柴田郡柴田町船岡清住町26-6」で、電話番号は08043458896です。',
      ].join('\n'),
  },
];

const structuredOutput = {
  format: {
    type: 'json_schema',
    name: 'pii_redaction_result',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        originalText: {
          type: 'string',
          minLength: 1,
        },
        redactedText: {
          type: 'string',
          minLength: 1,
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              original: {
                type: 'string',
                minLength: 1,
              },
              redacted: {
                type: 'string',
                minLength: 1,
              },
              position: {
                type: 'integer',
                minimum: 0,
              },
              length: {
                type: 'integer',
                minimum: 1,
              },
            },
            required: ['original', 'redacted', 'position', 'length'],
          },
        },
      },
      required: ['originalText', 'redactedText', 'items'],
    },
  },
} as const;

const calcPositionsTool: OpenAiTool = {
  type: 'function',
  name: 'calc_positions',
  description:
    'Given original text and replacement items, compute position and length for each original string.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      originalText: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            original: { type: 'string' },
            redacted: { type: 'string' },
          },
          required: ['original', 'redacted'],
        },
      },
    },
    required: ['originalText', 'items'],
  },
};

const calcPositionsHandler: LocalToolHandler = async (args) => {
  const originalText = typeof args.originalText === 'string' ? args.originalText : '';
  const items = Array.isArray(args.items) ? args.items : [];
  if (!originalText || items.length === 0) {
    throw new Error('calc_positions requires originalText and items.');
  }

  let searchFrom = 0;
  const results = items.map((item) => {
    const original = typeof item?.original === 'string' ? item.original : '';
    const redacted = typeof item?.redacted === 'string' ? item.redacted : '';
    if (!original) {
      throw new Error('calc_positions item.original is required.');
    }
    const position = originalText.indexOf(original, searchFrom);
    if (position === -1) {
      throw new Error(`calc_positions could not find "${original}" in originalText.`);
    }
    const length = original.length;
    searchFrom = position + length;
    return { original, redacted, position, length };
  });

  return { items: results };
};

const localTools = {
  tools: [calcPositionsTool],
  handlers: new Map<string, LocalToolHandler>([
    ['calc_positions', calcPositionsHandler],
  ]),
};

/*
  ローカルツールで文字位置を計算する場合の schema 例（items[*].position を差し替え）
  position: {
    type: 'object',
    additionalProperties: false,
    properties: {
      start: { type: 'integer', minimum: 0 },
      end: { type: 'integer', minimum: 0 },
    },
    required: ['start', 'end'],
  }
*/

try {
  const response = await callResponsesApiAgent({
    model,
    endpoint,
    apiKey,
    baseInput,
    structuredOutput,
    localTools,
  });

  console.log('agent.debug.output', `「${response.output}」`);
  console.log('agent.debug.usage', response.usage);
} catch (error) {
  console.error('agent.debug.error', error);
}
