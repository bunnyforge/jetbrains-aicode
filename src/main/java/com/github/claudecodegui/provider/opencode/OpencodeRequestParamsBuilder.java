package com.github.claudecodegui.provider.opencode;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

/**
 * Builds the stdin JSON payload for the opencode Node channel.
 *
 * The opencode channel is stateless — it does not maintain a server-side
 * session, expose tool/MCP/permission flows, or replay history. The payload
 * is intentionally minimal: the user prompt, model id, baseUrl, apiKey,
 * and a small set of optional tuning fields.
 */
class OpencodeRequestParamsBuilder {

    private final Gson gson;

    OpencodeRequestParamsBuilder(Gson gson) {
        this.gson = gson;
    }

    JsonObject buildSendParams(
            String message,
            String sessionId,
            String model,
            String baseUrl,
            String apiKey,
            String systemPrompt,
            Double temperature,
            Integer maxTokens,
            Double topP,
            Boolean disableThinking
    ) {
        JsonObject params = new JsonObject();
        params.addProperty("message", message != null ? message : "");
        params.addProperty("sessionId", sessionId != null ? sessionId : "");
        params.addProperty("model", sanitizeModelId(model));
        params.addProperty("baseUrl", baseUrl != null ? baseUrl : "");
        params.addProperty("apiKey", apiKey != null ? apiKey : "");

        if (systemPrompt != null && !systemPrompt.isEmpty()) {
            params.addProperty("systemPrompt", systemPrompt);
        }
        if (temperature != null) {
            params.addProperty("temperature", temperature);
        }
        if (maxTokens != null && maxTokens > 0) {
            params.addProperty("maxTokens", maxTokens);
        }
        if (topP != null) {
            params.addProperty("topP", topP);
        }
        if (disableThinking != null && disableThinking) {
            JsonObject thinking = new JsonObject();
            thinking.addProperty("type", "disabled");
            params.add("thinking", thinking);
        }
        return params;
    }

    /**
     * Strip Claude-specific context suffix ([1m], [200k], ...) before
     * forwarding to the upstream. The opencode proxy rejects unknown
     * model ids containing square brackets.
     */
    private static final java.util.regex.Pattern CONTEXT_SUFFIX_PATTERN =
            java.util.regex.Pattern.compile("\\s*\\[\\d+(?:\\.\\d+)?[kKmM]\\]\\s*$");

    private static String sanitizeModelId(String model) {
        if (model == null || model.isEmpty()) {
            return model;
        }
        if (!CONTEXT_SUFFIX_PATTERN.matcher(model).find()) {
            return model;
        }
        return CONTEXT_SUFFIX_PATTERN.matcher(model).replaceAll("");
    }
}
