import type { ReasoningEffort } from '../components/ChatInputBox/types';
import { sendBridgeEvent } from '../utils/bridge';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_KEY = 'openrouter-catalog-cache-v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Upper bound on how long we wait for the Java bridge to answer a
 * `get_openrouter_catalog` request. A dropped bridge message, closed
 * webview, or backend exception would otherwise leak the pending Promise
 * forever.
 */
const BRIDGE_TIMEOUT_MS = 15000;

export interface OpenRouterModel {
  id: string;
  canonical_slug?: string;
  name?: string;
  description?: string;
  context_length: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string | null;
  };
  pricing?: {
    prompt: string;
    completion: string;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  supported_parameters?: string[];
  default_parameters?: Record<string, unknown>;
}

export interface ModelCapabilities {
  contextWindow: number;
  maxCompletionTokens?: number;
  supportedParameters: ReadonlyArray<string>;
  inputModalities: ReadonlyArray<string>;
  outputModalities: ReadonlyArray<string>;
  pricing?: { prompt: number; completion: number };
  reasoningLevels: ReadonlyArray<ReasoningEffort>;
  supportsImageInput: boolean;
  supportsAudioInput: boolean;
  supportsVideoInput: boolean;
  supportsToolUse: boolean;
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
  source: 'openrouter';
  fetchedAt: number;
}

interface CatalogCache {
  fetchedAt: number;
  models: OpenRouterModel[];
}

// ────────────────────────────────────────────────────────────────────
// Bridge path (Java backend proxies the upstream fetch).
// JCEF blocks direct `fetch()` from the renderer to external HTTPS
// endpoints, so the webview asks the IDE (via the existing
// sendToJava / window.onXxx bridge) to fetch the catalog.
// ────────────────────────────────────────────────────────────────────

interface BridgeRequest {
  resolve: (models: OpenRouterModel[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let pendingBridgeRequest: BridgeRequest | null = null;
let bridgeCallbackInstalled = false;
let inFlightBridgePromise: Promise<OpenRouterModel[]> | null = null;

function installBridgeCallback(): void {
  if (bridgeCallbackInstalled) return;
  bridgeCallbackInstalled = true;
  console.debug('[openRouterCatalog] installing window.onOpenRouterCatalog callback');
  window.onOpenRouterCatalog = (jsonString: string) => {
    console.debug(`[openRouterCatalog] bridge response received, length=${jsonString.length}`);
    const req = pendingBridgeRequest;
    if (!req) {
      console.debug('[openRouterCatalog] bridge response ignored (no pending request)');
      return;
    }
    pendingBridgeRequest = null;
    clearTimeout(req.timer);
    try {
      const payload = JSON.parse(jsonString) as {
        models?: OpenRouterModel[];
        ok?: boolean;
        error?: string;
      };
      const models = Array.isArray(payload.models) ? payload.models : [];
      console.debug('[openRouterCatalog] bridge payload parsed:', {
        ok: payload.ok,
        error: payload.error,
        modelsCount: models.length,
        firstId: models[0]?.id,
      });
      if (payload.ok === false) {
        req.reject(new Error(payload.error || 'bridge reported failure'));
      } else {
        req.resolve(models);
      }
    } catch (e) {
      console.error('[openRouterCatalog] bridge response parse failed:', e, jsonString.slice(0, 200));
      req.reject(e instanceof Error ? e : new Error(String(e)));
    }
  };
}

function isBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.sendToJava === 'function';
}

function fetchViaBridge(): Promise<OpenRouterModel[]> {
  console.debug('[openRouterCatalog] fetchViaBridge: start');
  if (!isBridgeAvailable()) {
    console.debug('[openRouterCatalog] fetchViaBridge: bridge unavailable (window.sendToJava missing)');
    return Promise.reject(new Error('bridge unavailable'));
  }
  if (inFlightBridgePromise) {
    console.debug('[openRouterCatalog] fetchViaBridge: joining existing in-flight request');
    return inFlightBridgePromise;
  }
  installBridgeCallback();
  inFlightBridgePromise = new Promise<OpenRouterModel[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingBridgeRequest) {
        pendingBridgeRequest = null;
      }
      console.warn(`[openRouterCatalog] fetchViaBridge: timeout after ${BRIDGE_TIMEOUT_MS}ms`);
      reject(new Error('bridge timeout'));
    }, BRIDGE_TIMEOUT_MS);
    pendingBridgeRequest = { resolve, reject, timer };
    try {
      console.debug('[openRouterCatalog] fetchViaBridge: sending get_openrouter_catalog event');
      sendBridgeEvent('get_openrouter_catalog', '');
    } catch (err) {
      pendingBridgeRequest = null;
      clearTimeout(timer);
      console.error('[openRouterCatalog] fetchViaBridge: sendBridgeEvent threw:', err);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }).finally(() => {
    inFlightBridgePromise = null;
  });
  return inFlightBridgePromise;
}

// ────────────────────────────────────────────────────────────────────
// Direct fetch fallback (used in non-JCEF dev mode and as a last resort
// when the bridge is unavailable / times out / reports an error).
// ────────────────────────────────────────────────────────────────────

function readCache(): CatalogCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.models)) return null;
    return parsed as CatalogCache;
  } catch {
    return null;
  }
}

function writeCache(cache: CatalogCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage unavailable or quota exceeded — non-fatal
  }
}

async function fetchDirect(): Promise<OpenRouterModel[]> {
  console.debug('[openRouterCatalog] fetchDirect: GET', OPENROUTER_MODELS_URL);
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Accept: 'application/json' },
  });
  console.debug('[openRouterCatalog] fetchDirect: status =', response.status);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  const models: OpenRouterModel[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  console.debug('[openRouterCatalog] fetchDirect: parsed models count =', models.length);
  return models;
}

// ────────────────────────────────────────────────────────────────────
// Public API.
// ────────────────────────────────────────────────────────────────────

export async function fetchOpenRouterCatalog(force = false): Promise<OpenRouterModel[]> {
  console.debug(`[openRouterCatalog] fetchOpenRouterCatalog(force=${force})`);
  if (!force) {
    const cached = readCache();
    if (cached) {
      const ageMs = Date.now() - cached.fetchedAt;
      const isFresh = ageMs < CACHE_TTL_MS;
      console.debug(`[openRouterCatalog] localStorage cache: ${cached.models.length} models, age=${Math.round(ageMs / 1000)}s, fresh=${isFresh}`);
      if (isFresh) {
        return cached.models;
      }
    } else {
      console.debug('[openRouterCatalog] localStorage cache: miss');
    }
  }

  // Primary path: Java backend proxy. Works in JCEF (production runtime).
  if (isBridgeAvailable()) {
    try {
      const models = await fetchViaBridge();
      if (models.length > 0) {
        writeCache({ fetchedAt: Date.now(), models });
        console.debug(`[openRouterCatalog] bridge success, cached ${models.length} models`);
        return models;
      }
      console.debug('[openRouterCatalog] bridge returned empty catalog, will try direct fetch');
    } catch (err) {
      console.warn('[openRouterCatalog] bridge fetch failed, falling back to direct fetch:', err);
    }
  } else {
    console.debug('[openRouterCatalog] bridge unavailable, using direct fetch');
  }

  // Fallback: direct fetch. Works in vite dev mode and any non-JCEF context.
  try {
    const models = await fetchDirect();
    if (models.length > 0) {
      writeCache({ fetchedAt: Date.now(), models });
    }
    return models;
  } catch (err) {
    const cached = readCache();
    if (cached && cached.models.length > 0) {
      console.warn('[openRouterCatalog] direct fetch failed, using stale cache:', err);
      return cached.models;
    }
    throw err;
  }
}

/**
 * One ranked match returned by `searchCatalog`.
 * `score` is a relative relevance number — higher is better, and an exact
 * normalized match is `Infinity` so it always sorts to the top.
 * `catalogIndex` is the original position in the source catalog; it is the
 * stable tiebreaker when two models receive the same score.
 */
export interface CatalogSearchResult {
  model: OpenRouterModel;
  score: number;
  catalogIndex: number;
}

const SUGGESTION_NAME_TOKEN_WEIGHT = 1;
const SUGGESTION_VERSION_TOKEN_WEIGHT = 1.5;
const SUGGESTION_PREFIX_TOKEN_WEIGHT = 0.5;
const SUGGESTION_ALL_QUERY_TOKENS_BONUS = 2;
const SUGGESTION_PREFIX_OF_CANDIDATE_BONUS = 1.5;
const SUGGESTION_EXTRA_TOKEN_PENALTY = 0.2;
const SUGGESTION_MIN_SCORE = 0.5;

export interface SearchCatalogOptions {
  limit?: number;
  minScore?: number;
}

/**
 * Return up to `limit` models from `catalog` that best match `query`,
 * ordered by relevance. Unlike `findModelInCatalog` (which returns a single
 * best match for capability lookup), this is designed to drive a live
 * suggestion list as the user types.
 *
 * Matching rules:
 * 1. Tier 1: exact normalized id match → always returned first (score = Infinity).
 * 2. Tier 2: token overlap. A query token that exactly matches a candidate
 *    token scores fully; a query token that is a prefix of a candidate
 *    token (>= 2 chars) scores partially. Extras are mildly penalised so
 *    the list isn't dominated by long ids.
 * 3. Version safety: any numeric token in the query must appear in the
 *    candidate, otherwise the candidate is dropped (so `gpt-4` never
 *    matches `gpt-3.5`).
 * 4. Results below `minScore` are dropped. Candidates are returned sorted
 *    by score desc, then by id length asc (more specific first).
 */
export function searchCatalog(
  catalog: ReadonlyArray<OpenRouterModel>,
  query: string,
  options: SearchCatalogOptions = {}
): OpenRouterModel[] {
  const { limit = 8, minScore = SUGGESTION_MIN_SCORE } = options;
  if (!query) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];
  const queryNormalized = normalizeModelId(trimmed);
  if (!queryNormalized) return [];
  console.debug(`[openRouterCatalog] searchCatalog: query="${trimmed}" normalized="${queryNormalized}" catalog=${catalog.length} limit=${limit}`);

  // Tier 1: exact normalized match against id and canonical_slug. We keep
  // collecting Tier 2 matches so the suggestion list still shows related
  // models alongside the exact hit.
  const exactMatches = new Set<OpenRouterModel>();
  for (const m of catalog) {
    if (normalizeModelId(m.id) === queryNormalized) {
      exactMatches.add(m);
    }
    if (m.canonical_slug && normalizeModelId(m.canonical_slug) === queryNormalized) {
      exactMatches.add(m);
    }
  }

  const queryTokens = tokenizeModelId(trimmed);
  if (queryTokens.length === 0) {
    return Array.from(exactMatches).slice(0, limit);
  }

  const results: CatalogSearchResult[] = [];
  catalog.forEach((m, catalogIndex) => {
    if (exactMatches.has(m)) return;
    for (const candidateId of [m.id, m.canonical_slug]) {
      if (!candidateId) continue;
      const candidateTokens = tokenizeModelId(candidateId);
      if (candidateTokens.length === 0) continue;
      const stripped = shouldStripVendor(candidateTokens, queryTokens)
        ? candidateTokens.slice(1)
        : candidateTokens;
      const score = scoreSuggestion(queryTokens, stripped);
      if (score >= minScore) {
        results.push({ model: m, score, catalogIndex });
        break; // don't score the same model against both id and canonical_slug
      }
    }
  });

  // Primary sort: relevance desc. Tiebreaker: original catalog order, so
  // ties resolve to whatever the upstream feed surfaced first (e.g.
  // OpenRouter's "top picks" for the day).
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.catalogIndex - b.catalogIndex;
  });

  const top = results.slice(0, limit).map((r) => r.model);

  // Prepend exact matches in catalog order, capped at `limit`.
  const finalList: OpenRouterModel[] = [];
  for (const m of exactMatches) {
    if (finalList.length >= limit) break;
    finalList.push(m);
  }
  for (const m of top) {
    if (finalList.length >= limit) break;
    if (finalList.includes(m)) continue;
    finalList.push(m);
  }

  console.debug(`[openRouterCatalog] searchCatalog: ${finalList.length} matches`, finalList.map((m) => m.id));
  return finalList;
}

function scoreSuggestion(
  queryTokens: ReadonlyArray<string>,
  candidateTokens: ReadonlyArray<string>
): number {
  // Version safety: every numeric token in the query must have a matching
  // (or prefix-matching) candidate token. Uses a `startsWith` comparison
  // so that `4` matches `4o`, `4-turbo`, `4.5`, etc. — but not `3`/`40`/etc.
  const queryVersions = queryTokens.filter((t) => /^\d/.test(t));
  if (queryVersions.length > 0) {
    const versionTokens = candidateTokens.filter((t) => /^\d/.test(t));
    for (const v of queryVersions) {
      const ok = versionTokens.some((t) => t.startsWith(v));
      if (!ok) return -Infinity;
    }
  }

  const querySet = new Set(queryTokens);
  let score = 0;
  let matched = 0;
  let extra = 0;

  for (const t of candidateTokens) {
    if (querySet.has(t)) {
      matched += 1;
      score += /^\d/.test(t) ? SUGGESTION_VERSION_TOKEN_WEIGHT : SUGGESTION_NAME_TOKEN_WEIGHT;
      continue;
    }
    // Prefix match: query token (length >= 2) is a prefix of the candidate
    // token. Gives partial credit so "anthro" still surfaces "anthropic".
    const prefixMatched = queryTokens.some(
      (qt) => qt.length >= 2 && t.length > qt.length && t.startsWith(qt)
    );
    if (prefixMatched) {
      matched += 1;
      score += SUGGESTION_PREFIX_TOKEN_WEIGHT;
    } else {
      extra += 1;
    }
  }

  // Bonus: every query token matched → high-confidence hit.
  if (matched >= queryTokens.length) {
    score += SUGGESTION_ALL_QUERY_TOKENS_BONUS;
  }

  // Bonus: the candidate's leading token equals the query's leading token
  // (e.g. typing "openai" against "openai/gpt-4o"). Helps rank vendor hits
  // above unrelated models that share a substring.
  if (candidateTokens.length > 0 && candidateTokens[0] === queryTokens[0]) {
    score += SUGGESTION_PREFIX_OF_CANDIDATE_BONUS;
  }

  score -= extra * SUGGESTION_EXTRA_TOKEN_PENALTY;
  return score;
}

export function findModelInCatalog(catalog: OpenRouterModel[], id: string): OpenRouterModel | undefined {
  if (!id) return undefined;
  const query = id.trim();
  if (!query) return undefined;
  const queryNormalized = normalizeModelId(query);
  if (!queryNormalized) return undefined;
  console.debug(`[openRouterCatalog] findModelInCatalog: query="${query}" normalized="${queryNormalized}" catalog=${catalog.length}`);

  // Tier 1: exact normalized match against id and canonical_slug.
  for (const m of catalog) {
    if (normalizeModelId(m.id) === queryNormalized) {
      console.debug(`[openRouterCatalog] Tier 1 hit on id: ${m.id}`);
      return m;
    }
    if (m.canonical_slug && normalizeModelId(m.canonical_slug) === queryNormalized) {
      console.debug(`[openRouterCatalog] Tier 1 hit on canonical_slug: ${m.canonical_slug}`);
      return m;
    }
  }

  // Tier 2: bidirectional token-overlap scoring. Each candidate is scored
  // twice — once with its full id, once with the leading vendor token
  // stripped (e.g. `anthropic/claude-sonnet-4-6` is also tried as
  // `claude-sonnet-4-6`). The best of the two is kept.
  const queryTokens = tokenizeModelId(query);
  if (queryTokens.length === 0) return undefined;

  let best: { model: OpenRouterModel; score: number } | null = null;
  for (const m of catalog) {
    // Try both the main id and canonical_slug for each model.
    for (const candidateId of [m.id, m.canonical_slug]) {
      if (!candidateId) continue;
      const candidateTokens = tokenizeModelId(candidateId);
      if (candidateTokens.length === 0) continue;

      const direct = scoreMatch(queryTokens, candidateTokens, false);
      const stripped = shouldStripVendor(candidateTokens, queryTokens)
        ? scoreMatch(queryTokens, candidateTokens, true)
        : -Infinity;
      const score = Math.max(direct, stripped);

      if (best === null || score > best.score) {
        best = { model: m, score };
      }
    }
  }

  if (best && best.score >= MIN_MATCH_SCORE) {
    console.debug(`[openRouterCatalog] Tier 2 hit: best=${best.model.id} score=${best.score.toFixed(2)} (threshold=${MIN_MATCH_SCORE})`);
    return best.model;
  }
  if (best) {
    console.debug(`[openRouterCatalog] Tier 2 best below threshold: ${best.model.id} score=${best.score.toFixed(2)} (threshold=${MIN_MATCH_SCORE})`);
  }
  return undefined;
}

/**
 * Normalize a model id for equality comparison and tokenization.
 * - Lowercase
 * - Whitespace, `/`, `_` → `-`
 * - `.` → `-` (so `4.6` and `4-6` are equivalent)
 * - Strip `[1m]` / `[200k]` context suffixes
 * - Strip 8-digit date suffixes (e.g. `-20260211`)
 * - Collapse runs of `-` and trim
 */
export function normalizeModelId(id: string): string {
  return id
    .toLowerCase()
    .trim()
    .replace(/[\s/_]+/g, '-')
    .replace(/\./g, '-')
    .replace(/\[.*?\]/g, '')
    .replace(/-\d{8}$/, '')    // strip trailing -YYYYMMDD date suffix
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Tokenize a (possibly mixed-format) model id into a comparable token list.
 * Strips 8-digit date suffixes (e.g. `-20241022`) so dated and undated
 * variants of the same model match.
 */
export function tokenizeModelId(id: string): string[] {
  return normalizeModelId(id)
    .split('-')
    .filter(Boolean)
    .filter(t => !/^\d{8}$/.test(t));
}

function shouldStripVendor(candidateTokens: ReadonlyArray<string>, queryTokens: ReadonlyArray<string>): boolean {
  if (candidateTokens.length < 2) return false;
  const first = candidateTokens[0];
  // Only strip a leading alphabetic token that the user didn't include —
  // that's the "vendor prefix" pattern (anthropic/, openai/, minimax/).
  if (!/^[a-z]/.test(first)) return false;
  if (queryTokens.includes(first)) return false;
  // Don't strip when the user typed a prefix of the vendor — e.g. "anthro"
  // is clearly an attempt to match "anthropic/*" models.
  const isPrefixOfVendor = queryTokens.some(
    (qt) => qt.length >= 2 && first.length > qt.length && first.startsWith(qt)
  );
  return !isPrefixOfVendor;
}

const SCORE_VERSION_TOKEN = 2;
const SCORE_NAME_TOKEN = 1;
const SCORE_EXTRA_TOKEN_PENALTY = 0.5;
const SCORE_VERSION_MISMATCH_PENALTY = 4;
const MIN_MATCH_SCORE = 2.5;

function scoreMatch(
  queryTokens: ReadonlyArray<string>,
  candidateTokens: ReadonlyArray<string>,
  stripVendor: boolean
): number {
  const tokens = stripVendor ? candidateTokens.slice(1) : candidateTokens;
  if (tokens.length === 0) return -Infinity;

  const querySet = new Set(queryTokens);
  let score = 0;
  let extra = 0;
  for (const t of tokens) {
    if (querySet.has(t)) {
      score += /^\d/.test(t) ? SCORE_VERSION_TOKEN : SCORE_NAME_TOKEN;
    } else {
      extra += 1;
    }
  }
  score -= extra * SCORE_EXTRA_TOKEN_PENALTY;

  // Version safety: if the user specified version numbers, every one of
  // them must appear in the candidate, otherwise treat as a different
  // model (e.g. `claude-sonnet-4-6` should not silently match
  // `claude-sonnet-4-5`).
  const queryVersions = queryTokens.filter(t => /^\d/.test(t));
  if (queryVersions.length > 0) {
    const candidateVersionSet = new Set(tokens.filter(t => /^\d/.test(t)));
    for (const v of queryVersions) {
      if (!candidateVersionSet.has(v)) {
        score -= SCORE_VERSION_MISMATCH_PENALTY;
      }
    }
  }
  return score;
}

/**
 * Derive UI-relevant capabilities from raw OpenRouter metadata.
 *
 * Reasoning effort levels are inferred from `supported_parameters`:
 *   - `reasoning_effort` (OpenAI-style enum) → low/medium/high
 *   - `reasoning` (Anthropic-style)          → low/medium/high/max
 * When both are present, prefer the OpenAI-style since `reasoning_effort`
 * is the more specific contract. Neither → empty (selector hidden).
 */
export function deriveCapabilities(model: OpenRouterModel): ModelCapabilities {
  const params = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
  const arch = model.architecture ?? {};
  const inputs = Array.isArray(arch.input_modalities) ? arch.input_modalities : [];
  const outputs = Array.isArray(arch.output_modalities) ? arch.output_modalities : [];

  const hasReasoning = params.includes('reasoning') || params.includes('include_reasoning');
  const hasReasoningEffort = params.includes('reasoning_effort');

  let reasoningLevels: ReasoningEffort[] = [];
  if (hasReasoningEffort) {
    reasoningLevels = ['low', 'medium', 'high'];
  } else if (hasReasoning) {
    reasoningLevels = ['low', 'medium', 'high', 'max'];
  }

  const pricing = model.pricing
    ? {
        prompt: Number.parseFloat(model.pricing.prompt),
        completion: Number.parseFloat(model.pricing.completion),
      }
    : undefined;

  return {
    contextWindow: model.context_length,
    maxCompletionTokens: model.top_provider?.max_completion_tokens,
    supportedParameters: params,
    inputModalities: inputs,
    outputModalities: outputs,
    pricing: pricing && Number.isFinite(pricing.prompt) && Number.isFinite(pricing.completion) ? pricing : undefined,
    reasoningLevels,
    supportsImageInput: inputs.includes('image'),
    supportsAudioInput: inputs.includes('audio'),
    supportsVideoInput: inputs.includes('video'),
    supportsToolUse: params.includes('tools') || params.includes('tool_choice'),
    supportsStructuredOutput: params.includes('structured_outputs') || params.includes('response_format'),
    supportsReasoning: hasReasoning || hasReasoningEffort,
    source: 'openrouter',
    fetchedAt: Date.now(),
  };
}

export async function lookupModelCapabilities(id: string): Promise<ModelCapabilities | null> {
  if (!id || !id.trim()) return null;
  const trimmed = id.trim();
  console.debug(`[openRouterCatalog] lookupModelCapabilities("${trimmed}") start`);
  try {
    const catalog = await fetchOpenRouterCatalog();
    console.debug('[openRouterCatalog] catalog size:', catalog.length, 'query:', trimmed);
    const model = findModelInCatalog(catalog, trimmed);
    if (!model) {
      console.warn('[openRouterCatalog] no match for:', trimmed);
      return null;
    }
    console.debug('[openRouterCatalog] matched:', model.id, '→ deriving capabilities');
    const caps = deriveCapabilities(model);
    console.debug('[openRouterCatalog] derived capabilities:', {
      contextWindow: caps.contextWindow,
      reasoningLevels: caps.reasoningLevels,
      supportsImageInput: caps.supportsImageInput,
      supportsReasoning: caps.supportsReasoning,
      supportedParameters: caps.supportedParameters,
      pricing: caps.pricing,
    });
    return caps;
  } catch (error) {
    console.warn('[openRouterCatalog] lookup failed for', trimmed, error);
    return null;
  }
}

export function clearCatalogCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Heuristic source of a model id — used to pick a sane default capability
 * profile when the model is not in the OpenRouter catalog. The returned
 * `ModelCapabilities` is always marked `source: 'default'` so callers can
 * distinguish catalog-derived data from inferred defaults.
 *
 * Profiles:
 *  - `claude`        → Anthropic Claude family (200K ctx, image+tools)
 *  - `claude-mapping` → ANTHROPIC_DEFAULT_*_MODEL proxy values (same as Claude)
 *  - `custom`         → user-defined custom model (text-only, no defaults)
 */
export type ModelCapabilityProfile = 'claude' | 'claude-mapping' | 'custom';

export function inferCapabilityProfile(modelId: string): ModelCapabilityProfile {
  const id = (modelId || '').trim().toLowerCase();
  if (!id) return 'custom';
  if (id.includes('claude')) return 'claude';
  return 'custom';
}

export function defaultCapabilitiesFor(
  modelId: string,
  profile: ModelCapabilityProfile = inferCapabilityProfile(modelId),
  contextWindowOverride?: number
): ModelCapabilities {
  const baseContext = 200_000;
  const resolvedContext =
    typeof contextWindowOverride === 'number' && contextWindowOverride > 0
      ? contextWindowOverride
      : baseContext;

  if (profile === 'custom') {
    return {
      contextWindow: resolvedContext,
      supportedParameters: [],
      inputModalities: [],
      outputModalities: [],
      reasoningLevels: [],
      supportsImageInput: false,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsToolUse: false,
      supportsStructuredOutput: false,
      supportsReasoning: false,
      source: 'openrouter',
      fetchedAt: Date.now(),
    };
  }

  return {
    contextWindow: resolvedContext,
    supportedParameters: ['tools', 'tool_choice'],
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsImageInput: true,
    supportsAudioInput: false,
    supportsVideoInput: false,
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsReasoning: true,
    source: 'openrouter',
    fetchedAt: Date.now(),
  };
}
