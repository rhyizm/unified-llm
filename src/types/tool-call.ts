export type OpenAIFunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};