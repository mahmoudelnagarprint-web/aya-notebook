import type { z } from 'zod';

type JsonSchema = Record<string, unknown>;

function literalValue(value: unknown): unknown {
  return value;
}

/**
 * Minimal, dependency-free Zod → JSON Schema conversion covering the constructs the
 * platform actually uses. Function tools sent to LLMs are derived from the same Zod
 * schema the CommandBus validates against, so the two can never drift.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName?: string; [key: string]: unknown };
  const description = (schema as unknown as { description?: string }).description;

  const withDescription = (result: JsonSchema): JsonSchema =>
    description ? { ...result, description } : result;

  switch (def.typeName) {
    case 'ZodString': {
      const result: JsonSchema = { type: 'string' };
      const checks = (def.checks as Array<{ kind: string; value?: number; regex?: RegExp }> | undefined) ?? [];
      for (const check of checks) {
        if (check.kind === 'min') result.minLength = check.value;
        if (check.kind === 'max') result.maxLength = check.value;
        if (check.kind === 'regex' && check.regex) result.pattern = check.regex.source;
      }
      return withDescription(result);
    }
    case 'ZodNumber': {
      const result: JsonSchema = { type: 'number' };
      const checks = (def.checks as Array<{ kind: string; value?: number }> | undefined) ?? [];
      for (const check of checks) {
        if (check.kind === 'min') result.minimum = check.value;
        if (check.kind === 'max') result.maximum = check.value;
        if (check.kind === 'int') result.type = 'integer';
      }
      return withDescription(result);
    }
    case 'ZodBoolean':
      return withDescription({ type: 'boolean' });
    case 'ZodNull':
      return { type: 'null' };
    case 'ZodLiteral':
      return withDescription({ const: literalValue(def.value) });
    case 'ZodEnum':
      return withDescription({ type: 'string', enum: def.values });
    case 'ZodNativeEnum':
      return withDescription({ type: 'string', enum: Object.values(def.values as Record<string, string>) });
    case 'ZodArray':
      return withDescription({
        type: 'array',
        items: zodToJsonSchema(def.type as z.ZodTypeAny),
        ...(def.minLength ? { minItems: (def.minLength as { value: number }).value } : {}),
      });
    case 'ZodObject': {
      const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!value.isOptional() && !(value._def as { typeName?: string }).typeName?.includes('Default')) {
          required.push(key);
        }
      }
      const result: JsonSchema = { type: 'object', properties, additionalProperties: false };
      if (required.length) result.required = required;
      return withDescription(result);
    }
    case 'ZodRecord':
      return withDescription({ type: 'object', additionalProperties: zodToJsonSchema(def.valueType as z.ZodTypeAny) });
    case 'ZodTuple':
      return withDescription({ type: 'array', items: (def.items as z.ZodTypeAny[]).map(zodToJsonSchema) });
    case 'ZodUnion': {
      const options = def.options as z.ZodTypeAny[];
      const allString = options.every((option) => (option._def as { typeName?: string }).typeName === 'ZodString');
      if (allString) return withDescription({ type: 'string' });
      return withDescription({ anyOf: options.map(zodToJsonSchema) });
    }
    case 'ZodNullable': {
      const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny);
      return withDescription({ anyOf: [inner, { type: 'null' }] });
    }
    case 'ZodOptional':
      return zodToJsonSchema(def.innerType as z.ZodTypeAny);
    case 'ZodDefault': {
      const inner = zodToJsonSchema(def.innerType as z.ZodTypeAny);
      const defaultValue = typeof def.defaultValue === 'function' ? (def.defaultValue as () => unknown)() : def.defaultValue;
      return withDescription({ ...inner, default: defaultValue });
    }
    case 'ZodEffects':
      return zodToJsonSchema(def.schema as z.ZodTypeAny);
    case 'ZodBranded':
      return zodToJsonSchema(def.type as z.ZodTypeAny);
    case 'ZodLazy':
      return zodToJsonSchema((def.getter as () => z.ZodTypeAny)());
    case 'ZodAny':
    case 'ZodUnknown':
    default:
      return withDescription({});
  }
}
