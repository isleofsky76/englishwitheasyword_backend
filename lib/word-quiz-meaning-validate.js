/**
 * onesentence.meaning → quiz_meaning 재사용 가능 여부
 * 여러 뜻(쉼표·세미콜론) 허용. 문장형·영문 위주는 거부.
 */

const MAX_EXISTING_MEANING_LEN = 40;
const MAX_SENSES = 4;

export function countChars(text) {
  return Array.from(String(text || '')).length;
}

function splitSenses(text) {
  return String(text || '')
    .split(/[,，、;/·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
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
  const parts = splitSenses(normalized);
  if (parts.length > MAX_SENSES) {
    return { ok: false, reason: 'too_many_senses' };
  }
  return { ok: true, normalized };
}

/**
 * 검증 실패 시에도 앞쪽 뜻만 잘라 퀴즈용으로 쓸 수 있으면 반환
 */
export function trimMeaningForQuiz(meaning) {
  const raw = String(meaning || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return { ok: false, reason: 'empty' };

  const direct = validateExistingMeaning(raw);
  if (direct.ok) return direct;

  const parts = splitSenses(raw);
  if (!parts.length) return { ok: false, reason: direct.reason || 'empty' };

  let kept = [];
  for (const part of parts) {
    const trial = kept.concat(part).join(', ');
    if (countChars(trial) > MAX_EXISTING_MEANING_LEN) break;
    if (kept.length + 1 > MAX_SENSES) break;
    const v = validateExistingMeaning(trial);
    if (!v.ok && (v.reason === 'sentence_like' || v.reason === 'latin_heavy' || v.reason === 'no_hangul')) {
      break;
    }
    if (v.ok) kept = kept.concat(part);
    else break;
  }
  if (!kept.length) {
    /* 첫 뜻만 길이 제한으로 자르기 */
    const first = parts[0];
    if (!/[가-힣]/.test(first)) return { ok: false, reason: 'no_hangul' };
    const clipped = Array.from(first).slice(0, MAX_EXISTING_MEANING_LEN).join('');
    const v = validateExistingMeaning(clipped);
    return v.ok ? v : { ok: false, reason: direct.reason || 'unusable' };
  }
  return { ok: true, normalized: kept.join(', ') };
}

export { MAX_EXISTING_MEANING_LEN, MAX_SENSES, splitSenses };
