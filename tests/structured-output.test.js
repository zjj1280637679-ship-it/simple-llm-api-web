import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSET_KEYWORDS,
  GEMINI_UNSUPPORTED_KEYWORDS,
  ALLOWED_TYPES,
  normalizeSchema,
  validateSchemaSubset,
  buildStructuredOutputFields,
  parseStructuredResult,
} from '../src/structured-output.js';

test('unit: exports and immutability of constants', () => {
  assert(Object.isFrozen(SUBSET_KEYWORDS));
  assert(Object.isFrozen(GEMINI_UNSUPPORTED_KEYWORDS));
  assert(Object.isFrozen(ALLOWED_TYPES));

  assert(SUBSET_KEYWORDS.includes('type'));
  assert(SUBSET_KEYWORDS.includes('properties'));
  assert(SUBSET_KEYWORDS.includes('required'));
  assert(SUBSET_KEYWORDS.includes('items'));
  assert(SUBSET_KEYWORDS.includes('enum'));
  assert(SUBSET_KEYWORDS.includes('$ref'));
  assert(SUBSET_KEYWORDS.includes('$defs'));

  assert.deepEqual([...GEMINI_UNSUPPORTED_KEYWORDS], ['$ref', '$defs', 'anyOf', 'oneOf', 'allOf']);
  assert.deepEqual(
    [...ALLOWED_TYPES],
    ['object', 'string', 'number', 'integer', 'boolean', 'array', 'null'],
  );
});

test('property: normalizeSchema is idempotent across varied nested schemas', () => {
  const flatSchema = {
    type: 'object',
    description: 'Flat object schema',
    properties: {
      name: { type: 'string', description: 'Name field' },
      age: { type: 'integer', minimum: 0 },
    },
    required: ['name'],
  };

  const nestedSchema = {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tags: {
            type: 'array',
            items: { type: 'string', enum: ['admin', 'member'] },
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
      status: { type: 'string', enum: ['active', 'inactive'] },
    },
    required: ['user'],
  };

  const complexSchema = {
    type: 'object',
    $defs: {
      Address: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          zip: { type: 'string', pattern: '^\\d{5}$' },
        },
        required: ['city'],
      },
    },
    properties: {
      primaryAddress: { $ref: '#/$defs/Address' },
      alternative: {
        anyOf: [
          { type: 'string' },
          { $ref: '#/$defs/Address' },
        ],
      },
      score: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        default: { raw: 100, scale: 'percent' },
      },
    },
    required: ['primaryAddress'],
  };

  for (const schema of [flatSchema, nestedSchema, complexSchema]) {
    const firstPass = normalizeSchema(schema);
    const secondPass = normalizeSchema(firstPass);
    assert.deepEqual(secondPass, firstPass);
  }
});

test('property: schemas differing only in key ordering normalize to deep equal objects', () => {
  const schemaA = {
    type: 'object',
    description: 'Sample ordering test',
    required: ['b', 'a'],
    properties: {
      b: {
        description: 'b prop',
        type: 'string',
      },
      a: {
        items: {
          enum: ['first', 'second'],
          type: 'string',
        },
        type: 'array',
      },
    },
  };

  const schemaB = {
    properties: {
      a: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['first', 'second'],
        },
      },
      b: {
        type: 'string',
        description: 'b prop',
      },
    },
    required: ['b', 'a'],
    description: 'Sample ordering test',
    type: 'object',
  };

  const normA = normalizeSchema(schemaA);
  const normB = normalizeSchema(schemaB);

  assert.deepEqual(normA, normB);
  assert.equal(JSON.stringify(normA), JSON.stringify(normB));
});

test('property: valid subset schema passes through buildStructuredOutputFields losslessly', () => {
  const schema = {
    type: 'object',
    description: 'Valid test schema',
    properties: {
      title: { type: 'string' },
      count: { type: 'integer', minimum: 1 },
      items: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['title'],
  };

  const expectedNormalized = normalizeSchema(schema);

  const openaiOut = buildStructuredOutputFields('openai', { schema });
  assert.deepEqual(openaiOut.response_format.json_schema.schema, expectedNormalized);

  const arkOut = buildStructuredOutputFields('ark', { schema });
  assert.deepEqual(arkOut.response_format.json_schema.schema, expectedNormalized);

  const geminiOut = buildStructuredOutputFields('gemini', { schema });
  assert.deepEqual(geminiOut.generationConfig.responseSchema, expectedNormalized);
});

test('property: normalizeSchema does not mutate input object', () => {
  const input = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    readOnly: true,
    type: 'object',
    properties: {
      z: { type: 'number', customExtra: 123 },
      a: {
        type: 'array',
        items: {
          type: 'string',
          customKeyword: 'strip-me',
        },
        default: { zKey: 2, aKey: 1 },
      },
    },
    required: ['z'],
  };

  const snapshot = structuredClone(input);
  normalizeSchema(input);
  assert.deepEqual(input, snapshot);
});

test('property: parseStructuredResult round-trips structured payloads for all protocols', () => {
  const original = { a: 1, b: 'x' };
  const text = JSON.stringify(original);

  const openaiResp = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: text,
        },
      },
    ],
  };

  const arkResp = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: text,
        },
      },
    ],
  };

  const geminiResp = {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }],
        },
      },
    ],
  };

  for (const protocol of ['openai', 'ark', 'gemini']) {
    const resp = protocol === 'gemini' ? geminiResp : protocol === 'ark' ? arkResp : openaiResp;
    const parsed = parseStructuredResult(protocol, resp);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.value, original);
  }
});

test('unit: normalizeSchema strips disallowed keywords while retaining subset keywords and preserving prop keys', () => {
  const input = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Profile',
    type: 'object',
    readOnly: true,
    writeOnly: false,
    properties: {
      $schema: {
        type: 'string',
        description: 'Property named $schema is allowed',
        deprecated: true,
      },
      readOnly: {
        type: 'boolean',
        description: 'Property named readOnly is allowed',
      },
    },
    default: {
      $schema: 'default-value',
      unread: true,
    },
  };

  const normalized = normalizeSchema(input);

  // Root level strips non-subset keywords
  assert.equal(normalized.$schema, undefined);
  assert.equal(normalized.readOnly, undefined);
  assert.equal(normalized.writeOnly, undefined);
  assert.equal(normalized.title, 'Profile');
  assert.equal(normalized.type, 'object');

  // Properties keys themselves are preserved even if named like keywords
  assert.ok('properties' in normalized);
  assert.ok('$schema' in normalized.properties);
  assert.ok('readOnly' in normalized.properties);
  assert.equal(normalized.properties.$schema.type, 'string');
  assert.equal(normalized.properties.$schema.deprecated, undefined);

  // Default content is deep-copied and sorted without stripping
  assert.deepEqual(normalized.default, {
    $schema: 'default-value',
    unread: true,
  });

  // Key ordering at root
  assert.deepEqual(Object.keys(normalized), ['default', 'properties', 'title', 'type']);
});

test('unit: normalizeSchema preserves array element order and handles non-plain-object inputs', () => {
  assert.equal(normalizeSchema(null), null);
  assert.equal(normalizeSchema(42), 42);
  assert.equal(normalizeSchema('text'), 'text');
  assert.deepEqual(normalizeSchema([3, 1, 2]), [3, 1, 2]);

  const schemaWithArray = {
    type: 'object',
    properties: {
      list: {
        type: 'array',
        items: [
          { type: 'string' },
          { type: 'number' },
        ],
      },
    },
  };
  const normalized = normalizeSchema(schemaWithArray);
  assert.equal(normalized.properties.list.items[0].type, 'string');
  assert.equal(normalized.properties.list.items[1].type, 'number');
});

test('unit: validateSchemaSubset rejects invalid root structures', () => {
  const notObject = validateSchemaSubset(null, 'openai');
  assert.equal(notObject.ok, false);
  assert(notObject.errors.some(e => e.includes('Root schema must be a plain object')));

  const stringRoot = validateSchemaSubset('not a schema', 'openai');
  assert.equal(stringRoot.ok, false);
  assert(stringRoot.errors.some(e => e.includes('Root schema must be a plain object')));

  const wrongType = validateSchemaSubset({ type: 'string', properties: {} }, 'openai');
  assert.equal(wrongType.ok, false);
  assert(wrongType.errors.some(e => e.includes('Root schema must have type "object"')));

  const missingProps = validateSchemaSubset({ type: 'object' }, 'openai');
  assert.equal(missingProps.ok, false);
  assert(missingProps.errors.some(e => e.includes('Root schema must have a "properties" object')));

  const nonObjectProps = validateSchemaSubset({ type: 'object', properties: 'bad' }, 'openai');
  assert.equal(nonObjectProps.ok, false);
  assert(nonObjectProps.errors.some(e => e.includes('Root schema must have a "properties" object')));
});

test('unit: validateSchemaSubset rejects disallowed keywords, invalid required keys, empty enum, and missing items', () => {
  const disallowedKw = validateSchemaSubset({
    $schema: 'http://example.com',
    type: 'object',
    properties: {
      x: {
        type: 'number',
        exclusiveMinimum: 0,
      },
    },
  }, 'openai');
  assert.equal(disallowedKw.ok, false);
  assert(disallowedKw.errors.some(e => e.includes('Disallowed keyword "$schema"')));
  assert(disallowedKw.errors.some(e => e.includes('Disallowed keyword "exclusiveMinimum"')));

  const undeclaredReq = validateSchemaSubset({
    type: 'object',
    properties: {
      validProp: { type: 'string' },
    },
    required: ['validProp', 'missingProp'],
  }, 'openai');
  assert.equal(undeclaredReq.ok, false);
  assert(undeclaredReq.errors.some(e => e.includes('Required property "missingProp"')));

  const nonArrayReq = validateSchemaSubset({
    type: 'object',
    properties: { a: { type: 'string' } },
    required: 'a',
  }, 'openai');
  assert.equal(nonArrayReq.ok, false);
  assert(nonArrayReq.errors.some(e => e.includes('"required" at $.required must be an array of strings')));

  const emptyEnum = validateSchemaSubset({
    type: 'object',
    properties: {
      role: { type: 'string', enum: [] },
    },
  }, 'openai');
  assert.equal(emptyEnum.ok, false);
  assert(emptyEnum.errors.some(e => e.includes('"enum" at $.properties.role.enum must be a non-empty array')));

  const missingArrayItems = validateSchemaSubset({
    type: 'object',
    properties: {
      tags: { type: 'array' },
    },
  }, 'openai');
  assert.equal(missingArrayItems.ok, false);
  assert(missingArrayItems.errors.some(e => e.includes('"items" schema is required at $.properties.tags when type is "array"')));
});

test('unit: validateSchemaSubset enforces ref and defs integrity', () => {
  const badRefFormat = validateSchemaSubset({
    type: 'object',
    $defs: { Item: { type: 'string' } },
    properties: {
      a: { $ref: 'Item' },
    },
  }, 'openai');
  assert.equal(badRefFormat.ok, false);
  assert(badRefFormat.errors.some(e => e.includes('must follow format "#/$defs/<name>"')));

  const missingDef = validateSchemaSubset({
    type: 'object',
    $defs: { Item: { type: 'string' } },
    properties: {
      a: { $ref: '#/$defs/NonExistent' },
    },
  }, 'openai');
  assert.equal(missingDef.ok, false);
  assert(missingDef.errors.some(e => e.includes('Referenced definition "NonExistent"')));

  const refWithoutDefs = validateSchemaSubset({
    type: 'object',
    properties: {
      a: { $ref: '#/$defs/Item' },
    },
  }, 'openai');
  assert.equal(refWithoutDefs.ok, false);
  assert(refWithoutDefs.errors.some(e => e.includes('Referenced definition "Item"')));
});

test('unit: validateSchemaSubset enforces gemini protocol restrictions', () => {
  const geminiAnyOf = validateSchemaSubset({
    type: 'object',
    properties: {
      target: {
        anyOf: [{ type: 'string' }, { type: 'number' }],
      },
    },
  }, 'gemini');
  assert.equal(geminiAnyOf.ok, false);
  assert(geminiAnyOf.errors.some(e => e.includes('Keyword "anyOf"') && e.includes('not supported by gemini protocol')));

  const geminiRef = validateSchemaSubset({
    type: 'object',
    $defs: { Def: { type: 'string' } },
    properties: {
      target: { $ref: '#/$defs/Def' },
    },
  }, 'gemini');
  assert.equal(geminiRef.ok, false);
  assert(geminiRef.errors.some(e => e.includes('Keyword "$ref"') && e.includes('not supported by gemini protocol')));
  assert(geminiRef.errors.some(e => e.includes('Keyword "$defs"') && e.includes('not supported by gemini protocol')));
});

test('unit: validateSchemaSubset rejects invalid protocols', () => {
  const validSchema = {
    type: 'object',
    properties: { id: { type: 'string' } },
  };

  for (const invalidProto of ['anthropic', 'claude', '', null, 123]) {
    const result = validateSchemaSubset(validSchema, invalidProto);
    assert.equal(result.ok, false);
    assert(result.errors.some(e => e.includes('Unsupported protocol')));
  }
});

test('unit: validateSchemaSubset accepts comprehensive valid schemas', () => {
  const validOpenAiSchema = {
    type: 'object',
    $defs: {
      Address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          code: { type: 'integer' },
        },
        required: ['street'],
      },
    },
    properties: {
      id: { type: 'string', pattern: '^[a-z]+$' },
      age: { type: 'integer', minimum: 0, maximum: 120 },
      status: { type: 'string', enum: ['active', 'pending'] },
      tags: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 5,
      },
      home: { $ref: '#/$defs/Address' },
      notes: {
        type: 'string',
        nullable: true,
        title: 'Notes',
        description: 'Optional user notes',
      },
    },
    required: ['id', 'status'],
    additionalProperties: false,
  };

  const openAiResult = validateSchemaSubset(validOpenAiSchema, 'openai');
  assert.equal(openAiResult.ok, true);
  assert.deepEqual(openAiResult.errors, []);

  const arkResult = validateSchemaSubset(validOpenAiSchema, 'ark');
  assert.equal(arkResult.ok, true);
  assert.deepEqual(arkResult.errors, []);

  const validGeminiSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 50 },
      flag: { type: 'boolean', default: true },
      scores: {
        type: 'array',
        items: { type: 'number' },
      },
    },
    required: ['name'],
  };
  const geminiResult = validateSchemaSubset(validGeminiSchema, 'gemini');
  assert.equal(geminiResult.ok, true);
  assert.deepEqual(geminiResult.errors, []);
});

test('unit: validateSchemaSubset validates types and constraints values', () => {
  const invalidType = validateSchemaSubset({
    type: 'object',
    properties: {
      bad: { type: 'custom_type' },
    },
  }, 'openai');
  assert.equal(invalidType.ok, false);
  assert(invalidType.errors.some(e => e.includes('Invalid type "custom_type"')));

  const invalidConstraints = validateSchemaSubset({
    type: 'object',
    properties: {
      num: { type: 'number', minimum: 'not-a-number' },
      str: { type: 'string', minLength: -1, pattern: '[invalid(' },
      flag: { type: 'boolean', nullable: 'yes' },
    },
  }, 'openai');
  assert.equal(invalidConstraints.ok, false);
  assert(invalidConstraints.errors.some(e => e.includes('"minimum" at $.properties.num.minimum must be a number')));
  assert(invalidConstraints.errors.some(e => e.includes('must be a non-negative integer')));
  assert(invalidConstraints.errors.some(e => e.includes('Invalid regular expression')));
  assert(invalidConstraints.errors.some(e => e.includes('"nullable" at $.properties.flag.nullable must be a boolean')));
});

test('unit: buildStructuredOutputFields handles defaults, strict flags, and protocol shapes', () => {
  const schema = {
    type: 'object',
    properties: {
      greeting: { type: 'string' },
    },
  };

  // OpenAI defaults
  const openAiDefault = buildStructuredOutputFields('openai', { schema });
  assert.deepEqual(openAiDefault, {
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'structured_output',
        schema: normalizeSchema(schema),
        strict: true,
      },
    },
  });

  // OpenAI custom name and strict false
  const openAiCustom = buildStructuredOutputFields('openai', {
    schema,
    name: 'custom_name',
    strict: false,
  });
  assert.equal(openAiCustom.response_format.json_schema.name, 'custom_name');
  assert.equal(openAiCustom.response_format.json_schema.strict, false);

  // Ark mirrors OpenAI format
  const arkOut = buildStructuredOutputFields('ark', { schema, name: 'ark_spec' });
  assert.equal(arkOut.response_format.json_schema.name, 'ark_spec');
  assert.equal(arkOut.response_format.json_schema.strict, true);

  // Gemini returns generationConfig without name or strict
  const geminiOut = buildStructuredOutputFields('gemini', {
    schema,
    name: 'should_be_ignored',
    strict: false,
  });
  assert.deepEqual(geminiOut, {
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: normalizeSchema(schema),
    },
  });
  assert.equal(geminiOut.response_format, undefined);

  // Invalid protocol returns {}
  assert.deepEqual(buildStructuredOutputFields('claude', { schema }), {});
  assert.deepEqual(buildStructuredOutputFields(null, { schema }), {});

  // Omitted parameters default safely
  const bareOpenAi = buildStructuredOutputFields('openai');
  assert.equal(bareOpenAi.response_format.json_schema.name, 'structured_output');
  assert.equal(bareOpenAi.response_format.json_schema.strict, true);
  assert.equal(bareOpenAi.response_format.json_schema.schema, undefined);
});

test('unit: parseStructuredResult extracts text and parses valid JSON', () => {
  const data = { user: 'alice', score: 99 };
  const jsonText = JSON.stringify(data);

  // OpenAI / Ark format
  const openAiResp = {
    choices: [
      {
        message: {
          content: jsonText,
        },
      },
    ],
  };
  assert.deepEqual(parseStructuredResult('openai', openAiResp), { ok: true, value: data });
  assert.deepEqual(parseStructuredResult('ark', openAiResp), { ok: true, value: data });

  // Gemini format with thoughts filtered out
  const geminiResp = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'thinking...', thought: true },
            { text: '{"user":' },
            { text: '"alice",' },
            { text: '"score":99}' },
          ],
        },
      },
    ],
  };
  assert.deepEqual(parseStructuredResult('gemini', geminiResp), { ok: true, value: data });
});

test('unit: parseStructuredResult handles failure paths safely without throwing', () => {
  const notObjResp = parseStructuredResult('openai', 'raw string');
  assert.deepEqual(notObjResp, { ok: false, error: 'no text payload' });

  const nullResp = parseStructuredResult('gemini', null);
  assert.deepEqual(nullResp, { ok: false, error: 'no text payload' });

  const emptyObjResp = parseStructuredResult('openai', {});
  assert.deepEqual(emptyObjResp, { ok: false, error: 'no text payload' });

  const openAiNoContent = parseStructuredResult('openai', { choices: [{ message: {} }] });
  assert.deepEqual(openAiNoContent, { ok: false, error: 'no text payload' });

  const openAiEmptyWhitespace = parseStructuredResult('openai', {
    choices: [{ message: { content: '   \n  ' } }],
  });
  assert.deepEqual(openAiEmptyWhitespace, { ok: false, error: 'no text payload' });

  const geminiNoParts = parseStructuredResult('gemini', {
    candidates: [{ content: {} }],
  });
  assert.deepEqual(geminiNoParts, { ok: false, error: 'no text payload' });

  const geminiOnlyThoughts = parseStructuredResult('gemini', {
    candidates: [{ content: { parts: [{ text: 'only thought', thought: true }] } }],
  });
  assert.deepEqual(geminiOnlyThoughts, { ok: false, error: 'no text payload' });

  const malformedJson = parseStructuredResult('openai', {
    choices: [{ message: { content: '{ unquoted: 123 ' } }],
  });
  assert.equal(malformedJson.ok, false);
  assert(malformedJson.error.startsWith('invalid JSON'));

  const unsupportedProtocol = parseStructuredResult('anthropic', {
    choices: [{ message: { content: '{}' } }],
  });
  assert.deepEqual(unsupportedProtocol, { ok: false, error: 'unsupported protocol' });
});
