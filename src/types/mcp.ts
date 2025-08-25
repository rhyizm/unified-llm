export interface MCPServerConfig {
  type: 'stdio' | 'sse' | 'streamable_http';
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}