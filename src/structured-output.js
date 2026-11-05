/** Standalone structured output schema normalization and protocol translation. Pure candidate module, not connected to main pipeline. */

export const SUBSET_KEYWORDS = Object.freeze([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'description',
  'nullable',
  'additionalProperties',
  'anyOf',
  'oneOf',
  'allOf',
  '$ref',
  '$defs',
  'format',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'default',
  'title',
]);

export const GEMINI_UNSUPPORTED_KEYWORDS = Object.freeze([
  '$ref',
  '$defs',
  'oneOf',
  'allOf',
  'additionalProperties',
]);

export const ALLOWED_TYPES = Object.freeze([
  'object',
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'null',
]);

const SUBSET_KEYWORD_SET = new Set(SUBSET_KEYWORDS);
const ALLOWED_TYPES_SET = new Set(ALLOWED_TYPES);

const isPlainObject = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const setOwn = (target, key, value) => Object.defineProperty(target, key,
  { value, enumerable: true, writable: true, configurable: true });

// JSON-data boundary. Repeated aliases are safe; only active recursion is a cycle.
// Bounds protect this recursive implementation, not a provider's schema quota.
function assertJsonData(value, active = new WeakSet(), state = { count: 0 }, depth = 0) {
  if (++state.count > 100000 || depth > 100) throw new TypeError('JSON data exceeds local traversal bounds');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || (!Array.isArray(value) && !isPlainObject(value)))
    throw new TypeError('Expected finite, plain JSON data');
  if (active.has(value)) throw new TypeError('Circular JSON data');
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Symbol keys are not JSON data');
  if (Array.isArray(value) && value.length > 100000) throw new TypeError('JSON data exceeds local traversal bounds');
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Non-JSON property descriptor');
    if (Array.isArray(value) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) throw new TypeError('Extra array properties are not JSON data');
  }
  active.add(value);
  const keys = Array.isArray(value) ? Array.from({ length: value.length }, (_, i) => String(i)) : Object.keys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new TypeError('Sparse arrays/accessors are not JSON data');
    assertJsonData(descriptor.value, active, state, depth + 1);
  }
  active.delete(value);
}


function deepCopyAndSort(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    throw new TypeError('Circular JSON data');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map(item => deepCopyAndSort(item, seen));
    seen.delete(value);
    return result;
  }
  const result = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    setOwn(result, key, deepCopyAndSort(value[key], seen));
  }
  seen.delete(value);
  return result;
}

/**
 * Recursively normalizes a JSON schema by lexicographically sorting object keys
 * and stripping keywords outside the supported subset.
 */
export function normalizeSchema(schema) {
  assertJsonData(schema);
  return normalizeNode(schema, new WeakSet());
}

function normalizeNode(schema, seen) {
  if (!isPlainObject(schema)) {
    return deepCopyAndSort(schema);
  }
  if (seen.has(schema)) {
    throw new TypeError('Circular JSON data');
  }
  seen.add(schema);

  const result = {};
  const keys = Object.keys(schema).filter(key => SUBSET_KEYWORD_SET.has(key)).sort();
  for (const key of keys) {
    const value = schema[key];
    if (key === 'properties' && isPlainObject(value)) {
      const normProps = {};
      const propKeys = Object.keys(value).sort();
      for (const propKey of propKeys) {
        setOwn(normProps, propKey, normalizeNode(value[propKey], seen));
      }
      result.properties = normProps;
    } else if (key === '$defs' && isPlainObject(value)) {
      const normDefs = {};
      const defKeys = Object.keys(value).sort();
      for (const defKey of defKeys) {
        setOwn(normDefs, defKey, normalizeNode(value[defKey], seen));
      }
      result.$defs = normDefs;
    } else if (key === 'items') {
      if (Array.isArray(value)) {
        result.items = value.map(item => normalizeNode(item, seen));
      } else if (isPlainObject(value)) {
        result.items = normalizeNode(value, seen);
      } else {
        result.items = deepCopyAndSort(value, seen);
      }
    } else if (key === 'additionalProperties') {
      if (isPlainObject(value)) {
        result.additionalProperties = normalizeNode(value, seen);
      } else {
        result.additionalProperties = deepCopyAndSort(value, seen);
      }
    } else if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      if (Array.isArray(value)) {
        result[key] = value.map(item => normalizeNode(item, seen));
      } else {
        result[key] = deepCopyAndSort(value, seen);
      }
    } else {
      result[key] = deepCopyAndSort(value, seen);
    }
  }
  seen.delete(schema);
  return result;
}

/**
 * Validates that a schema adheres to the supported JSON Schema subset for the target protocol.
 */
export function validateSchemaSubset(schema, protocol, { strict = false } = {}) {
  const errors = [];
  try { assertJsonData(schema); } catch (error) { return { ok: false, errors: [error.message] }; }
  if (protocol !== 'gemini' && protocol !== 'openai' && protocol !== 'ark') {
    errors.push(`Unsupported protocol: "${protocol}". Expected "gemini", "openai", or "ark".`);
  }
  if (!isPlainObject(schema)) {
    errors.push('Root schema must be a plain object.');
    return { ok: false, errors };
  }

  if (schema.type !== 'object') {
    errors.push('Root schema must have type "object".');
  }
  if (!('properties' in schema) || !isPlainObject(schema.properties)) {
    errors.push('Root schema must have a "properties" object.');
  }

  const rootDefs = isPlainObject(schema.$defs) ? schema.$defs : null;
  const visited = new Set();

  function validateNode(node, path) {
    if (visited.has(node)) {
      errors.push(`Circular reference detected at ${path}.`);
      return;
    }
    visited.add(node);

    // Disallowed keywords
    for (const key of Object.keys(node)) {
      if (!SUBSET_KEYWORD_SET.has(key)) {
        errors.push(`Disallowed keyword "${key}" at ${path}.${key}.`);
      }
    }

    // Protocol limitations (Gemini disallows combinators and references)
    if (protocol === 'gemini') {
      for (const key of GEMINI_UNSUPPORTED_KEYWORDS) {
        if (key in node && node[key] !== undefined) {
          errors.push(`Keyword "${key}" at ${path}.${key} is not supported by gemini protocol.`);
        }
      }
    }

    if (protocol === 'openai') {
      for (const key of ['oneOf', 'allOf', 'nullable', 'default']) {
        if (Object.hasOwn(node, key)) errors.push(`Keyword "${key}" at ${path} is outside this OpenAI candidate profile.`);
      }
      if (strict && (node.type === 'object' || Object.hasOwn(node, 'properties'))) {
        if (node.additionalProperties !== false) errors.push(`OpenAI strict requires additionalProperties:false at ${path}.`);
        const names = isPlainObject(node.properties) ? Object.keys(node.properties) : [];
        if (!Array.isArray(node.required) || names.some(key => !node.required.includes(key)))
          errors.push(`OpenAI strict requires every property in required at ${path}.`);
      }
      if (path === '$' && Object.hasOwn(node, 'anyOf')) errors.push('OpenAI root anyOf is not supported.');
    }
    if (protocol === 'ark' && Object.hasOwn(node, 'nullable'))
      errors.push(`Keyword "nullable" at ${path} has no verified Ark support; use a null union.`);

    // Type validation
    if ('type' in node && node.type !== undefined) {
      if (typeof node.type !== 'string' || !ALLOWED_TYPES_SET.has(node.type)) {
        errors.push(`Invalid type "${node.type}" at ${path}.type. Expected one of: ${ALLOWED_TYPES.join(', ')}.`);
      }
    }

    // Properties validation
    if ('properties' in node && node.properties !== undefined) {
      if (!isPlainObject(node.properties)) {
        errors.push(`"properties" at ${path}.properties must be a plain object.`);
      } else {
        for (const [propName, propSchema] of Object.entries(node.properties)) {
          const propPath = `${path}.properties.${propName}`;
          if (!isPlainObject(propSchema)) {
            errors.push(`Property schema at ${propPath} must be a plain object.`);
          } else {
            validateNode(propSchema, propPath);
          }
        }
      }
    }

    // Required properties validation
    if ('required' in node && node.required !== undefined) {
      if (!Array.isArray(node.required)) {
        errors.push(`"required" at ${path}.required must be an array of strings.`);
      } else {
        if (new Set(node.required).size !== node.required.length) errors.push(`Duplicate required entries at ${path}.`);
        const declaredKeys = isPlainObject(node.properties) ? new Set(Object.keys(node.properties)) : new Set();
        for (let i = 0; i < node.required.length; i++) {
          const item = node.required[i];
          if (typeof item !== 'string') {
            errors.push(`Item at ${path}.required[${i}] must be a string.`);
          } else if (!declaredKeys.has(item)) {
            errors.push(`Required property "${item}" at ${path}.required is not declared in properties.`);
          }
        }
      }
    }

    // Array items validation
    if (node.type === 'array') {
      if (!('items' in node) || node.items === undefined) {
        errors.push(`"items" schema is required at ${path} when type is "array".`);
      } else if (!isPlainObject(node.items)) {
        errors.push(`"items" at ${path}.items must be a valid schema object.`);
      } else {
        validateNode(node.items, `${path}.items`);
      }
    } else if ('items' in node && node.items !== undefined) {
      if (!isPlainObject(node.items)) {
        errors.push(`"items" at ${path}.items must be a valid schema object.`);
      } else {
        validateNode(node.items, `${path}.items`);
      }
    }

    // Enum validation
    if ('enum' in node && node.enum !== undefined) {
      if (!Array.isArray(node.enum) || node.enum.length === 0) {
        errors.push(`"enum" at ${path}.enum must be a non-empty array.`);
      }
    }

    if (protocol === 'gemini' && Array.isArray(node.enum) && node.enum.some(value => typeof value !== 'string'))
      errors.push(`Gemini responseSchema enum must contain strings at ${path}.`);

    // $ref validation
    if ('$ref' in node && node.$ref !== undefined) {
      if (typeof node.$ref !== 'string') {
        errors.push(`"$ref" at ${path}.$ref must be a string.`);
      } else {
        const match = /^#\/\$defs\/([^/#~%]+)$/.exec(node.$ref);
        if (!match) {
          errors.push(`"$ref" at ${path}.$ref must follow format "#/$defs/<name>".`);
        } else {
          const defName = match[1];
          if (!rootDefs || !Object.hasOwn(rootDefs, defName)) {
            errors.push(`Referenced definition "${defName}" at ${path}.$ref does not exist in root $defs.`);
          }
        }
      }
    }

    // $defs validation
    if ('$defs' in node && node.$defs !== undefined) {
      if (!isPlainObject(node.$defs)) {
        errors.push(`"$defs" at ${path}.$defs must be a plain object.`);
      } else {
        for (const [defName, defSchema] of Object.entries(node.$defs)) {
          const defPath = `${path}.$defs.${defName}`;
          if (!isPlainObject(defSchema)) {
            errors.push(`Definition "${defName}" at ${defPath} must be a plain object.`);
          } else {
            validateNode(defSchema, defPath);
          }
        }
      }
    }

    // Combinators validation (anyOf, oneOf, allOf)
    for (const comb of ['anyOf', 'oneOf', 'allOf']) {
      if (comb in node && node[comb] !== undefined) {
        if (!Array.isArray(node[comb]) || node[comb].length === 0) {
          errors.push(`"${comb}" at ${path}.${comb} must be a non-empty array of schemas.`);
        } else {
          for (let i = 0; i < node[comb].length; i++) {
            const subSchema = node[comb][i];
            const subPath = `${path}.${comb}[${i}]`;
            if (!isPlainObject(subSchema)) {
              errors.push(`Item at ${subPath} must be a valid schema object.`);
            } else {
              validateNode(subSchema, subPath);
            }
          }
        }
      }
    }

    // additionalProperties validation
    if ('additionalProperties' in node && node.additionalProperties !== undefined) {
      if (typeof node.additionalProperties !== 'boolean' && !isPlainObject(node.additionalProperties)) {
        errors.push(`"additionalProperties" at ${path}.additionalProperties must be a boolean or a schema object.`);
      } else if (isPlainObject(node.additionalProperties)) {
        validateNode(node.additionalProperties, `${path}.additionalProperties`);
      }
    }

    // Numeric and string constraints
    for (const numKey of ['minimum', 'maximum']) {
      if (numKey in node && node[numKey] !== undefined && typeof node[numKey] !== 'number') {
        errors.push(`"${numKey}" at ${path}.${numKey} must be a number.`);
      }
    }
    for (const intKey of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (intKey in node && node[intKey] !== undefined) {
        const val = node[intKey];
        if (!Number.isInteger(val) || val < 0) {
          errors.push(`"${intKey}" at ${path}.${intKey} must be a non-negative integer.`);
        }
      }
    }
    for (const [min, max] of [['minimum', 'maximum'], ['minLength', 'maxLength'], ['minItems', 'maxItems']]) {
      if (typeof node[min] === 'number' && typeof node[max] === 'number' && node[min] > node[max]) errors.push(`Contradictory ${min}/${max} at ${path}.`);
    }
    for (const strKey of ['pattern', 'format', 'title', 'description']) {
      if (strKey in node && node[strKey] !== undefined) {
        if (typeof node[strKey] !== 'string') {
          errors.push(`"${strKey}" at ${path}.${strKey} must be a string.`);
        } else if (strKey === 'pattern') {
          try {
            new RegExp(node.pattern);
          } catch {
            errors.push(`Invalid regular expression at ${path}.pattern.`);
          }
        }
      }
    }
    if ('nullable' in node && node.nullable !== undefined && typeof node.nullable !== 'boolean') {
      errors.push(`"nullable" at ${path}.nullable must be a boolean.`);
    }

    visited.delete(node);
  }

  validateNode(schema, '$');
  return { ok: errors.length === 0, errors };
}

/**
 * Builds request payload fields for structured output according to provider conventions.
 */
export function buildStructuredOutputFields(protocol, {schema, name, strict} = {}) {
  if (protocol !== 'openai' && protocol !== 'ark' && protocol !== 'gemini') {
    return {};
  }
  const validation = validateSchemaSubset(schema, protocol, { strict: strict !== false });
  if (!validation.ok) throw new TypeError(validation.errors.join('\n'));
  if (name !== undefined && (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name)))
    throw new TypeError('Schema name must contain 1–64 letters, digits, underscores or hyphens');
  if (strict !== undefined && typeof strict !== 'boolean') throw new TypeError('strict must be boolean');
  const normalized = normalizeSchema(schema);
  if (protocol === 'gemini') {
    // Gemini does not support name or strict parameters; only responseMimeType and responseSchema.
    return {
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: geminiSchema(normalized),
      },
    };
  }
  return {
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: typeof name === 'string' && name ? name : 'structured_output',
        schema: normalized,
        strict: strict !== false,
      },
    },
  };
}


// responseSchema is the Gemini OpenAPI Schema message, not responseJsonSchema.
function geminiSchema(node) {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') setOwn(out, key, value.toUpperCase());
    else if (key === 'properties') {
      const properties = {};
      for (const [name, child] of Object.entries(value)) setOwn(properties, name, geminiSchema(child));
      setOwn(out, key, properties);
    } else if (key === 'items') setOwn(out, key, geminiSchema(value));
    else if (key === 'anyOf') setOwn(out, key, value.map(geminiSchema));
    else setOwn(out, key, value);
  }
  return out;
}

/**
 * Extracts the structured text payload from provider response JSON and parses it.
 */
export function parseStructuredResult(protocol, responseJson) {
  if (protocol !== 'openai' && protocol !== 'ark' && protocol !== 'gemini') {
    return { ok: false, error: 'unsupported protocol' };
  }
  if (!isPlainObject(responseJson)) {
    return { ok: false, error: 'no text payload' };
  }

  let text;
  if (protocol === 'gemini') {
    const candidate = responseJson.candidates?.[0];
    if (candidate?.finishReason !== undefined && candidate.finishReason !== 'STOP')
      return { ok: false, error: 'incomplete or blocked response' };
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) {
      return { ok: false, error: 'no text payload' };
    }
    text = parts
      .filter(part => typeof part?.text === 'string' && !part.thought)
      .map(part => part.text)
      .join('');
  } else {
    // Both 'openai' and 'ark' use the OpenAI chat completions format
    const choice = responseJson.choices?.[0];
    const message = choice?.message;
    if (message?.refusal) return { ok: false, error: 'model refusal' };
    if (choice?.finish_reason !== undefined && choice.finish_reason !== 'stop')
      return { ok: false, error: 'incomplete or blocked response' };
    if (!isPlainObject(message) || typeof message.content !== 'string') {
      return { ok: false, error: 'no text payload' };
    }
    text = message.content;
  }

  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'no text payload' };
  }

  try {
    const value = JSON.parse(text);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${err.message}` };
  }
}
