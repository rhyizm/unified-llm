# Changelog

## [0.6.0] - 2025-09-12

### Breaking Changes
- Unified streaming migrated to an event-based streaming API (not backward compatible)
  - New stream event types: `start`, `text_delta`, `stop`, `error`
  - Each event mirrors `UnifiedChatResponse` and adds: `eventType`, `outputIndex`, and optional `delta`
  - Only text deltas are emitted; tool calls are executed provider-side during streaming (no tool_use deltas emitted)
  - Final `stop` event now includes `rawResponse` with provider-native data
    - OpenAI Chat Completions / DeepSeek / Anthropic: array of native stream chunks
    - OpenAI Responses API: final response object
    - Google Gemini: `{ stream, response }` (all stream chunks and the final response)
    - Azure OpenAI: follows OpenAI Chat Completions behavior

### Changed
- README updated to document the new streaming event model and usage
- Providers now populate `rawResponse` on the final `stop` event directly
- `LLMClient.stream()` delegates rawResponse handling to providers (no post-processing in client)

### Migration Guide
Replace legacy streaming loops that inspected `chunk.message.content` with event-driven handling:

```ts
let acc = '';
for await (const ev of client.stream(request)) {
  switch (ev.eventType) {
    case 'text_delta':
      process.stdout.write(ev.delta?.text ?? '');
      acc = ev.text; // accumulated text
      break;
    case 'stop':
      console.log('final:', ev.text);
      // ev.rawResponse contains provider-native final data
      break;
  }
}
```

Notes:
- Tool calls during streaming are handled provider-side; only the final assistant text is streamed to you
- `finish_reason` and `usage` may appear on the final `stop` event when provided by the upstream API
- Inspect `ev.rawResponse` on `stop` for provider-specific details (shape differs per provider, see above)

## [0.4.0] - 2025-07-09

### Breaking Changes
- **Removed all persistence features**: The library is now in-memory only
  - Removed SQLite database support
  - Removed Drizzle ORM integration
  - Removed `ClientRepository` and `ThreadRepository`
  - Removed all database-related methods from `LLMClient` class:
    - `fromSaved()`, `save()`, `list()`, `getConfig()`, `findByName()`, 
    - `update()`, `delete()`, `hardDelete()`, `saveConfiguration()`
  - Simplified `Thread` class to in-memory only operation
  - Simplified `ClientManager` - now only provides preset configurations

### Changed
- Updated package description to indicate in-memory operation
- `ClientManager.createFromPreset()` now requires `apiKey` as a parameter
- Removed all database-related dependencies:
  - `@libsql/client`
  - `drizzle-orm`
  - `@types/better-sqlite3` (dev)
  - `drizzle-kit` (dev)

### Fixed
- Resolved webpack/turbopack build errors caused by `@libsql/client` attempting to parse non-JS files

### Migration Guide
If you were using persistence features:
1. Remove any database initialization code
2. Replace `LLMClient.fromSaved()` with direct `new LLMClient()` calls
3. Replace `ClientManager` database operations with preset configurations
4. Store any needed state in your own persistence layer

## [0.3.2] - Previous Version
- Initial public release with full persistence support
