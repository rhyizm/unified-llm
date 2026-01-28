import dotenv from 'dotenv';
import { callGeminiAgent } from '../src/providers/google/gemini-agent.js';
import { Thread } from '../src/thread.js';

dotenv.config();

type OpenAiTool = {
  type: 'function';
  name: string;
  description?: string;
  parameters: unknown;
};

type LocalToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown>;

type ResponseLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  child?: (meta: Record<string, unknown>) => ResponseLogger;
};

type ProgressEvent = {
  type?: string;
  delta?: string;
  response?: {
    id?: string;
    status?: string;
  };
  response_id?: string;
};

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  throw new Error('GOOGLE_API_KEY (or GOOGLE_API_KEY/OPENAI_API_KEY) is missing.');
}

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/';
// const model = 'gemini-3-flash-preview:generateContent';
const model = 'gemini-3-flash-preview:streamGenerateContent?alt=sse';

const playwrightMcpServerUrl = process.env.PLAYWRIGHT_MCP_SERVER_URL;
if (!playwrightMcpServerUrl) {
  throw new Error('PLAYWRIGHT_MCP_SERVER_URL is missing.');
}

const logLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const allowedLogLevels = new Set(['debug', 'info', 'warn', 'error']);
if (!allowedLogLevels.has(logLevel)) {
  throw new Error('LOG_LEVEL must be one of debug, info, warn, error.');
}

const levelRank: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const logger: ResponseLogger = {
  debug: (msg, meta) => {
    if (levelRank.debug < levelRank[logLevel]) return;
    console.debug(msg, meta ?? {});
  },
  info: (msg, meta) => {
    if (levelRank.info < levelRank[logLevel]) return;
    console.info(msg, meta ?? {});
  },
  warn: (msg, meta) => {
    if (levelRank.warn < levelRank[logLevel]) return;
    console.warn(msg, meta ?? {});
  },
  error: (msg, meta) => {
    if (levelRank.error < levelRank[logLevel]) return;
    console.error(msg, meta ?? {});
  },
  child: (meta) => ({
    debug: (msg, more) => {
      if (levelRank.debug < levelRank[logLevel]) return;
      console.debug(msg, { ...meta, ...more });
    },
    info: (msg, more) => {
      if (levelRank.info < levelRank[logLevel]) return;
      console.info(msg, { ...meta, ...more });
    },
    warn: (msg, more) => {
      if (levelRank.warn < levelRank[logLevel]) return;
      console.warn(msg, { ...meta, ...more });
    },
    error: (msg, more) => {
      if (levelRank.error < levelRank[logLevel]) return;
      console.error(msg, { ...meta, ...more });
    },
  }),
};

const sseCallback = (() => {
  let deltaChars = 0;
  return (event: ProgressEvent) => {
    const type = typeof event?.type === 'string' ? event.type : 'unknown';
    if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
      deltaChars += event.delta.length;
      if (logLevel === 'debug') {
        logger.debug('gemini.delta', { deltaChars, sample: event.delta.slice(-80) });
      }
      return;
    }
    if (type === 'response.completed') {
      logger.info('gemini.completed', {
        responseId: event?.response?.id ?? event?.response_id,
        status: event?.response?.status,
      });
    }
  };
})();

const playwrightAllowedTools = [
  'browser_close',
  'browser_handle_dialog',
  'browser_file_upload',
  'browser_fill_form',
  'browser_install',
  'browser_press_key',
  'browser_type',
  'browser_navigate',
  'browser_navigate_back',
  'browser_network_requests',
  'browser_snapshot',
  'browser_click',
  'browser_drag',
  'browser_hover',
  'browser_select_option',
  'browser_tabs',
  'browser_wait_for',
];

const sendEmailTool: OpenAiTool = {
  type: 'function',
  name: 'send_email',
  description: 'Debug-only email tool. Stores payload and returns OK.',
  parameters: {
    type: 'object',
    properties: {
      html: { type: 'string', description: 'HTML body.' },
    },
    required: ['html'],
    additionalProperties: false,
  },
};

const localToolHandlers = new Map<string, LocalToolHandler>([
  [
    'send_email',
    async (args) => {
      const html =
        typeof args.html === 'string' ? args.html.slice(0, 1000) : '';
      logger.info('local.send_email', { htmlPreview: html });
      return { status: 200, message: 'OK (debug stub)' };
    },
  ],
]);

const baseInput = [
  {
    role: 'developer',
    content: [
      "「https://llmnews.ai/」にアクセスして、ランディングページの中から最新記事を10件ほど日本語でまとめて、記事個別のページへのページへのリンクと一緒にリストにして。そのリストを綺麗なHTML形式のメールで送信して。",
      "メール送信には「send_email」ツールを使用してください。メールの送信先はすでにツールの中で指定しているので、HTML Bodyだけをツールに渡してください。"
    ].join("\n"),
  },
  {
    role: 'user',
    content: [
      "「https://llmnews.ai/」にアクセスして、ランディングページの中から最新記事を10件ほど日本語でまとめて、記事個別のページへのページへのリンクと一緒にリストにして。そのリストを綺麗なHTML形式のメールで送信して。",
      "メール送信には「send_email」ツールを使用してください。メールの送信先はすでにツールの中で指定しているので、HTML Bodyだけをツールに渡してください。"
    ].join("\n"),
  },
];

const thread = new Thread();

const response = await callGeminiAgent({
  endpoint,
  model,
  apiKey,
  baseInput,
  thread,
  mcpServers: [
    {
      name: 'Playwright MCP',
      type: 'streamable_http',
      url: playwrightMcpServerUrl,
      allowedTools: playwrightAllowedTools,
    },
  ],
  localTools: {
    tools: [sendEmailTool],
    handlers: localToolHandlers,
  },
  config: {
    truncation: 'auto',
  },
  sseCallback,
  logger,
});

logger.info('gemini.response', {
  output: response.output,
  usage: response.usage,
});
