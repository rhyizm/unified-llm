# Changelog

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