export interface IRequiresActionResponse {
  threadId: string;
  runId: string;
  action: '' | 'call_assistant' | 'submit_tool_outputs';
  function: string;
  arguments: string;
  result: string;
}