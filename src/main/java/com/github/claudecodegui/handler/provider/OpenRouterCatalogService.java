package com.github.claudecodegui.handler.provider;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.diagnostic.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

/**
 * Fetches the OpenRouter model catalog.
 *
 * <p>Why this lives in Java and not in the webview renderer:
 * JCEF (the embedded Chromium used by IntelliJ's webview) blocks direct
 * {@code fetch()} from the renderer to arbitrary external HTTPS endpoints —
 * the renderer is sandboxed and has no unrestricted network access. The webview
 * is therefore routed through this service, which uses the JDK {@link HttpClient}
 * running on the IDE's network stack. This has the side benefit of surviving
 * plugins that disable webview network access entirely.
 *
 * <p>Results are cached in-process for 24h. The cache is process-scoped and
 * is rebuilt on every IDE start; the webview maintains a longer-lived
 * localStorage cache that survives restarts.
 *
 * <p>Concurrency: a single in-flight upstream request is shared across all
 * concurrent callers (one HttpClient round-trip per 24h, regardless of how
 * many times the webview asks).
 */
public class OpenRouterCatalogService {

    private static final Logger LOG = Logger.getInstance(OpenRouterCatalogService.class);

    private static final String OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);
    private static final long CACHE_TTL_MS = 24L * 60L * 60L * 1000L;

    private static final OpenRouterCatalogService INSTANCE = new OpenRouterCatalogService();

    public static OpenRouterCatalogService getInstance() {
        return INSTANCE;
    }

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT)
            .build();

    private final Object lock = new Object();
    private volatile JsonArray cachedModels;
    private volatile long cachedAtMs;
    private volatile CompletableFuture<JsonArray> inFlight;

    private OpenRouterCatalogService() {
    }

    /**
     * Return the model catalog. Caches results for 24h. Concurrent callers
     * share a single upstream request when the cache is cold.
     */
    public CompletableFuture<JsonArray> getCatalog() {
        JsonArray cached = cachedModels;
        if (cached != null && isFresh(cachedAtMs)) {
            return CompletableFuture.completedFuture(cached);
        }
        synchronized (lock) {
            if (cachedModels != null && isFresh(cachedAtMs)) {
                return CompletableFuture.completedFuture(cachedModels);
            }
            if (inFlight != null) {
                return inFlight;
            }
            inFlight = fetchFromUpstream();
            return inFlight;
        }
    }

    /**
     * Drop the in-memory cache. Test-only — production code should let the
     * 24h TTL expire naturally.
     */
    void clearCache() {
        synchronized (lock) {
            cachedModels = null;
            cachedAtMs = 0L;
            inFlight = null;
        }
    }

    private CompletableFuture<JsonArray> fetchFromUpstream() {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(OPENROUTER_MODELS_URL))
                .timeout(REQUEST_TIMEOUT)
                .header("Accept", "application/json")
                .header("User-Agent", "jetbrains-aicode-plugin/0.4.4")
                .GET()
                .build();

        return httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenApply(this::parseAndValidate)
                .handle((result, error) -> {
                    synchronized (lock) {
                        inFlight = null;
                    }
                    if (error != null) {
                        Throwable cause = error instanceof CompletionException && error.getCause() != null
                                ? error.getCause()
                                : error;
                        LOG.warn("[OpenRouterCatalog] upstream fetch failed: " + cause.getMessage());
                        throw new OpenRouterCatalogException(cause);
                    }
                    cachedModels = result;
                    cachedAtMs = System.currentTimeMillis();
                    LOG.info("[OpenRouterCatalog] cached " + result.size() + " models");
                    return result;
                });
    }

    private JsonArray parseAndValidate(HttpResponse<String> response) {
        if (response.statusCode() != 200) {
            throw new OpenRouterCatalogException(
                    "OpenRouter returned HTTP " + response.statusCode());
        }
        String body = response.body();
        if (body == null || body.isEmpty()) {
            throw new OpenRouterCatalogException("OpenRouter returned an empty body");
        }
        try {
            JsonElement root = JsonParser.parseString(body);
            if (root.isJsonObject()) {
                JsonObject obj = root.getAsJsonObject();
                if (obj.has("data") && obj.get("data").isJsonArray()) {
                    return obj.getAsJsonArray("data");
                }
            } else if (root.isJsonArray()) {
                return root.getAsJsonArray();
            }
            throw new OpenRouterCatalogException(
                    "OpenRouter response did not contain a model array");
        } catch (RuntimeException e) {
            throw new OpenRouterCatalogException(
                    "Failed to parse OpenRouter response: " + e.getMessage(), e);
        }
    }

    private static boolean isFresh(long fetchedAtMs) {
        return fetchedAtMs > 0L && System.currentTimeMillis() - fetchedAtMs < CACHE_TTL_MS;
    }

    /**
     * Signals a failure to fetch the catalog. The webview falls back to its
     * own localStorage cache or direct fetch on this signal.
     */
    public static final class OpenRouterCatalogException extends RuntimeException {
        public OpenRouterCatalogException(String message) {
            super(message);
        }

        public OpenRouterCatalogException(String message, Throwable cause) {
            super(message, cause);
        }

        public OpenRouterCatalogException(Throwable cause) {
            super(cause);
        }
    }
}
