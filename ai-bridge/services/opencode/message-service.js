/**
 * OpenCode message service.
 *
 * Top-level entry point invoked by `ai-bridge/channels/opencode-channel.js`.
 * Reads the per-request stdin payload, runs the upstream-side conversation
 * turn, and emits bridge tagged lines to stdout (mirroring the Claude side).
 *
 * Tagged lines used (subset of the Claude set — the opencode provider does
 * not run tools/MCP/permissions):
 *   [STREAM_START]
 *   [CONTENT_DELTA]"<json-escaped text>"
 *   [REASONING_DELTA]"<json-escaped text>"        -- for thinking/reasoning content
 *   [USAGE]{json}
 *   [SESSION_ID]<id>                              -- echoed from the request
 *   [MESSAGE_END]
 *   [SEND_ERROR]{json}                            -- upstream or transport error
 *   [STDIN_ERROR]                                 -- malformed stdin
 */

import { streamChatCompletion } from './client.js';
import { buildOpencodeRequest } from './request-transformer.js';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Send a single user turn to the opencode-compatible upstream.
 *
 * @param {object} stdin  Parsed stdin payload. Expected shape:
 *   {
 *     message: string,             -- user prompt (required)
 *     model: string,               -- model id, e.g., "big-pickle" (required)
 *     baseUrl: string,             -- upstream base URL (required)
 *     apiKey: string,              -- bearer token (required)
 *     sessionId?: string,          -- caller-supplied session id
 *     cwd?: string,                -- informational only
 *     systemPrompt?: string,       -- optional system prompt
 *     temperature?: number,
 *     maxTokens?: number,
 *     topP?: number,
 *     thinking?: { type: 'enabled' | 'disabled', budget_tokens?: number },
 *     tools?: Array<{name, description, input_schema}>,
 *   }
 * @returns {Promise<void>}
 */
export async function sendMessage(stdin) {
  const validation = validateStdin(stdin);
  if (validation) {
    emitError('STDIN_ERROR', validation);
    return;
  }

  const {
    message,
    model,
    baseUrl,
    apiKey,
    sessionId = '',
    systemPrompt = '',
    temperature,
    maxTokens,
    topP,
    thinking,
    tools,
  } = stdin;

  if (sessionId) {
    console.log(`[SESSION_ID]${sessionId}`);
  }
  console.log('[STREAM_START]');

  const anthropicReq = {
    model,
    system: systemPrompt || undefined,
    messages: [{ role: 'user', content: message }],
    stream: true,
  };
  if (typeof temperature === 'number') anthropicReq.temperature = temperature;
  if (typeof maxTokens === 'number' && maxTokens > 0) anthropicReq.max_tokens = maxTokens;
  if (typeof topP === 'number') anthropicReq.top_p = topP;
  if (thinking && typeof thinking === 'object') anthropicReq.thinking = thinking;
  if (Array.isArray(tools) && tools.length > 0) anthropicReq.tools = tools;

  const built = buildOpencodeRequest(anthropicReq, { model });
  if (built.endpoint !== 'openai') {
    // The transformer routes Anthropic-native models to the Anthropic
    // passthrough endpoint, but this service only ships the OpenAI
    // Chat Completions path. Surface a clear error so the caller can
    // reconfigure the model id.
    emitError('SEND_ERROR', `Endpoint "${built.endpoint}" is not supported by the opencode Node channel yet. Use a model that routes to the openai endpoint.`);
    return;
  }

  const body = built.body;

  try {
    await streamChatCompletion(
      { baseUrl, apiKey, body },
      {
        onChunk: (chunk) => {
          if (chunk.delta && chunk.delta.__done) return;
          if (typeof chunk.delta?.content === 'string' && chunk.delta.content.length > 0) {
            console.log(`[CONTENT_DELTA]${escapeJsonString(chunk.delta.content)}`);
          }
          if (typeof chunk.delta?.reasoning_content === 'string' && chunk.delta.reasoning_content.length > 0) {
            // Some opencode-compatible servers expose a separate reasoning_content field.
            console.log(`[REASONING_DELTA]${escapeJsonString(chunk.delta.reasoning_content)}`);
          }
          if (chunk.usage) {
            const usage = {
              inputTokens: Number(chunk.usage.prompt_tokens || 0),
              outputTokens: Number(chunk.usage.completion_tokens || 0),
            };
            console.log(`[USAGE]${JSON.stringify(usage)}`);
          }
        },
        onUsage: (usage) => {
          if (usage && (usage.promptTokens || usage.completionTokens)) {
            console.log(`[USAGE]${JSON.stringify({
              inputTokens: usage.promptTokens,
              outputTokens: usage.completionTokens,
            })}`);
          }
        },
        onError: (err) => {
          emitError('SEND_ERROR', err.message || String(err));
        },
      }
    );
  } catch (e) {
    // The HTTP path already surfaced the error via onError; nothing more to do.
    return;
  }

  console.log('[MESSAGE_END]');
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateStdin(stdin) {
  if (!stdin || typeof stdin !== 'object') {
    return 'stdin payload missing or not an object';
  }
  if (!stdin.message || typeof stdin.message !== 'string') {
    return 'stdin.message is required (string)';
  }
  if (!stdin.model || typeof stdin.model !== 'string') {
    return 'stdin.model is required (string)';
  }
  if (!stdin.baseUrl || typeof stdin.baseUrl !== 'string') {
    return 'stdin.baseUrl is required (string)';
  }
  if (!stdin.apiKey || typeof stdin.apiKey !== 'string') {
    return 'stdin.apiKey is required (string)';
  }
  return null;
}

function emitError(tag, message) {
  const payload = { error: String(message) };
  console.log(`[${tag}]${JSON.stringify(payload)}`);
}

function escapeJsonString(s) {
  return JSON.stringify(String(s));
}

export const __testing = {
  validateStdin,
};
