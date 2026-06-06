package com.github.claudecodegui.handler.history;

import com.github.claudecodegui.handler.core.HandlerContext;

/**
 * Service for loading session messages and injecting them into the frontend.
 * Codex history is no longer supported — Claude sessions are loaded via the
 * HistoryHandler.SessionLoadCallback.
 */
public class HistoryMessageInjector {

    private final HandlerContext context;

    HistoryMessageInjector(HandlerContext context) {
        this.context = context;
    }

    /**
     * Load a history session. The provider argument is retained for API
     * compatibility but Claude is the only supported provider.
     */
    void handleLoadSession(String sessionId, String currentProvider, HistoryHandler.SessionLoadCallback sessionLoadCallback) {
        if (sessionLoadCallback == null) {
            return;
        }
        String projectPath = context.getProject().getBasePath();
        sessionLoadCallback.onLoadSession(sessionId, projectPath, "claude");
    }
}
