// src/providers/google/sanitizeJsonSchema.ts
/**
 * OpenAI StructuredOutput(format.json_schema) 由来の JSON Schema を
 * Gemini の responseJsonSchema / parametersJsonSchema 向けに “安全側” で正規化する。
 */
export function sanitizeJsonSchema(schema: unknown): unknown {
  return sanitize(schema, "schema");
}

type SanitizeCtx = "schema" | "map";

/**
 * Geminiの parametersJsonSchema / responseJsonSchema 向けに JSON Schema を正規化。
 * 重要:
 * - schemaコンテキスト: JSON Schemaキーワードのみ許可して落とす
 * - mapコンテキスト: properties/$defs のように任意キーを保持し、値だけ sanitize
 */
function sanitize(schema: unknown, ctx: SanitizeCtx): unknown {
  // primitives
  if (schema === null) return null;
  if (typeof schema !== "object") return schema;

  // arrays
  if (Array.isArray(schema)) {
    return schema.map((x) => sanitize(x, "schema"));
  }

  const s = schema as Record<string, any>;

  // properties/$defs/defs のような「任意キーの辞書」はキーを保持する
  if (ctx === "map") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(s)) {
      out[k] = sanitize(v, "schema");
    }
    return out;
  }

  // schema 本体（キーワードだけ残す）
  const ALLOWED = new Set([
    "$defs",
    "$ref",
    "additionalProperties",
    "anyOf",
    "description",
    "enum",
    "example",
    "format",
    "items",
    "maxItems",
    "maxLength",
    "maxProperties",
    "maximum",
    "minItems",
    "minLength",
    "minProperties",
    "minimum",
    "nullable",
    "pattern",
    "prefixItems",
    "properties",
    "propertyOrdering",
    "required",
    "title",
    "type",
  ]);

  const out: Record<string, any> = {};

  // ---- alias/normalize
  // definitions -> $defs
  const defs = s.$defs ?? s.definitions;
  if (defs !== undefined) out.$defs = sanitize(defs, "map");

  // oneOf -> anyOf (Gemini側の受け口優先)
  const anyOf = s.anyOf ?? s.oneOf;
  if (anyOf !== undefined) out.anyOf = sanitize(anyOf, "schema");

  // const -> enum
  if (s.const !== undefined && s.enum === undefined) {
    out.enum = [s.const];
  }

  // type: ["string","null"] -> { type:"string", nullable:true }
  if (Array.isArray(s.type)) {
    const types = s.type;
    const nonNull = types.filter((t: any) => t !== "null");
    if (nonNull.length === 1) {
      out.type = nonNull[0];
      if (types.includes("null")) out.nullable = true;
    } else if (nonNull.length > 1) {
      out.anyOf = nonNull.map((t: any) => ({ type: t }));
      if (types.includes("null")) out.nullable = true;
    }
  }

  // ---- copy allowed keys
  for (const [k, v] of Object.entries(s)) {
    if (k === "$schema") continue;
    if (k === "definitions" || k === "oneOf" || k === "const") continue;
    if (k === "type" && Array.isArray(v)) continue; // handled above
    if (!ALLOWED.has(k)) continue;

    if (k === "properties") {
      out.properties = sanitize(v, "map");
      continue;
    }
    if (k === "$defs") {
      out.$defs = sanitize(v, "map");
      continue;
    }
    if (k === "additionalProperties") {
      out.additionalProperties =
        typeof v === "boolean" ? v : sanitize(v, "schema");
      continue;
    }
    if (k === "items") {
      out.items = sanitize(v, "schema");
      continue;
    }
    if (k === "prefixItems") {
      out.prefixItems = Array.isArray(v)
        ? v.map((x: any) => sanitize(x, "schema"))
        : sanitize(v, "schema");
      continue;
    }
    if (k === "anyOf") {
      out.anyOf = Array.isArray(v)
        ? v.map((x: any) => sanitize(x, "schema"))
        : sanitize(v, "schema");
      continue;
    }

    // scalar / arrays of scalars etc.
    out[k] = sanitize(v, "schema");
  }

  // ---- Safety net:
  // Gemini側は required が properties に存在しないと弾くため整合させる :contentReference[oaicite:2]{index=2}
  if (Array.isArray(out.required)) {
    const req = out.required.filter((x: any) => typeof x === "string");

    const props =
      out.properties && typeof out.properties === "object" && !Array.isArray(out.properties)
        ? (out.properties as Record<string, any>)
        : {};
    out.properties = props;

    for (const name of req) {
      if (props[name] === undefined) {
        // additionalProperties が schema ならそれを流用、なければ "any" 扱い
        if (out.additionalProperties && typeof out.additionalProperties === "object") {
          props[name] = out.additionalProperties;
        } else {
          props[name] = {};
        }
      }
    }

    out.required = req;
  }

  return out;
}
