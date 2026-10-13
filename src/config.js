// -----------------------------------------------------------------------------
// Integration configuration (manifest `config_schema`).
//
// One setting: the language of the texts the container writes (feature
// names, error texts, scene event variables). A device integration does not
// receive the user's language; widgets do, and use it.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULT_CONFIG = {
  language: 'fr',
};

/**
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 * @returns {{ language: string }}
 */
export function normalizeConfig(raw = {}) {
  const language = LANGUAGES.includes(raw?.language) ? raw.language : DEFAULT_CONFIG.language;
  return { ...DEFAULT_CONFIG, language };
}

/** @param {string} [language] @returns {string} a supported language, English otherwise */
export function pickLanguage(language) {
  const short = String(language ?? '')
    .slice(0, 2)
    .toLowerCase();
  return LANGUAGES.includes(short) ? short : 'en';
}
