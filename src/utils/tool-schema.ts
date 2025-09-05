// Utility helpers for tool parameter schema normalization
// Keep provider-specific requirements encapsulated here for maintainability.

export function normalizeToolParametersForAgents(parameters: any): any {
  // Start from a safe default
  const params = parameters && typeof parameters === 'object'
    ? { ...parameters }
    : { type: 'object', properties: {} };

  // Ensure object schema shape
  if (params.type !== 'object') {
    params.type = 'object';
  }

  if (!params.properties || typeof params.properties !== 'object') {
    params.properties = {};
  }

  // Disallow unknown keys unless explicitly allowed
  if (!('additionalProperties' in params)) {
    params.additionalProperties = false;
  }

  // Agents API requires `required` to be present and include every key in properties
  const propKeys = Object.keys(params.properties);
  const hasRequired = Array.isArray(params.required);
  const coversAll = hasRequired && propKeys.every((k) => params.required.includes(k));
  if (!hasRequired || !coversAll || params.required.length !== propKeys.length) {
    params.required = propKeys;
  }

  return params;
}

// Generic normalization used by Completion/Responses API tool definitions:
// - Keep the provided schema as-is, but ensure parameters.additionalProperties defaults to false
export function normalizeFunctionForCompletions(functionDef: any): any {
  if (!functionDef) return functionDef;
  const func = { ...functionDef };
  if (func.parameters && typeof func.parameters === 'object' && !('additionalProperties' in func.parameters)) {
    func.parameters = { ...func.parameters, additionalProperties: false };
  }
  return func;
}
