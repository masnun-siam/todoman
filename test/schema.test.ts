import { expect, it } from 'vitest';
import { PARSER_SCHEMA } from '../src/schema.js';

it('allows the four item types and no keys', () => {
  const item = PARSER_SCHEMA.properties.items.items;
  expect(item.properties.type.enum).toEqual(['task', 'meeting', 'tracking', 'summary']);
  expect(Object.keys(item.properties)).not.toContain('key');
  expect(item.additionalProperties).toBe(false);
});
