/**
 * 문장 피드 댓글 금지어·링크 필터 (서버)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let lists = { blocked: [], blockedHangulJamo: [], allowlist: [] };
try {
  const raw = fs.readFileSync(path.join(__dirname, 'comment-badwords.json'), 'utf8');
  lists = JSON.parse(raw);
} catch (e) {
  console.error('[comment-filter] badwords load failed:', e.message);
}

const DIGIT_MAP = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
};

export function hasLink(text) {
  return /https?:\/\/|www\./i.test(String(text || ''));
}

export function normalizeForFilter(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[0-9@$]/g, (ch) => DIGIT_MAP[ch] || ch)
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+/gi, '');
}

function stripAllowlist(text) {
  let t = String(text || '').toLowerCase();
  const allows = Array.isArray(lists.allowlist) ? lists.allowlist : [];
  allows.forEach((a) => {
    const needle = String(a || '').toLowerCase().trim();
    if (!needle) return;
    t = t.split(needle).join(' ');
  });
  return t;
}

function englishWordBoundaryHit(originalLower, word) {
  const w = String(word || '').toLowerCase().trim();
  if (!w || /[^a-z]/.test(w)) return false;
  const re = new RegExp(`(?:^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z]|$)`, 'i');
  return re.test(originalLower);
}

export function containsBadWords(text) {
  const original = String(text || '');
  const originalLower = stripAllowlist(original);
  const compact = normalizeForFilter(originalLower);
  const blocked = Array.isArray(lists.blocked) ? lists.blocked : [];
  const jamo = Array.isArray(lists.blockedHangulJamo) ? lists.blockedHangulJamo : [];

  for (const term of blocked) {
    const t = String(term || '').trim();
    if (!t) continue;
    const tLower = t.toLowerCase();
    if (/^[a-z]+$/i.test(t)) {
      if (englishWordBoundaryHit(originalLower, tLower)) return true;
      if (compact.includes(normalizeForFilter(tLower))) return true;
    } else {
      if (originalLower.includes(tLower) || compact.includes(normalizeForFilter(tLower))) return true;
    }
  }
  for (const term of jamo) {
    const t = String(term || '').trim();
    if (!t) continue;
    if (compact.includes(normalizeForFilter(t)) || original.replace(/\s+/g, '').includes(t)) return true;
  }
  return false;
}

export function validateCommentFields({ nickname, body, password }) {
  const nick = String(nickname == null ? '' : nickname).trim();
  const text = String(body == null ? '' : body).trim();
  const pw = String(password == null ? '' : password);

  if (!text) return { ok: false, error: '댓글 내용을 입력해 주세요.' };
  if (text.length > 100) return { ok: false, error: '댓글은 100자까지 입력할 수 있어요.' };
  if (nick.length > 10) return { ok: false, error: '닉네임은 10자까지 입력할 수 있어요.' };
  if (!/^\d{4}$/.test(pw)) return { ok: false, error: '비밀번호는 숫자 4자리여야 해요.' };
  if (hasLink(text) || hasLink(nick)) {
    return { ok: false, error: '링크는 포함할 수 없어요.' };
  }
  if (containsBadWords(text) || containsBadWords(nick)) {
    return { ok: false, error: '사용할 수 없는 표현이 포함되어 있어요.' };
  }
  return { ok: true, nickname: nick, body: text, password: pw };
}
