package com.github.claudecodegui.handler.provider;

import com.github.claudecodegui.handler.core.BaseMessageHandler;
import com.github.claudecodegui.handler.core.HandlerContext;

/**
 * Provider management message handler.
 * Handles provider CRUD operations and switching.
 */
public class ProviderHandler extends BaseMessageHandler {

    private static final String[] SUPPORTED_TYPES = {
            // Claude provider operations
            "get_providers",
            "get_current_claude_config",
            "get_thinking_enabled",
            "set_thinking_enabled",
            "add_provider",
            "update_provider",
            "delete_provider",
            "switch_provider",
            "get_active_provider",
            "preview_cc_switch_import",
            "open_file_chooser_for_cc_switch",
            "save_imported_providers",
            "sort_providers"
    };

    private final ClaudeProviderOperations claudeOps;
    private final ProviderImportExportSupport importExportSupport;
    private final ProviderOrderingService orderingService;

    public ProviderHandler(HandlerContext context) {
        super(context);
        this.claudeOps = new ClaudeProviderOperations(context);
        this.importExportSupport = new ProviderImportExportSupport(context, claudeOps);
        this.orderingService = new ProviderOrderingService(context, claudeOps);
    }

    @Override
    public String[] getSupportedTypes() {
        return SUPPORTED_TYPES;
    }

    @Override
    public boolean handle(String type, String content) {
        switch (type) {
            // Claude provider operations
            case "get_providers":
                claudeOps.handleGetProviders();
                return true;
            case "get_current_claude_config":
                claudeOps.handleGetCurrentClaudeConfig();
                return true;
            case "get_thinking_enabled":
                claudeOps.handleGetThinkingEnabled();
                return true;
            case "set_thinking_enabled":
                claudeOps.handleSetThinkingEnabled(content);
                return true;
            case "add_provider":
                claudeOps.handleAddProvider(content);
                return true;
            case "update_provider":
                claudeOps.handleUpdateProvider(content);
                return true;
            case "delete_provider":
                claudeOps.handleDeleteProvider(content);
                return true;
            case "switch_provider":
                claudeOps.handleSwitchProvider(content);
                return true;
            case "get_active_provider":
                claudeOps.handleGetActiveProvider();
                return true;
            case "preview_cc_switch_import":
                importExportSupport.handlePreviewCcSwitchImport();
                return true;
            case "open_file_chooser_for_cc_switch":
                importExportSupport.handleOpenFileChooserForCcSwitch();
                return true;
            case "save_imported_providers":
                importExportSupport.handleSaveImportedProviders(content);
                return true;
            case "sort_providers":
                orderingService.handleSortProviders(content);
                return true;
            default:
                return false;
        }
    }
}
