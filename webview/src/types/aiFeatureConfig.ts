export type AiFeatureProvider = 'claude';
export type AiFeatureResolutionSource = 'manual' | 'auto' | 'unavailable';

export const DEFAULT_AI_FEATURE_MODELS = {
  claude: 'claude-sonnet-4-6',
} as const;

export interface AiFeatureConfig {
  provider: AiFeatureProvider | null;
  effectiveProvider: AiFeatureProvider | null;
  resolutionSource: AiFeatureResolutionSource;
  models: {
    claude: string;
  };
  availability: {
    claude: boolean;
  };
}

export type CommitAiProvider = AiFeatureProvider;
export type CommitAiResolutionSource = AiFeatureResolutionSource;
export type CommitAiConfig = AiFeatureConfig;

export const DEFAULT_COMMIT_AI_CONFIG: CommitAiConfig = {
  provider: null,
  effectiveProvider: 'claude',
  resolutionSource: 'auto',
  models: {
    claude: DEFAULT_AI_FEATURE_MODELS.claude,
  },
  availability: {
    claude: false,
  },
};
