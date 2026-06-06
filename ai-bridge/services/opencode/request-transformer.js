/**
 * OpenCode request transformer.
 *
 * Ported from samueltuyizere/oc-go-cc (https://github.com/samueltuyizere/oc-go-cc)
 * internal/transformer/request.go to JavaScript.
 *
 * Converts an Anthropic-format `messages` request into the upstream wire format
 * expected by the OpenCode-compatible provider:
 *   - `/v1/messages` (Anthropic passthrough)         for Anthropic-native models
 *   - `/v1/chat/completions` (OpenAI Chat Completions) for the rest
 *
 * The transformer is intentionally faithful to the Go source so the behaviour
 * stays in lockstep with the reference implementation. The fields that don't
 * apply to webview-driven traffic (token counters, circuit breaker, fallback
 * chains) are elided — they live on the caller side, not here.
 */

// ---------------------------------------------------------------------------
// Model classification helpers
// ---------------------------------------------------------------------------

const ANTHROPIC_NATIVE_PREFIXES = [
  'minimax-',     // MiniMax family (MiniMax-M2.5, MiniMax-M2.7, ...)
];

/**
 * Returns true when the model should be routed to the Anthropic-native
 * upstream endpoint. The reference project treats minimax as the only
 * Anthropic-compatible family — every other model goes through the
 * OpenAI Chat Completions adapter.
 */
export function isAnthropicNativeModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  return ANTHROPIC_NATIVE_PREFIXES.some(p => modelId.toLowerCase().startsWith(p));
}

/**
 * Pick the upstream endpoint for a given model id.
 * Mirrors `client.ClassifyEndpoint` in the Go reference.
 */
export function classifyEndpoint(modelId) {
  if (isAnthropicNativeModel(modelId)) {
    return 'anthropic';
  }
  return 'openai';
}

// ---------------------------------------------------------------------------
// Anthropic → upstream request shape
// ---------------------------------------------------------------------------

/**
 * Top-level request shape produced by the transformer.
 * `endpoint` is one of 'anthropic' | 'openai' so the HTTP layer knows where
 * to send the body and how to parse the response.
 */
export function buildOpencodeRequest(anthropicReq, options = {}) {
  const modelId = anthropicReq?.model || options.model || '';
  const endpoint = classifyEndpoint(modelId);

  if (endpoint === 'anthropic') {
    return {
      endpoint: 'anthropic',
      path: '/v1/messages',
      body: buildAnthropicPassthrough(anthropicReq, modelId),
    };
  }

  return {
    endpoint: 'openai',
    path: '/v1/chat/completions',
    body: buildOpenaiChatRequest(anthropicReq, modelId),
  };
}

// ---------------------------------------------------------------------------
// Anthropic passthrough (for minimax-style models)
// ---------------------------------------------------------------------------

/**
 * Builds the body for /v1/messages. This is the same shape the Anthropic SDK
 * sends, so we forward it unchanged and only sanitise the model id.
 */
function buildAnthropicPassthrough(anthropicReq, modelId) {
  const body = { ...anthropicReq, model: modelId };
  // The webview caller always uses string `system`; keep the wire format
  // compatible with what the upstream expects.
  return body;
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions
// ---------------------------------------------------------------------------

const REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const DEEP_SEEK_PREFIX = 'deepseek-';
const OPENAI_REASONING_PREFIXES = ['o1-', 'o3-'];
const KIMI_PREFIX = 'kimi-';
const QWEN_PREFIX = 'qwen';

const isDeepSeek = (m) => typeof m === 'string' && m.toLowerCase().startsWith(DEEP_SEEK_PREFIX);
const isOpenAIReasoning = (m) => typeof m === 'string'
  && OPENAI_REASONING_PREFIXES.some(p => m.toLowerCase().startsWith(p));
const isKimi = (m) => typeof m === 'string' && m.toLowerCase().startsWith(KIMI_PREFIX);
const isQwen = (m) => typeof m === 'string' && m.toLowerCase().startsWith(QWEN_PREFIX);
const isAnthropicStyleReasoning = (m) => isKimi(m) || isQwen(m);

/**
 * Map Anthropic `budget_tokens` to an OpenAI `reasoning_effort` value.
 * The thresholds mirror `budgetTokensToEffort` in the Go reference.
 */
function budgetTokensToEffort(budget) {
  const b = Number(budget) || 0;
  if (b <= 2048) return 'low';
  if (b <= 8192) return 'medium';
  if (b <= 32768) return 'high';
  return 'max';
}

function parseBudgetTokens(thinking) {
  if (!thinking || typeof thinking !== 'object') return 0;
  const v = Number(thinking.budget_tokens);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function isThinkingDisabled(thinking) {
  return thinking && typeof thinking === 'object' && thinking.type === 'disabled';
}

function stripCacheControl(messages) {
  if (!Array.isArray(messages)) return;
  for (const m of messages) {
    if (m && 'cache_control' in m) {
      delete m.cache_control;
    }
  }
}

function setReasoningEffort(openaiReq, effort) {
  if (effort && REASONING_EFFORTS.has(effort)) {
    openaiReq.reasoning_effort = effort;
  } else {
    openaiReq.reasoning_effort = 'high';
  }
}

/**
 * Decide whether to attach `thinking` and `reasoning_effort` to the upstream
 * request. This is a faithful port of `resolveThinkingAndEffort` from the
 * Go reference.
 */
function resolveThinkingAndEffort(anthropicReq, openaiReq, modelId) {
  const messages = Array.isArray(anthropicReq?.messages) ? anthropicReq.messages : [];
  const hasThinking = hasThinkingBlocks(messages);
  const hasAssistant = messages.some(m => m && m.role === 'assistant');
  const requestThinkingDisabled = isThinkingDisabled(anthropicReq?.thinking);
  const requestThinking = !requestThinkingDisabled && !!anthropicReq?.thinking;
  const isDeep = isDeepSeek(modelId);
  const isReasoning = isOpenAIReasoning(modelId);
  const isAnthropicStyle = isAnthropicStyleReasoning(modelId);

  // Reasoning is meaningful on: o1/o3, deepseek, kimi, qwen.
  const allowEffort = isReasoning || isDeep || isAnthropicStyle;
  // `thinking` JSON param is meaningful on: kimi, qwen (Anthropic-style).
  const allowThinking = isAnthropicStyle;

  if (requestThinkingDisabled) {
    if (allowThinking) openaiReq.thinking = anthropicReq.thinking;
    return;
  }

  if (isDeep && hasAssistant && !hasThinking) {
    if (allowThinking) openaiReq.thinking = { type: 'disabled' };
    return;
  }

  if (requestThinking) {
    if (allowThinking) openaiReq.thinking = anthropicReq.thinking;
    if (allowEffort) {
      const budget = parseBudgetTokens(anthropicReq.thinking);
      if (budget > 0) {
        openaiReq.reasoning_effort = budgetTokensToEffort(budget);
      }
    }
    return;
  }

  if (hasThinking) {
    if (allowThinking) {
      openaiReq.thinking = { type: 'enabled' };
    }
    if (allowEffort) {
      setReasoningEffort(openaiReq, openaiReq.reasoning_effort);
    }
    return;
  }

  // No signal from the caller — leave both unset (matches Go default).
}

function hasThinkingBlocks(messages) {
  if (!Array.isArray(messages)) return false;
  for (const msg of messages) {
    if (!msg || msg.role !== 'assistant') continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && (block.type === 'thinking' || block.type === 'redacted_thinking')) {
        return true;
      }
    }
  }
  return false;
}

// ---- message content shaping -------------------------------------------------

function extractSystemText(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .filter(b => b && b.type === 'text')
      .map(b => b.text || '')
      .join('\n\n');
  }
  return '';
}

function buildTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((t) => {
    if (!t || typeof t !== 'object') return null;
    const name = t.name;
    if (!name) return null;
    const description = t.description || '';
    const inputSchema = t.input_schema || t.inputSchema || { type: 'object', properties: {} };
    return {
      type: 'function',
      function: { name, description, parameters: inputSchema },
    };
  }).filter(Boolean);
}

function contentBlockToText(block) {
  if (!block) return '';
  switch (block.type) {
    case 'text':
      return block.text || '';
    case 'image':
      return '[Image]';
    case 'tool_use':
      return `[Tool Use: ${block.name || 'unknown'}]`;
    case 'tool_result': {
      const c = block.content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) {
        return c
          .filter(b => b && b.type === 'text')
          .map(b => b.text || '')
          .join('\n');
      }
      return '';
    }
    case 'thinking':
    case 'redacted_thinking':
      return '';
    default:
      return '';
  }
}

function userContentToOpenAI(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  // If the user message contains a single text block, collapse to a string.
  if (content.length === 1 && content[0] && content[0].type === 'text') {
    return content[0].text || '';
  }
  // Multi-block: keep as an array of typed parts. Most OpenAI-compatible
  // servers accept `content: [{type:'text', text:'...'}, ...]`.
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text || '' });
    } else if (block.type === 'image' && block.source) {
      const src = block.source;
      if (src.type === 'base64') {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${src.media_type || 'image/png'};base64,${src.data || ''}` },
        });
      } else if (src.type === 'url') {
        parts.push({ type: 'image_url', image_url: { url: src.url || '' } });
      }
    }
  }
  return parts;
}

function assistantContentToOpenAI(content) {
  if (typeof content === 'string') {
    return { text: content, tool_calls: undefined };
  }
  if (!Array.isArray(content)) return { text: '', tool_calls: undefined };

  let text = '';
  const toolCalls = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text') {
      text += block.text || '';
    } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      // OpenAI Chat Completions has no native thinking block — collapse to
      // empty. The reasoning_effort field is what the upstream model reads.
      continue;
    } else if (block.type === 'tool_use') {
      let args = '';
      try {
        args = typeof block.input === 'string'
          ? block.input
          : JSON.stringify(block.input ?? {});
      } catch {
        args = '{}';
      }
      toolCalls.push({
        id: block.id || `tool_${toolCalls.length}`,
        type: 'function',
        function: {
          name: block.name || '',
          arguments: args,
        },
      });
    }
  }
  const out = { text };
  if (toolCalls.length > 0) out.tool_calls = toolCalls;
  return out;
}

function toolResultBlockToOpenAI(block) {
  if (!block) return null;
  const text = (() => {
    const c = block.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c
        .filter(b => b && b.type === 'text')
        .map(b => b.text || '')
        .join('\n');
    }
    return '';
  })();
  return {
    role: 'tool',
    tool_call_id: block.tool_use_id || '',
    content: text,
  };
}

/**
 * Convert Anthropic messages → OpenAI Chat Completions messages.
 * Mirrors the Go `transformMessage` helpers, with multi-block user content
 * flattened when possible to keep tokenisers happy.
 */
function transformMessages(anthropicReq, modelId) {
  const out = [];
  const sys = extractSystemText(anthropicReq?.system);
  if (sys) {
    const sysMsg = { role: 'system', content: sys };
    // kimi rejects cache_control, so we never set it.
    if (!isKimi(modelId) && Array.isArray(anthropicReq?.system)) {
      const withCache = anthropicReq.system.find(
        b => b && b.type === 'text' && b.cache_control
      );
      if (withCache) sysMsg.cache_control = withCache.cache_control;
    }
    out.push(sysMsg);
  }

  for (const msg of anthropicReq.messages || []) {
    if (!msg || !msg.role) continue;
    if (msg.role === 'user') {
      const content = userContentToOpenAI(msg.content);
      out.push({ role: 'user', content });
      continue;
    }
    if (msg.role === 'assistant') {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const toolUseBlocks = blocks.filter(b => b && b.type === 'tool_use');
      const hasToolResults = blocks.some(b => b && b.type === 'tool_result');

      if (hasToolResults) {
        // Defensive: shouldn't happen — tool results come from the user role.
        // Surface as a tool message anyway so the model sees the result.
        for (const block of blocks) {
          if (block && block.type === 'tool_result') {
            const t = toolResultBlockToOpenAI(block);
            if (t) out.push(t);
          }
        }
        continue;
      }

      const { text, tool_calls } = assistantContentToOpenAI(msg.content);
      const assistantMsg = { role: 'assistant', content: text || '' };
      if (tool_calls && tool_calls.length > 0) {
        assistantMsg.tool_calls = tool_calls;
      }
      out.push(assistantMsg);

      // After an assistant tool_use, pair each tool_use with a synthetic
      // tool result so the model context stays self-contained.
      for (const tu of toolUseBlocks) {
        out.push({
          role: 'tool',
          tool_call_id: tu.id || '',
          content: '',
        });
      }
      continue;
    }

    if (msg.role === 'tool' || msg.role === 'tool_result') {
      const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];
      for (const block of blocks) {
        const t = toolResultBlockToOpenAI({
          tool_use_id: msg.tool_use_id || block?.tool_use_id,
          content: block,
        });
        if (t) out.push(t);
      }
      continue;
    }

    // Fallback: stringify
    out.push({ role: msg.role, content: contentBlockToText({ type: 'text', text: msg.content }) });
  }
  return out;
}

function buildOpenaiChatRequest(anthropicReq, modelId) {
  const messages = transformMessages(anthropicReq, modelId);

  if (!isDeepSeek(modelId)) {
    stripCacheControl(messages);
  }

  const openaiReq = {
    model: modelId,
    messages,
  };
  if (anthropicReq?.stream === true || anthropicReq?.stream === false) {
    openaiReq.stream = !!anthropicReq.stream;
    if (openaiReq.stream) {
      openaiReq.stream_options = { include_usage: true };
    }
  }
  if (typeof anthropicReq?.temperature === 'number') {
    openaiReq.temperature = anthropicReq.temperature;
  }
  if (typeof anthropicReq?.top_p === 'number') {
    openaiReq.top_p = anthropicReq.top_p;
  }
  if (typeof anthropicReq?.max_tokens === 'number' && anthropicReq.max_tokens > 0) {
    openaiReq.max_tokens = anthropicReq.max_tokens;
  }

  resolveThinkingAndEffort(anthropicReq, openaiReq, modelId);

  const tools = buildTools(anthropicReq?.tools);
  if (tools) openaiReq.tools = tools;
  if (typeof anthropicReq?.tool_choice !== 'undefined') {
    openaiReq.tool_choice = anthropicReq.tool_choice;
  }

  return openaiReq;
}

export const __testing = {
  budgetTokensToEffort,
  parseBudgetTokens,
  isThinkingDisabled,
  classifyEndpoint,
  hasThinkingBlocks,
  transformMessages,
  buildOpenaiChatRequest,
  buildAnthropicPassthrough,
};
