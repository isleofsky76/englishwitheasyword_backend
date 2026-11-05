/**
 * 원본 섹션 → word_quiz_info 후보 행
 * 1차: onesentence. 이후 news-voca / wordofday 등 어댑터 추가.
 */

import { mapPosToQuiz } from './word-quiz-pos.js';
import { trimMeaningForQuiz } from './word-quiz-meaning-validate.js';

export const SOURCE_TYPES = Object.freeze({
  ONESENTENCE: 'onesentence',
  NEWS_VOCA: 'news-voca',
  WORD_OF_DAY: 'wordofday',
  ENGLISH_SYNONYM: 'english-synonym',
  SUNEUNG: 'suneung',
});

function contentUrlOneSentence(word) {
  const q = encodeURIComponent(String(word || '').trim());
  return q ? `one-sentence.html?q=${q}` : '';
}

/**
 * @param {object} entry onesentence 문서
 * @returns {object|null} sync 후보
 */
export function adaptOneSentenceEntry(entry) {
  if (!entry || !entry._id) return null;
  const word = String(entry.word || '').trim();
  if (!word) return null;

  const posSource = String(entry.pos || '').trim();
  const pos = mapPosToQuiz(posSource);
  const meaningCheck = trimMeaningForQuiz(entry.meaning);

  const base = {
    source_type: SOURCE_TYPES.ONESENTENCE,
    source_id: String(entry._id),
    word,
    pos,
    pos_source: posSource,
    content_url: contentUrlOneSentence(word),
    example: String(entry.en || '').trim() || null,
    example_ko: String(entry.ko || '').trim() || null,
    enabled: true,
  };

  if (meaningCheck.ok) {
    return {
      ...base,
      quiz_meaning: meaningCheck.normalized,
      meaning_source: 'existing',
      meaning_checked: false,
      needs_gpt: false,
      reuse_reason: 'ok',
    };
  }

  return {
    ...base,
    quiz_meaning: null,
    meaning_source: null,
    meaning_checked: false,
    needs_gpt: true,
    reuse_reason: meaningCheck.reason || 'invalid',
    raw_meaning: String(entry.meaning || '').trim(),
  };
}

/**
 * @param {object[]} entries
 * @returns {{ rows: object[], stats: object }}
 */
export function adaptOneSentenceEntries(entries) {
  const rows = [];
  const stats = {
    total: 0,
    adapted: 0,
    skipped: 0,
    reuse_existing: 0,
    needs_gpt: 0,
    reasons: {},
  };

  for (const entry of entries || []) {
    stats.total += 1;
    const row = adaptOneSentenceEntry(entry);
    if (!row) {
      stats.skipped += 1;
      continue;
    }
    stats.adapted += 1;
    if (row.needs_gpt) {
      stats.needs_gpt += 1;
      const r = row.reuse_reason || 'unknown';
      stats.reasons[r] = (stats.reasons[r] || 0) + 1;
    } else {
      stats.reuse_existing += 1;
    }
    rows.push(row);
  }

  return { rows, stats };
}

/** 향후 확장용 훅 */
export const SOURCE_ADAPTERS = {
  [SOURCE_TYPES.ONESENTENCE]: {
    label: '문장으로 익히는 단어',
    adaptMany: adaptOneSentenceEntries,
  },
};
