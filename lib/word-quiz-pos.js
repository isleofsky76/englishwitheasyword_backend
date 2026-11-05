/**
 * 원본 한글 품사 → 퀴즈 표준 품사
 * noun | verb | adjective | adverb | other
 */

export const QUIZ_POS = Object.freeze(['noun', 'verb', 'adjective', 'adverb', 'other']);

const RULES = [
  { re: /동사/, pos: 'verb' },
  { re: /형용사/, pos: 'adjective' },
  { re: /부사/, pos: 'adverb' },
  { re: /명사/, pos: 'noun' },
  { re: /\bverb\b/i, pos: 'verb' },
  { re: /\badjective\b|\badj\b/i, pos: 'adjective' },
  { re: /\badverb\b|\badv\b/i, pos: 'adverb' },
  { re: /\bnoun\b/i, pos: 'noun' },
];

/**
 * @param {string} posSource
 * @returns {'noun'|'verb'|'adjective'|'adverb'|'other'}
 */
export function mapPosToQuiz(posSource) {
  const raw = String(posSource || '').trim();
  if (!raw) return 'other';
  for (const rule of RULES) {
    if (rule.re.test(raw)) return rule.pos;
  }
  return 'other';
}

export function isQuizPos(value) {
  return QUIZ_POS.includes(String(value || '').trim());
}
