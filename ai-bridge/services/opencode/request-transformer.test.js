/**
 * Unit tests for the OpenCode request transformer.
 *
 * Verifies the Anthropic → upstream format conversion that the opencode
 * Node channel applies before sending to the upstream provider.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  buildOpencodeRequest,
  classifyEndpoint,
  isAnthropicNativeModel,
} from './request-transformer.js';

test('classifyEndpoint: Anthropic-native prefix (MiniMax) routes to Anthropic passthrough', () => {
  assert.equal(classifyEndpoint('minimax-m2.5'), 'anthropic');
  assert.equal(classifyEndpoint('MiniMax-M2.7'), 'anthropic');
  assert.equal(isAnthropicNativeModel('minimax-m2.5'), true);
});

test('classifyEndpoint: all other models route to OpenAI Chat Completions', () => {
  assert.equal(classifyEndpoint('big-pickle'), 'openai');
  assert.equal(classifyEndpoint('gpt-4o'), 'openai');
  assert.equal(classifyEndpoint('kimi-k2.5'), 'openai');
  assert.equal(classifyEndpoint(''), 'openai');
});

test('buildOpencodeRequest: OpenAI path emits a chat/completions body', () => {
  const result = buildOpencodeRequest({
    model: 'big-pickle',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 1024,
    temperature: 0.5,
    stream: true,
  });
  assert.equal(result.endpoint, 'openai');
  assert.equal(result.path, '/v1/chat/completions');
  assert.equal(result.body.model, 'big-pickle');
  assert.equal(result.body.stream, true);
  assert.equal(result.body.max_tokens, 1024);
  assert.equal(result.body.temperature, 0.5);
  assert.equal(result.body.messages[0].role, 'user');
  assert.equal(result.body.messages[0].content, 'hello');
});

test('buildOpencodeRequest: Anthropic passthrough returns the body unchanged', () => {
  const anthropicReq = {
    model: 'minimax-m2.5',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 256,
  };
  const result = buildOpencodeRequest(anthropicReq);
  assert.equal(result.endpoint, 'anthropic');
  assert.equal(result.path, '/v1/messages');
  assert.equal(result.body.model, 'minimax-m2.5');
  assert.equal(result.body.messages[0].content, 'hi');
});

test('buildOpencodeRequest: system prompt is forwarded as a system message', () => {
  const result = buildOpencodeRequest({
    model: 'big-pickle',
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(result.body.messages[0].role, 'system');
  assert.equal(result.body.messages[0].content, 'You are a helpful assistant.');
  assert.equal(result.body.messages[1].role, 'user');
});

test('buildOpencodeRequest: tools are reshaped to OpenAI function format', () => {
  const result = buildOpencodeRequest({
    model: 'big-pickle',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [
      {
        name: 'get_weather',
        description: 'Get the weather for a city',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
  });
  assert.equal(result.body.tools[0].type, 'function');
  assert.equal(result.body.tools[0].function.name, 'get_weather');
  assert.deepEqual(result.body.tools[0].function.parameters.properties, { city: { type: 'string' } });
});

test('buildOpencodeRequest: assistant tool_use is mapped to tool_calls', () => {
  const result = buildOpencodeRequest({
    model: 'big-pickle',
    messages: [
      { role: 'user', content: 'weather in tokyo?' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'get_weather',
            input: { city: 'Tokyo' },
          },
        ],
      },
    ],
  });
  const assistant = result.body.messages[1];
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.tool_calls[0].id, 'tool_1');
  assert.equal(assistant.tool_calls[0].function.name, 'get_weather');
  // tool_use id is paired with a tool role stub so the conversation stays well-formed.
  assert.equal(result.body.messages[2].role, 'tool');
  assert.equal(result.body.messages[2].tool_call_id, 'tool_1');
});

test('buildOpencodeRequest: strips context suffix from non-Claude model ids', () => {
  // The Java bridge strips suffix before forwarding, so the transformer
  // sees a clean id. Verify it passes through unchanged.
  const result = buildOpencodeRequest({
    model: 'big-pickle',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(result.body.model, 'big-pickle');
});

test('buildOpencodeRequest: stream_options include_usage is set when streaming', () => {
  const result = buildOpencodeRequest({
    model: 'big-pickle',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });
  assert.equal(result.body.stream, true);
  assert.deepEqual(result.body.stream_options, { include_usage: true });
});
