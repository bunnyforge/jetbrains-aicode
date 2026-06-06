package com.github.claudecodegui.provider.opencode;

import com.github.claudecodegui.provider.common.MessageCallback;
import com.github.claudecodegui.provider.common.SDKResult;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Adapts tagged Node.js output lines emitted by the opencode channel
 * into bridge callbacks and SDKResult updates. The tag set is a strict
 * subset of {@link com.github.claudecodegui.provider.claude.ClaudeStreamAdapter}
 * — the opencode channel only emits tags that map to streaming + usage.
 */
class OpencodeStreamAdapter {

    private final Gson gson;

    OpencodeStreamAdapter(Gson gson) {
        this.gson = gson;
    }

    void processOutputLine(
            String line,
            MessageCallback callback,
            SDKResult result,
            StringBuilder assistantContent,
            AtomicBoolean hadSendError,
            AtomicReference<String> lastNodeError
    ) {
        if (line.startsWith("[STDIN_ERROR]")) {
            lastNodeError.set(line);
        }

        if (line.startsWith("[SEND_ERROR]")) {
            String jsonStr = line.substring("[SEND_ERROR]".length()).trim();
            String errorMessage = jsonStr;
            try {
                JsonObject obj = gson.fromJson(jsonStr, JsonObject.class);
                if (obj.has("error")) {
                    errorMessage = obj.get("error").getAsString();
                }
            } catch (Exception ignored) {
            }
            hadSendError.set(true);
            result.success = false;
            result.error = errorMessage;
            callback.onError(errorMessage);
            return;
        }

        if (line.startsWith("[CONTENT_DELTA]")) {
            String delta = decodeJsonStringPayload(line.substring("[CONTENT_DELTA]".length()));
            assistantContent.append(delta);
            callback.onMessage("content_delta", delta);
            return;
        }

        if (line.startsWith("[REASONING_DELTA]")) {
            String delta = decodeJsonStringPayload(line.substring("[REASONING_DELTA]".length()));
            callback.onMessage("thinking_delta", delta);
            return;
        }

        if (line.startsWith("[USAGE]")) {
            callback.onMessage("usage", line.substring("[USAGE]".length()).trim());
            return;
        }

        if (line.startsWith("[STREAM_START]")) {
            callback.onMessage("stream_start", "");
            return;
        }

        if (line.startsWith("[MESSAGE_END]")) {
            callback.onMessage("message_end", "");
            return;
        }

        if (line.startsWith("[SESSION_ID]")) {
            callback.onMessage("session_id", line.substring("[SESSION_ID]".length()).trim());
            return;
        }
    }

    private String decodeJsonStringPayload(String rawPayload) {
        String jsonStr = rawPayload.startsWith(" ") ? rawPayload.substring(1) : rawPayload;
        try {
            return gson.fromJson(jsonStr, String.class);
        } catch (Exception ignored) {
            return jsonStr;
        }
    }
}
