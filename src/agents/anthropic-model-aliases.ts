/**
 * Anthropic model-id short aliases.
 *
 * Extracted into a standalone leaf module so the map is fully initialised
 * before any config-parsing code references it at startup.  Keeping it in
 * `model-selection.ts` caused a TDZ `ReferenceError` in the single-file
 * bundle because the bundler placed the `const` declaration after the
 * config/defaults code that calls `parseModelRef` during config load.
 *
 * See #44724.
 */

export const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
  "opus-4.6": "claude-opus-4-6",
  "opus-4.5": "claude-opus-4-5",
  "sonnet-4.6": "claude-sonnet-4-6",
  "sonnet-4.5": "claude-sonnet-4-5",
};
