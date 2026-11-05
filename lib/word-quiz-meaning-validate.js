/**
 * onesentence.meaning → quiz_meaning 재사용 가능 여부
 * 규칙: 공백 포함 12자 이하, 한글 뜻, 문장형·영문 위주 거부
 */

const MAX_EXISTING_MEANING_LEN = 12;

export function countChars(text) {
  return Array.from(String(text || '')).length;
}

/**
 * @param {string} meaning
 * @returns {{ ok: boolean, reason?: string, normalized?: string }}
 */
export function validateExistingMeaning(meaning) {
  const normalized = String(meaning || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return { ok: false, reason: 'empty' };
  }
  const len = countChars(normalized);
  if (len > MAX_EXISTING_MEANING_LEN) {
    return { ok: false, reason: `too_long:${len}` };
  }
  if (!/[가-힣]/.test(normalized)) {
    return { ok: false, reason: 'no_hangul' };
  }
  /* 예문·설명형 */
  if (/[.!?。]/.test(normalized) || /이다\s*$/.test(normalized) || /합니다\s*$/.test(normalized)) {
    return { ok: false, reason: 'sentence_like' };
  }
  /* 영문이 한글보다 많으면 거절 */
  const latin = (normalized.match(/[A-Za-z]/g) || []).length;
  const hangul = (normalized.match(/[가-힣]/g) || []).length;
  if (latin > hangul) {
    return { ok: false, reason: 'latin_heavy' };
  }
  /* 쉼표로 나눈 뜻이 3개 초과 */
  const parts = normalized.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 2) {
    return { ok: false, reason: 'too_many_senses' };
  }
  return { ok: true, normalized };
}

export { MAX_EXISTING_MEANING_LEN };
