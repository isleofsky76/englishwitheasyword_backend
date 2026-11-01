/**
 * 문장 피드 댓글 금지어·링크 필터 (서버)
 * A/B = 자동 차단, C = 자동 차단 안 함(목록만 보관), allowlist = 오탐 방지
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let lists = {
  blockedA: [],
  blockedB: [],
  blockedC: [],
  blockedHangulJamo: [],
  allowlist: [],
};

try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'comment-badwords.json'), 'utf8'));
  // 구버전 blocked 호환
  lists.blockedA = Array.isArray(raw.blockedA) ? raw.blockedA : Array.isArray(raw.blocked) ? raw.blocked : [];
  lists.blockedB = Array.isArray(raw.blockedB) ? raw.blockedB : [];
  lists.blockedC = Array.isArray(raw.blockedC) ? raw.blockedC : [];
  lists.blockedHangulJamo = Array.isArray(raw.blockedHangulJamo) ? raw.blockedHangulJamo : [];
  lists.allowlist = Array.isArray(raw.allowlist) ? raw.allowlist : [];
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
  $: 's',
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
  const allows = [...(lists.allowlist || [])].sort((a, b) => String(b).length - String(a).length);
  allows.forEach((a) => {
    const needle = String(a || '').toLowerCase().trim();
    if (!needle) return;
    // 구문/단어 단위로 제거
    if (/\s/.test(needle) || /[^a-z]/i.test(needle)) {
      t = t.split(needle).join(' ');
    } else {
      const re = new RegExp(`(?:^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z]|$)`, 'gi');
      t = t.replace(re, ' ');
    }
  });
  return t;
}

function englishWordBoundaryHit(haystackLower, word) {
  const w = String(word || '').toLowerCase().trim();
  if (!w || /[^a-z]/.test(w)) return false;
  const re = new RegExp(`(?:^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z]|$)`, 'i');
  return re.test(haystackLower);
}

function phraseHit(haystackLower, phrase) {
  const p = String(phrase || '').toLowerCase().trim();
  if (!p) return false;
  if (/\s/.test(p)) return haystackLower.includes(p);
  if (/^[a-z]+$/i.test(p)) return englishWordBoundaryHit(haystackLower, p);
  // 한글·혼합: 원문 포함 또는 정규화 포함
  return haystackLower.includes(p) || normalizeForFilter(haystackLower).includes(normalizeForFilter(p));
}

function listHits(haystackLower, terms) {
  for (const term of terms || []) {
    if (phraseHit(haystackLower, term)) return true;
  }
  return false;
}

/** 댓글 자동 차단 대상: A + B (+ 자모). 예약 관리자 닉네임 단독은 예외 */
export function containsBadWords(text) {
  if (isReservedAdminNickname(text)) return false;
  const originalLower = stripAllowlist(text);
  const compact = normalizeForFilter(originalLower);

  if (listHits(originalLower, lists.blockedA)) return true;
  if (listHits(originalLower, lists.blockedB)) return true;

  // 숫자 치환 우회 (s3x 등) — 영문 단일 용어도 compact로 재검사
  const autoTerms = [...(lists.blockedA || []), ...(lists.blockedB || [])];
  for (const term of autoTerms) {
    const t = String(term || '').trim().toLowerCase();
    if (!t || /\s/.test(t)) continue;
    if (/^[a-z0-9]+$/i.test(t) && compact.includes(normalizeForFilter(t))) {
      // 짧은 영문이 compact에만 잡히는 경우, 원문 단어 경계도 한번 더 확인하되
      // 치환 우회(s3x)는 compact 매칭을 허용
      if (/[0-9@$]/.test(String(text || '').toLowerCase()) || englishWordBoundaryHit(originalLower, t) || compact.includes(normalizeForFilter(t))) {
        if (compact.includes(normalizeForFilter(t))) return true;
      }
    }
  }

  for (const term of lists.blockedHangulJamo || []) {
    const t = String(term || '').trim();
    if (!t) continue;
    if (compact.includes(normalizeForFilter(t)) || String(text || '').replace(/\s+/g, '').includes(t)) return true;
  }
  return false;
}

/** 관리자 전용 닉네임 — 금지어 예외, ADMIN_PASSWORD 확인 후에만 허용 */
export function isReservedAdminNickname(nickname) {
  const raw = String(nickname == null ? '' : nickname).trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return lower === 'admin' || raw === '관리자' || raw === '주인장';
}

export function validateCommentFields({ nickname, body, password }) {
  const nick = String(nickname == null ? '' : nickname).trim();
  const text = String(body == null ? '' : body).trim();
  const pw = String(password == null ? '' : password);

  if (!text) return { ok: false, error: '댓글 내용을 입력해 주세요.' };
  if (text.length > 100) return { ok: false, error: '댓글은 100자까지 입력할 수 있어요.' };
  if (nick.length > 10) return { ok: false, error: '닉네임은 10자까지 입력할 수 있어요.' };
  if (!pw || pw.length < 4 || pw.length > 14) {
    return { ok: false, error: '비밀번호는 4~14자로 입력해 주세요.' };
  }
  if (/\s/.test(pw)) {
    return { ok: false, error: '비밀번호에 공백은 넣을 수 없어요.' };
  }
  // 너무 단순한 비밀번호(숫자만 2자 반복 등) 완화 방지: 동일 문자만 금지
  if (/^(.)\1+$/.test(pw)) {
    return { ok: false, error: '비밀번호가 너무 단순해요.' };
  }
  if (hasLink(text) || hasLink(nick)) {
    return { ok: false, error: '링크는 포함할 수 없어요.' };
  }
  // admin / 관리자 / 주인장 닉네임은 금지어 검사 예외 (비밀번호는 라우트에서 검증)
  const reservedNick = isReservedAdminNickname(nick);
  if (containsBadWords(text)) {
    return { ok: false, error: '사용할 수 없는 표현이 포함되어 있어요.' };
  }
  if (!reservedNick && nick && containsBadWords(nick)) {
    return { ok: false, error: '사용할 수 없는 표현이 포함되어 있어요.' };
  }
  return { ok: true, nickname: nick, body: text, password: pw, reservedNick };
}
