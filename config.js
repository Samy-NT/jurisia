/**
 * LexIA — Configuration
 * Renseignez votre clé API Anthropic ici pour éviter de la saisir à chaque session.
 * Cette valeur est écrasée par la clé stockée en localStorage si elle existe.
 */
window.LEXIA_CONFIG = {
  // Votre clé API Anthropic (ex: 'sk-ant-api03-...')
  // Laissez vide pour utiliser uniquement la saisie dans l'interface
  ANTHROPIC_API_KEY: '',

  // Modèle utilisé pour toutes les analyses
  MODEL: 'claude-sonnet-4-20250514',
};
