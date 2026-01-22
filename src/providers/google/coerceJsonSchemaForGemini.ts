const GEMINI_JSON_SCHEMA_ALLOWED_KEYS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering", // Geminiの非標準キー
]);

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * OpenAIのJSON SchemaをGeminiのサブセットに寄せる（落ちにくくする）
 * - 未対応キーを落とす
 * - definitions -> $defs に寄せる
 * - $ref がある sub-schema は “$系” 以外を落とす（Gemini doc の制約に合わせる）
 * - object には propertyOrdering を自動付与（特に Gemini 2.0 対策）
 */
export function coerceJsonSchemaForGemini(input: unknown): any {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isPlainObject(node)) return node;

    // definitions -> $defs
    const defs = isPlainObject(node.$defs)
      ? node.$defs
      : isPlainObject(node.definitions)
        ? node.definitions
        : undefined;

    // $ref があるなら “$系”以外を落とす（Geminiの制約）
    if (typeof node.$ref === "string" && node.$ref.length > 0) {
      const out: any = {};
      if (typeof node.$id === "string") out.$id = node.$id;
      if (typeof node.$anchor === "string") out.$anchor = node.$anchor;
      if (defs) {
        const coercedDefs: any = {};
        for (const [k, v] of Object.entries(defs)) coercedDefs[k] = walk(v);
        out.$defs = coercedDefs;
      }
      out.$ref = node.$ref;
      return out;
    }

    const out: any = {};

    if (defs) {
      const coercedDefs: any = {};
      for (const [k, v] of Object.entries(defs)) coercedDefs[k] = walk(v);
      out.$defs = coercedDefs;
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === "definitions") continue; // $defsへ寄せたので捨てる
      if (!GEMINI_JSON_SCHEMA_ALLOWED_KEYS.has(k)) continue;

      switch (k) {
        case "properties": {
          if (!isPlainObject(v)) break;
          const props: any = {};
          for (const [pk, pv] of Object.entries(v)) props[pk] = walk(pv);
          out.properties = props;
          break;
        }
        case "items": {
          // items が配列で来る（旧仕様）ことがあるので prefixItems に寄せる
          if (Array.isArray(v)) {
            out.prefixItems = v.map(walk);
          } else {
            out.items = walk(v);
          }
          break;
        }
        case "prefixItems": {
          if (Array.isArray(v)) out.prefixItems = v.map(walk);
          break;
        }
        case "anyOf":
        case "oneOf": {
          if (Array.isArray(v)) out[k] = v.map(walk);
          break;
        }
        case "additionalProperties": {
          // boolean or schema
          if (typeof v === "boolean") out.additionalProperties = v;
          else out.additionalProperties = walk(v);
          break;
        }
        default:
          out[k] = walk(v);
      }
    }

    // object の場合 propertyOrdering を自動付与（Gemini 2.0 の “要求”に寄せる）
    const typeVal = out.type;
    const isObjectType =
      typeVal === "object" ||
      (Array.isArray(typeVal) && typeVal.includes("object"));
    if (
      isObjectType &&
      !Array.isArray(out.propertyOrdering) &&
      isPlainObject(out.properties)
    ) {
      out.propertyOrdering = Object.keys(out.properties);
    }

    return out;
  };

  return walk(input);
}
