/**
 * Permission Mapping Utility
 *
 * Maps unified permission concepts to the Claude provider format.
 *
 * Philosophy: "Simple is better than complex" - Zen of Python
 *
 * @author Inspired by Steve Jobs' pursuit of simplicity
 */

/**
 * Unified Permission Modes
 *
 * These are the canonical permission levels understood by the IDEA plugin.
 */
export const UnifiedPermissionMode = {
  /** Default: Ask user before dangerous operations */
  DEFAULT: 'default',
  /** Read-only: No file modifications or command execution */
  SANDBOX: 'sandbox',
  /** Full access: Auto-approve all operations */
  YOLO: 'yolo'
};

/**
 * Normalize arbitrary permission mode strings to our canonical identifiers.
 * Accepts values coming from the webview (e.g. `bypassPermissions`) as well as
 * internal unified constants (e.g. `yolo`). Defaults to `default`.
 *
 * @param {string|undefined|null} mode
 * @returns {{core: string, alias?: string}}
 */
function normalizeUnifiedMode(mode) {
  if (!mode) {
    return { core: UnifiedPermissionMode.DEFAULT };
  }

  const raw = mode.toString().trim();
  const normalized = raw.toLowerCase();

  if (normalized === 'bypasspermissions') {
    return { core: UnifiedPermissionMode.YOLO, alias: 'bypassPermissions' };
  }

  // acceptEdits / autoEdit (Agent Mode): auto-apply file modifications, commands still require confirmation
  if (normalized === 'acceptedits' || normalized === 'autoedit') {
    return { core: UnifiedPermissionMode.DEFAULT, alias: 'acceptEdits' };
  }

  if (normalized === 'plan' || normalized === UnifiedPermissionMode.SANDBOX) {
    return { core: UnifiedPermissionMode.SANDBOX };
  }

  if (normalized === UnifiedPermissionMode.YOLO) {
    return { core: UnifiedPermissionMode.YOLO };
  }

  return { core: UnifiedPermissionMode.DEFAULT };
}

/**
 * Claude Permission Mapping
 *
 * Claude uses simple string-based permission modes that align
 * well with our unified model.
 */
export class ClaudePermissionMapper {
  /**
   * Convert unified permission mode to Claude format
   * @param {string} unifiedMode - One of UnifiedPermissionMode values
   * @returns {string} Claude permission mode
   */
  static toProvider(unifiedMode) {
    switch (unifiedMode) {
      case UnifiedPermissionMode.DEFAULT:
        return 'default';
      case UnifiedPermissionMode.SANDBOX:
        return 'sandbox';
      case UnifiedPermissionMode.YOLO:
        return 'yolo';
      default:
        return 'default';
    }
  }

  /**
   * Convert Claude permission mode to unified format
   * @param {string} claudeMode - Claude permission mode
   * @returns {string} Unified permission mode
   */
  static fromProvider(claudeMode) {
    // Claude modes already match our unified model
    return claudeMode || UnifiedPermissionMode.DEFAULT;
  }
}

/**
 * Permission Mapper Factory
 *
 * Selects the correct mapper based on provider type.
 * This is the main entry point for permission translation.
 */
export class PermissionMapperFactory {
  /**
   * Get permission mapper for a specific provider
   * @param {'claude'} provider
   * @returns {ClaudePermissionMapper}
   */
  static getMapper(provider) {
    switch (provider) {
      case 'claude':
        return ClaudePermissionMapper;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Quick conversion: unified → provider-specific
   * @param {'claude'} provider
   * @param {string} unifiedMode
   * @returns {string|object} Provider-specific permission config
   */
  static toProvider(provider, unifiedMode) {
    const mapper = this.getMapper(provider);
    return mapper.toProvider(unifiedMode);
  }

  /**
   * Quick conversion: provider-specific → unified
   * @param {'claude'} provider
   * @param {string|object} providerConfig
   * @returns {string} Unified permission mode
   */
  static fromProvider(provider, providerConfig) {
    const mapper = this.getMapper(provider);
    return mapper.fromProvider(providerConfig);
  }
}
