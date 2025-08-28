export type OpenAILogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

const VALID_OPENAI_LOG_LEVELS: readonly OpenAILogLevel[] = ['debug', 'info', 'warn', 'error', 'off'] as const;

export function validateOpenAILogLevel(logLevel: string | undefined): OpenAILogLevel | undefined {
  if (!logLevel) {
    return undefined;
  }

  const normalizedLogLevel = logLevel.toLowerCase();
  
  if (VALID_OPENAI_LOG_LEVELS.includes(normalizedLogLevel as OpenAILogLevel)) {
    return normalizedLogLevel as OpenAILogLevel;
  }
  
  console.warn(
    `Invalid logLevel "${logLevel}" for OpenAI provider. Valid levels are: ${VALID_OPENAI_LOG_LEVELS.join(', ')}`
  );
  
  return undefined;
}