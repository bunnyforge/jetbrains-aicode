package com.github.claudecodegui.provider.opencode;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

import com.github.claudecodegui.provider.common.BaseSDKBridge;
import com.github.claudecodegui.provider.common.MessageCallback;
import com.github.claudecodegui.provider.common.SDKResult;
import com.github.claudecodegui.settings.ClaudeSettingsManager;
import com.github.claudecodegui.settings.ConfigPathManager;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * OpenCode SDK bridge.
 *
 * Per-process bridge that spawns the opencode Node channel and parses
 * the tagged output lines into bridge callbacks. The opencode provider
 * does not maintain a long-running daemon, so this bridge only exposes
 * the per-request send path (mirroring Claude's fallback, not its
 * daemon mode).
 *
 * The base URL and API key are read from the active Claude settings
 * (`~/.claude/settings.json` env block) on every send, matching how
 * the Claude SDK resolves them at runtime. The webview's provider
 * preset sets `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` exactly
 * like the other third-party presets, so no separate plumbing is needed
 * on the webview side.
 */
public class OpencodeSDKBridge extends BaseSDKBridge {

    private final OpencodeStreamAdapter streamAdapter;
    private final OpencodeRequestParamsBuilder requestParamsBuilder;
    private volatile ClaudeSettingsManager settingsManager;

    public OpencodeSDKBridge() {
        super(OpencodeSDKBridge.class);
        this.streamAdapter = new OpencodeStreamAdapter(gson);
        this.requestParamsBuilder = new OpencodeRequestParamsBuilder(gson);
    }

    private ClaudeSettingsManager getSettingsManager() {
        ClaudeSettingsManager m = this.settingsManager;
        if (m == null) {
            synchronized (this) {
                if (this.settingsManager == null) {
                    this.settingsManager = new ClaudeSettingsManager(gson, new ConfigPathManager());
                }
                m = this.settingsManager;
            }
        }
        return m;
    }

    @Override
    protected String getProviderName() {
        return "opencode";
    }

    @Override
    protected void configureProviderEnv(Map<String, String> env, String stdinJson) {
        // The opencode channel reads baseUrl/apiKey from stdin, so no
        // provider-specific env vars are required here. We still mark
        // stdin mode so the channel skips arg-based parsing.
        env.put("OPENCODE_USE_STDIN", "true");
    }

    @Override
    protected void processOutputLine(
            String line,
            MessageCallback callback,
            SDKResult result,
            StringBuilder assistantContent,
            AtomicBoolean hadSendError,
            AtomicReference<String> lastNodeError
    ) {
        streamAdapter.processOutputLine(line, callback, result, assistantContent, hadSendError, lastNodeError);
    }

    // ============================================================================
    // Public send API
    // ============================================================================

    /**
     * Send a message to the opencode upstream.
     *
     * Resolves the active base URL and API key from `~/.claude/settings.json`
     * at call time so provider switches take effect without restarting the
     * bridge.
     *
     * @param channelId        Channel identifier
     * @param message          User prompt
     * @param sessionId        Caller-supplied session id
     * @param cwd              Informational; not used by the opencode channel
     * @param model            Model id (e.g., "big-pickle")
     * @param systemPrompt     Optional system prompt
     * @param temperature      Optional temperature
     * @param maxTokens        Optional max tokens
     * @param topP             Optional top-p
     * @param disableThinking  When true, the upstream thinking blocks are disabled
     * @param callback         Streaming callback
     */
    public CompletableFuture<SDKResult> sendMessage(
            String channelId,
            String message,
            String sessionId,
            String cwd,
            String model,
            String systemPrompt,
            Double temperature,
            Integer maxTokens,
            Double topP,
            Boolean disableThinking,
            MessageCallback callback
    ) {
        String baseUrl;
        String apiKey;
        try {
            JsonObject current = getSettingsManager().getCurrentClaudeConfig();
            baseUrl = current.has("baseUrl") ? current.get("baseUrl").getAsString() : "";
            // The masked key from getCurrentClaudeConfig is not usable; re-read
            // the raw env from settings.json so we pass the real bearer token.
            JsonObject raw = getSettingsManager().readClaudeSettings();
            JsonObject envObj = raw.has("env") && !raw.get("env").isJsonNull() ? raw.getAsJsonObject("env") : new JsonObject();
            apiKey = envObj.has("ANTHROPIC_AUTH_TOKEN")
                    ? envObj.get("ANTHROPIC_AUTH_TOKEN").getAsString()
                    : (envObj.has("ANTHROPIC_API_KEY") ? envObj.get("ANTHROPIC_API_KEY").getAsString() : "");
        } catch (IOException e) {
            LOG.warn("[OpencodeSDKBridge] Failed to read active provider env: " + e.getMessage());
            baseUrl = "";
            apiKey = "";
        }
        if (baseUrl == null || baseUrl.isEmpty()) {
            SDKResult error = new SDKResult();
            error.success = false;
            error.error = "OpenCode provider requires ANTHROPIC_BASE_URL to be configured in the active provider preset.";
            callback.onError(error.error);
            return CompletableFuture.completedFuture(error);
        }
        if (apiKey == null || apiKey.isEmpty()) {
            SDKResult error = new SDKResult();
            error.success = false;
            error.error = "OpenCode provider requires ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) to be set in the active provider preset.";
            callback.onError(error.error);
            return CompletableFuture.completedFuture(error);
        }

        JsonObject stdinInput = requestParamsBuilder.buildSendParams(
                message,
                sessionId,
                model,
                baseUrl,
                apiKey,
                systemPrompt,
                temperature,
                maxTokens,
                topP,
                disableThinking
        );
        String stdinJson = gson.toJson(stdinInput);
        List<String> command = buildBaseCommand("send");
        return executeStreamingCommand(channelId, command, stdinJson, cwd, callback);
    }
}
