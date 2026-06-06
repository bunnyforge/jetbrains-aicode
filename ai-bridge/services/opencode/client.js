/**
 * OpenCode HTTP client.
 *
 * Streamed chat completion over the opencode proxy. The client accepts a
 * pre-converted upstream-format body (typically produced by
 * `request-transformer.js`) and POSTs it to `<baseUrl>/chat/completions`.
 *
 * Response is an OpenAI-style SSE stream of `chat.completion.chunk` payloads.
 * For each chunk the client emits a structured event to the caller. The caller
 * is responsible for mapping events to bridge tagged lines.
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open a streaming chat completion.
 *
 * @param {object} params
 * @param {string} params.baseUrl      Upstream base URL (no trailing slash, no /chat/completions suffix).
 * @param {string} params.apiKey       Bearer token to send as `Authorization: Bearer <apiKey>`.
 * @param {object} params.body         Upstream-format request body (already converted from Anthropic format).
 * @param {object} [params.signal]     AbortSignal to cancel the request.
 * @param {object} callbacks
 * @param {(chunk:{id?:string, model?:string, delta:object, finishReason?:string, usage?:object}) => void} callbacks.onChunk
 * @param {(usage:{promptTokens:number, completionTokens:number}) => void} [callbacks.onUsage]
 * @param {(err:Error) => void} [callbacks.onError]
 * @param {() => void} [callbacks.onClose]
 * @returns {Promise<void>}  Resolves when the stream is fully consumed or aborted.
 */
export function streamChatCompletion(params, callbacks) {
  const { baseUrl, apiKey, body, signal } = params || {};
  const { onChunk, onUsage, onError, onClose } = callbacks || {};

  if (!baseUrl || typeof baseUrl !== 'string') {
    return Promise.reject(new Error('streamChatCompletion: baseUrl is required'));
  }
  if (!apiKey || typeof apiKey !== 'string') {
    return Promise.reject(new Error('streamChatCompletion: apiKey is required'));
  }
  if (!body || typeof body !== 'object') {
    return Promise.reject(new Error('streamChatCompletion: body is required'));
  }

  const url = new URL(normalizeBaseUrl(baseUrl) + '/chat/completions');
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'jetbrains-aicode-opencode-bridge/1.0',
        },
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          // Drain the body so the socket can be reused, then surface a useful error.
          const chunks = [];
          res.setEncoding('utf8');
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = chunks.join('');
            const err = new Error(
              `OpenCode upstream HTTP ${res.statusCode}: ${truncate(text, 500)}`
            );
            err.status = res.statusCode;
            err.body = text;
            try { onError && onError(err); } catch { /* noop */ }
            reject(err);
          });
          return;
        }

        let buffer = '';
        let aborted = false;
        res.setEncoding('utf8');

        const onAbort = () => {
          if (aborted) return;
          aborted = true;
          try { req.destroy(new Error('aborted')); } catch { /* noop */ }
        };
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }

        res.on('data', (chunk) => {
          if (aborted) return;
          buffer += chunk;
          // SSE blocks are delimited by a blank line. Split on \n\n and
          // process each block individually, retaining any partial tail.
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            try {
              parseSseBlockEvents(raw, onChunk, onUsage);
            } catch (e) {
              try { onError && onError(e); } catch { /* noop */ }
            }
          }
        });

        res.on('end', () => {
          if (aborted) return;
          // Flush any trailing SSE block (no final blank line).
          if (buffer.trim().length > 0) {
            try {
              parseSseBlockEvents(buffer, onChunk, onUsage);
            } catch (e) {
              try { onError && onError(e); } catch { /* noop */ }
            }
          }
          try { onClose && onClose(); } catch { /* noop */ }
          resolve();
        });

        res.on('error', (err) => {
          if (aborted) return;
          try { onError && onError(err); } catch { /* noop */ }
          reject(err);
        });
      }
    );

    req.on('error', (err) => {
      try { onError && onError(err); } catch { /* noop */ }
      reject(err);
    });

    try {
      req.write(JSON.stringify(body));
      req.end();
    } catch (e) {
      try { onError && onError(e); } catch { /* noop */ }
      reject(e);
    }
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Strip trailing slashes; append the versioned path if the user provided a
 * bare origin (e.g., `https://api.opencode.ai`). Both `https://api.opencode.ai/`
 * and `https://api.opencode.ai/v1` are accepted; we never append `/v1`
 * silently because the Go proxy uses `/v1` while the Zen gateway uses `/v1`.
 */
function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Parse a single SSE block (no trailing blank line required) and dispatch
 * any `data:` payloads to the chunk callback. The `[DONE]` sentinel is
 * forwarded as `delta: { __done: true }` so the caller can stop.
 */
function parseSseBlockEvents(raw, onChunk, onUsage) {
  if (!raw) return;
  const lines = raw.split(/\r?\n/);
  let event;
  let dataLines = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue; // comment
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return;
  const data = dataLines.join('\n');
  if (data === '[DONE]') {
    if (onChunk) onChunk({ delta: { __done: true } });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    return; // ignore non-JSON payloads (some servers send keep-alives)
  }
  if (payload.usage) {
    const prompt = Number(payload.usage.prompt_tokens || 0);
    const completion = Number(payload.usage.completion_tokens || 0);
    if (onUsage) onUsage({ promptTokens: prompt, completionTokens: completion });
  }
  if (onChunk) {
    onChunk({
      id: payload.id,
      model: payload.model,
      delta: payload.choices?.[0]?.delta || {},
      finishReason: payload.choices?.[0]?.finish_reason || null,
      usage: payload.usage || null,
    });
  }
}

function truncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

export const __testing = {
  normalizeBaseUrl,
  parseSseBlockEvents,
};
