import OpenAI from 'openai';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { validateCommentFields, isReservedAdminNickname } from './comment-filter.js';
import { registerExpressionsApi } from './expressions-api.js';
import { registerRankingApi } from './ranking-api.js';
import { registerWordMeaningQuizApi } from './word-meaning-quiz-api.js';
import { registerExamApi } from './exam-api.js';
import { allowViewIncrement, getViewClientIp } from './view-guard.js';
import express from 'express';
import { app } from './runtime.js';

async function safeBcryptCompare(plain, hash) {
  if (plain == null || typeof plain !== 'string' || hash == null || typeof hash !== 'string') return false;
  return bcrypt.compare(plain, hash);
}

/**
 * UX-031 — API JSON 응답에서 password/passwordHash 제거.
 * DB·문서 인스턴스에는 그대로 두어 bcrypt 비교는 가능. res.json 직렬화 시에만 제거.
 */
function stripAuthSecretsFromJson(_doc, ret) {
  if (!ret || typeof ret !== 'object') return ret;
  delete ret.password;
  delete ret.passwordHash;
  delete ret.likedFingerprints;
  return ret;
}

mongoose.plugin((schema) => {
  const prev = schema.get('toJSON') || {};
  const prevTransform = typeof prev.transform === 'function' ? prev.transform : null;
  schema.set('toJSON', {
    ...prev,
    transform(doc, ret, options) {
      const next = prevTransform ? prevTransform(doc, ret, options) : ret;
      return stripAuthSecretsFromJson(doc, next);
    },
  });
});

/** 타이밍 안전 문자열 비교 (관리자 비밀번호) */
function safeEqualString(a, b) {
  const left = Buffer.from(String(a == null ? '' : a), 'utf8');
  const right = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/** 비밀번호 대입 방어 — 엄격 기준 */
const AUTH_ADMIN_MAX_FAILS = 5;
const AUTH_COMMENT_IP_MAX_FAILS = 8;
const AUTH_LOCK_MS = 30 * 60 * 1000; // 30분
const COMMENT_DOC_MAX_FAILS = 3;
const COMMENT_DOC_LOCK_MS = 30 * 60 * 1000; // 30분
const COMMENT_CREATE_COOLDOWN_MS = 60 * 1000; // 60초
/** 봇·대량 등록 상한 */
const COMMENT_IP_HOURLY_MAX = 10;
const COMMENT_IP_DAILY_MAX = 30;
const COMMENT_IP_WORD_HOURLY_MAX = 5;
const COMMENT_DUP_BODY_WINDOW_MS = 24 * 60 * 60 * 1000; // 동일 IP·동일 본문 24시간
const BCRYPT_ROUNDS = 12;
import RSS from 'rss'; // RSS 모듈 추가
import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs';
import { promisify } from 'util';
import session from 'express-session';

// .env 는 server.js 에서 먼저 로드. (node index.js 직접 실행 대비)
dotenv.config();

// app / trust proxy / /healthz / listen 은 server.js(+runtime.js)에서 처리

// CORS 설정 — 브라우저에서 프론트(다른 origin)가 이 API를 호출할 때 허용할 주소
const CORS_ALLOWED_ORIGINS = [
  'http://127.0.0.1:5500', 'http://localhost:5500',
  'http://127.0.0.1:5511', 'http://localhost:5511',
  'http://127.0.0.1:5502', 'http://localhost:5502',
  'http://127.0.0.1:5503', 'http://localhost:5503',
  'https://englisheasystudy.com',
  'https://www.englisheasystudy.com'
];
app.use(cors({
  origin: (origin, callback) => {
    // Origin 없음: curl/서버 간 호출. 브라우저 file://(Origin "null")은 차단
    if (!origin || CORS_ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    // 로컬 개발: Live Server 등 localhost/127.0.0.1 임의 포트 허용
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Write-Token'],
  credentials: false,
  optionsSuccessStatus: 200
}));

// Body parser 설정 (이미지 업로드를 위한 크기 제한 증가)
app.use(express.json({ limit: '10mb' })); // JSON 본문 크기 제한: 10MB
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // URL 인코딩 본문 크기 제한: 10MB

/** WRITE_API_TOKEN 설정 시에만 글 생성 POST에 토큰 요구. 미설정이면 기존과 동일. */
const writeApiToken = process.env.WRITE_API_TOKEN || '';
function requireWriteToken(req, res, next) {
  if (!writeApiToken) return next();
  const got =
    req.get('x-write-token') ||
    (req.body && (req.body.writeToken || req.body.adminPasswordInput)) ||
    '';
  if (String(got) !== String(writeApiToken)) {
    return res.status(403).json({ error: 'Write token required' });
  }
  return next();
}

// Session middleware for conversation history
app.use(session({
  secret: process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'dev-only-session-secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production' || process.env.SESSION_COOKIE_SECURE === '1',
    sameSite: 'lax',
    httpOnly: true,
  },
}));

// 정적 파일 제공 경로 설정
app.use(express.static('public'));

// Google Cloud Text-to-Speech 클라이언트 초기화
let client = null;
let clientBeta = null;

function loadGoogleTtsCredentials() {
  const jsonPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './youtubespeech-430112-5a2ce6dffa5c.json';
  try {
    if (fs.existsSync(jsonPath)) {
      return { credentials: JSON.parse(fs.readFileSync(jsonPath, 'utf8')), source: jsonPath };
    }
  } catch (error) {
    console.error('Error loading TTS JSON credentials:', error.message);
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL || '';
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || '';
  if (clientEmail && privateKey) {
    // .env 에서 \\n 로 넣은 PEM 줄바꿈 복원 + 줄 끝 ^ 복사 잔여물 제거
    privateKey = privateKey
      .replace(/\\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\^+$/, '').trimEnd())
      .join('\n');
    if (!privateKey.endsWith('\n')) privateKey += '\n';
    if (!/END PRIVATE KEY-----/.test(privateKey) || privateKey.length < 200) {
      console.error(
        '⚠️ GOOGLE_PRIVATE_KEY looks incomplete (put the full PEM on one line with \\n, or restore the JSON key file).'
      );
    } else {
      return {
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
        source: 'env(GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY)',
      };
    }
  }
  return null;
}

try {
  const loaded = loadGoogleTtsCredentials();
  if (!loaded) {
    throw new Error('No JSON file and no GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY in .env');
  }
  client = new textToSpeech.TextToSpeechClient({ credentials: loaded.credentials });
  try {
    clientBeta = new textToSpeech.v1beta1.TextToSpeechClient({ credentials: loaded.credentials });
  } catch (_) {
    clientBeta = null;
  }
  console.log(`✅ Google Cloud TTS client initialized successfully (${loaded.source})`);
} catch (error) {
  console.log('⚠️ Google Cloud credentials not found, using fallback TTS');
  console.error('Error loading credentials:', error.message);
}

function escapeSsmlText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 단어마다 `<mark>` — 구간별(마침표 분리) 합성 시 timepoint 누락 완화 */
function buildWordMarkedSsml(text) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '<speak></speak>';
  const body = tokens.map((tok, i) => {
    // live/lyve → IPA /laɪv/ (라이브). 철자 V(/viː/→라이비) 방지
    const core = String(tok).replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '');
    const spoken =
      /^(lyve|laive|live|lyev)$/i.test(core)
        ? `<phoneme alphabet="ipa" ph="laɪv">${escapeSsmlText(tok)}</phoneme>`
        : escapeSsmlText(tok);
    return `<mark name="w${i}"/>${spoken}`;
  }).join(' ');
  return `<speak>${body}</speak>`;
}

function findSegmentInPlainText(plain, seg, fromIndex) {
  const s = String(seg || '').trim();
  if (!s) return null;
  const start = Math.max(0, Number(fromIndex) || 0);
  const candidates = [s];
  /** 구절 끝 「에서의」 등이 본문의 「에서 의」와 어긋날 때 */
  const soft = s.replace(/([가-힣]{2,})의(?!\s)/g, '$1 의');
  if (soft !== s) candidates.push(soft);
  for (const cand of candidates) {
    const exactIdx = plain.indexOf(cand, start);
    if (exactIdx >= 0) return { idx: exactIdx, length: cand.length };
    const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flex = new RegExp(escaped.replace(/\s+/g, '\\s+'));
    const m = flex.exec(plain.slice(start));
    if (m && typeof m.index === 'number') {
      return { idx: start + m.index, length: m[0].length };
    }
  }
  return null;
}

/** 한국어 TTS — 소유 조사 「의」 누락 방지(띄어쓰기로 발음 유도). 합성어 회의·의미 등은 제외 */
function koreanPossessiveUiForTTS(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/([가-힣]{2,})의(?=\s+[가-힣])/g, '$1 의');
}

/** 한국어 TTS — 「정점」 표기는 유지, 발음만 「정쩜」 */
function jeongjeomForKoreanTTS(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/정점/g, '정쩜');
}

/** exampleKoChunked 구절마다 `<mark name="cN"/>` — 한글 문맥 단위 하이라이트용 */
function buildChunkMarkedSsmlFromFullText(fullText, chunkStrings) {
  const plain = String(fullText || '').trim();
  if (!plain) return '<speak></speak>';
  let cursor = 0;
  const out = [];
  let markIdx = 0;
  for (const raw of chunkStrings) {
    const seg = String(raw || '').trim();
    if (!seg) continue;
    const match = findSegmentInPlainText(plain, seg, cursor);
    if (!match) continue;
    if (match.idx > cursor) out.push(escapeSsmlText(plain.slice(cursor, match.idx)));
    out.push(`<mark name="c${markIdx}"/>${escapeSsmlText(plain.slice(match.idx, match.idx + match.length))}`);
    markIdx += 1;
    cursor = match.idx + match.length;
  }
  if (cursor < plain.length) out.push(escapeSsmlText(plain.slice(cursor)));
  return `<speak>${out.join('')}</speak>`;
}

function resolveLanguageCodeFromVoice(voiceName, fallback = 'en-US') {
  const v = String(voiceName || '');
  if (v.includes('en-GB')) return 'en-GB';
  if (v.includes('en-AU')) return 'en-AU';
  if (v.includes('ko-KR')) return 'ko-KR';
  if (v.includes('en-US')) return 'en-US';
  return fallback;
}

/** Chirp / Chirp3 HD — `<mark>` + enableTimePointing(SSML_MARK) 미지원 */
function voiceSupportsSsmlMarks(voiceName) {
  return !/Chirp/i.test(String(voiceName || ''));
}

/** marks 합성용 Neural2 등 SSML mark 지원 음성 */
function marksCompatibleVoice(voiceName, languageCode) {
  const v = String(voiceName || '');
  const lc = String(languageCode || '');
  if (lc.startsWith('ko') || v.includes('ko-KR')) return 'ko-KR-Neural2-C';
  if (lc.startsWith('en-GB') || v.includes('en-GB')) return 'en-GB-Neural2-B';
  if (lc.startsWith('en-AU') || v.includes('en-AU')) return 'en-AU-Neural2-B';
  return 'en-US-Neural2-D';
}

function isTtsInvalidArgumentError(error) {
  const code = error?.code;
  const msg = String(error?.message || '');
  return code === 3 || /INVALID_ARGUMENT/i.test(msg);
}

const TTS_SSML_MAX_BYTES = 5000;
/** Google TTS volumeGainDb 허용 범위. 요청 없으면 0 (페이지별로 쿼리로만 올림) */
const TTS_VOLUME_GAIN_DB_MIN = -96;
const TTS_VOLUME_GAIN_DB_MAX = 16;

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 음성 생성 엔드포인트
app.get('/generate-audio', async (req, res) => {
  const { text, language, speakrate } = req.query;
  let voice = req.query.voice;
  if (Array.isArray(voice)) voice = voice[0];
  // 기본 음성 설정
  // ... existing code ...
  const defaultVoiceMap = {
    'en-US': ['en-US-Chirp-HD-D'], // 미국 영어 Chirp-HD-D 음성 (기본)
    'en-US-Wavenet-J': ['en-US-Chirp-HD-D'], // 미국 영어 Chirp-HD-D 음성 (Wavenet-J 대체)
    'en-US-Wavenet-D': ['en-US-Chirp-HD-D'], // 미국 영어 Chirp-HD-D 음성 (Wavenet-D 대체)
    'en-US-Wavenet-C': ['en-US-Wavenet-C'], // 미국 영어 Wavenet-C (여성)
    'en-US-Chirp3-HD-Zubenelgenubi': ['en-US-Chirp-HD-D'], // 미국 영어 Chirp-HD-D 음성 (Chirp3-HD-Zubenelgenubi 대체)
    'en-US-Chirp3-HD-Sulafat': ['en-US-Chirp3-HD-Sulafat'],
    'en-US-Chirp3-HD-Gacrux': ['en-US-Chirp3-HD-Gacrux'],
    'en-US-Chirp3-HD-Algenib': ['en-US-Chirp3-HD-Algenib'],
    'en-US-Chirp3-HD-Enceladus': ['en-US-Chirp3-HD-Enceladus'],
    'en-US-Chirp-HD-D': ['en-US-Chirp-HD-D'], // 미국 영어 Chirp-HD-D 음성 (직접 매핑)
    'en-US-Chirp-HD-F': ['en-US-Chirp-HD-F'], // 미국 영어 Chirp-HD-F 음성
    'en-US-News-N': ['en-US-News-N'], // 미국 News-N
    'en-GB-Chirp-HD-D': ['en-GB-Neural2-B'], // 영국 영어 Neural2-B 음성 직접 매핑
    'en-US-Studio-O': ['en-US-Chirp-HD-D'], // 미국 영어 Chirp-HD-D 음성 (Studio-O 대체)
    'en-GB': ['en-GB-Neural2-B'], // 영국 영어 Neural2-B 음성
    'en-GB-Neural2-A': ['en-GB-Neural2-A'], // 영국 영어 Neural2-A 음성 직접 매핑
    'en-GB-Neural2-B': ['en-GB-Neural2-B'], // 영국 영어 Neural2-B 음성 직접 매핑
    'en-GB-News-H': ['en-GB-News-H'], // 영국 News-H
    'en-GB-News-M': ['en-GB-News-M'], // 영국 News-M
    'en-GB-Chirp3-HD-Zubenelgenubi': ['en-GB-Chirp3-HD-Zubenelgenubi'], // 영국 Chirp3 HD Zubenelgenubi
    'en-GB-Wavenet-N': ['en-GB-Wavenet-N'], // 영국 영어 Wavenet-N (여성) — 구버전 프론트 호환
    'en-GB-News-I': ['en-GB-News-I'], // 영국 영어 News-I
    'en-AU-News-G': ['en-AU-News-G'], // 호주 News-G
    'ko-KR': ['ko-KR-Neural2-C'], // 한국어 Neural2-C 음성 (기본)
    'ko-KR-Chirp3-HD-Achird': ['ko-KR-Chirp3-HD-Achird'],
    'ko-KR-Chirp3-HD-Achernar': ['ko-KR-Chirp3-HD-Achernar'],
    'ko-KR-Chirp3-HD-Zephyr': ['ko-KR-Chirp3-HD-Zephyr'],
    'ko-KR-Chirp3-HD-Vindemiatrix': ['ko-KR-Chirp3-HD-Vindemiatrix'],
    'ko-KR-Chirp3-HD-Zubenelgenubi': ['ko-KR-Chirp3-HD-Zubenelgenubi'],
    'ko-KR-Chirp3-HD-Charon': ['ko-KR-Chirp3-HD-Charon']
  };

  // 음성 선택 (voice가 없으면 기본 음성 사용)
  let voiceName;
  if (voice) {
    voiceName = voice;
  } else if (language && defaultVoiceMap[language]) {
    voiceName = defaultVoiceMap[language][0];
  } else if (typeof language === 'string' && /^(en|ko)-[A-Z]{2}-(Neural2|Wavenet|Chirp|News)/.test(language)) {
    // Allow direct voice-name input from frontend (e.g., en-GB-Neural2-A)
    voiceName = language;
  } else {
    voiceName = 'en-US-Chirp-HD-D';
  }

  // 언어 코드 설정 (음성에 따라 언어 코드 결정)
  let actualLanguageCode;
  if (voiceName.includes('en-GB')) {
    actualLanguageCode = 'en-GB';
  } else if (voiceName.includes('en-AU')) {
    actualLanguageCode = 'en-AU';
  } else if (voiceName.includes('ko-KR')) {
    actualLanguageCode = 'ko-KR';
  } else if (voiceName.includes('en-US')) {
    actualLanguageCode = 'en-US';
  } else {
    actualLanguageCode = language || 'en-GB';
  }

  console.log(`🟢 Requested Text: ${text}`);
  console.log(`🟢 Requested Language: ${language}`);
  console.log(`🟢 Requested Voice: ${voice}`);
  console.log(`🟢 Requested Speakrate: ${speakrate}`);
  console.log(`🟢 Selected Voice: ${voiceName}`);

  if (!String(text || '').trim()) {
    console.error('🔴 Empty text specified.');
    return res.status(400).json({ error: 'Empty text specified.' });
  }

  // 올바른 음성 설정이 없으면 에러 반환
  if (!voiceName) {
    console.error('🔴 Invalid language or voice specified.');
    return res.status(400).json({ error: 'Invalid language or voice specified.' });
  }

  // 언어별 속도 설정
  let speakingRate = 1.0; // 기본 속도
  
  // 쿼리 파라미터로 speakrate가 지정된 경우 우선 적용
  if (speakrate) {
    speakingRate = parseFloat(speakrate);
  } else {
    // 한국어인 경우 기본 속도 조정
    if (language === 'ko-KR' || language === 'ko' || (typeof language === 'string' && /^ko-KR/i.test(language))) {
      speakingRate = 1.0; // 한국어 속도 (Neural2-C / Chirp3 HD 등 공통)
    } else if (typeof language === 'string' && /^en-/i.test(language)) {
      speakingRate = 1.0; // 영어(en-US / en-GB / Wavenet-N 등) 공통
    }
  }

  console.log(`🟢 Final Speaking Rate: ${speakingRate}`);

  const rawGainDb = parseFloat(req.query.volumeGainDb ?? req.query.gainDb);
  const volumeGainDb = Number.isFinite(rawGainDb)
    ? Math.min(TTS_VOLUME_GAIN_DB_MAX, Math.max(TTS_VOLUME_GAIN_DB_MIN, rawGainDb))
    : 0;

  // AI 발음: artificial intelligence (한국어는 인공지능). OpenAI 등 단어 안 AI는 \b 경계로 제외
  let textForInput = String(text || '');
  const hasAI = /\bA\.I\.?\b/i.test(textForInput) || /\bAI\b/i.test(textForInput);

  if (hasAI) {
    if (actualLanguageCode === 'ko-KR' || (language && /^ko/i.test(language))) {
      textForInput = textForInput
        .replace(/\bA\.I\.?\b/gi, '인공지능')
        .replace(/\bAI['']s\b/gi, '인공지능의')
        .replace(/\bAI\b/gi, '인공지능');
    } else {
      textForInput = textForInput
        .replace(/\bA\.I\.?\b/gi, 'artificial intelligence')
        .replace(/\bAI['']s\b/gi, "artificial intelligence's")
        .replace(/\bAI\b/gi, 'artificial intelligence');
    }
  }

  // VAR(비디오 판독) — 영어 TTS만 bee ay ahl(=비 에이 알). 영어 음성은 한글 미지원
  const isKoLang = actualLanguageCode === 'ko-KR' || (language && /^ko/i.test(language));
  if (!isKoLang && /\bVAR\b/i.test(textForInput)) {
    textForInput = textForInput
      .replace(/\bVAR['']s\b/gi, "bee ay ahl's")
      .replace(/\bVAR\b/gi, 'bee ay ahl');
  }

  // live /laɪv/ (라이브) — 동사 /lɪv/·철자 V(라이비) 방지. marks SSML에서 IPA 재확인
  if (!isKoLang) {
    const toLyve = (m) => (m[0] === 'L' ? 'Lyve' : 'lyve');
    textForInput = textForInput
      .replace(/\blye-v\b/gi, toLyve)
      .replace(/\blaive\b/gi, toLyve)
      .replace(/\blive\b(?=\s+images?\b)/gi, toLyve)
      .replace(
        /\blive\b(?=\s+(?:stream|broadcast|show|feed|tv|TV|music|video|event|coverage|update|session|demo|concert|performance|audio|footage|camera|cameras)\b)/gi,
        toLyve
      );
  }

  if (actualLanguageCode === 'ko-KR' || (language && /^ko/i.test(language))) {
    textForInput = jeongjeomForKoreanTTS(textForInput);
    textForInput = koreanPossessiveUiForTTS(textForInput);
  }

  // B.C./A.D. moment → BC AD-moment (연대 확장·AD↔moment 사이 끊김 방지)
  textForInput = textForInput
    .replace(/\bB\.C\.\s*\/\s*A\.D\.\s+moment\b/gi, 'BC AD-moment')
    .replace(/\bB\.C\.\s*\/\s*A\.D\./gi, 'BC AD')
    .replace(/\bB\.C\./gi, 'BC')
    .replace(/\bA\.D\.\s+moment\b/gi, 'AD-moment')
    .replace(/\bA\.D\./gi, 'AD')
    .replace(/\bBC\s+AD\s+moment\b/gi, 'BC AD-moment');

  // the U.S.'s / U.S.'s → United States's 로 읽히게 (US즈 발음)
  textForInput = textForInput.replace(/\bthe U\.S\.'s\b/gi, 'the United States\'s');
  textForInput = textForInput.replace(/\bU\.S\.'s\b/g, 'United States\'s');

  const request = {
    input: { text: textForInput },
    voice: { languageCode: actualLanguageCode, name: voiceName },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: speakingRate,
      pitch: 0.0,
      volumeGainDb
    }
  };

  const wantsWordMarks = req.query.marks === '1' || req.query.marks === 'true';
  const wantsChunkMarks = req.query.marks === 'chunk';

  try {
    if (!client) {
      console.log('⚠️ Google Cloud TTS not available, returning error');
      return res.status(503).json({ error: 'Text-to-Speech service not available. Please configure Google Cloud credentials.' });
    }

    let markCount = 0;
    let markMode = 'word';

    if ((wantsWordMarks || wantsChunkMarks) && clientBeta) {
      let ssml;
      if (wantsChunkMarks) {
        let chunkStrings = [];
        try {
          chunkStrings = JSON.parse(req.query.chunks || '[]');
        } catch (_) {
          chunkStrings = [];
        }
        ssml = buildChunkMarkedSsmlFromFullText(textForInput, chunkStrings);
        markCount = chunkStrings.filter((c) => String(c || '').trim()).length;
        markMode = 'chunk';
      } else {
        ssml = buildWordMarkedSsml(textForInput);
        markCount = String(textForInput || '').trim().split(/\s+/).filter(Boolean).length;
      }

      const ssmlBytes = Buffer.byteLength(ssml, 'utf8');
      if (ssmlBytes <= TTS_SSML_MAX_BYTES) {
        const marksVoiceName = voiceSupportsSsmlMarks(voiceName)
          ? voiceName
          : marksCompatibleVoice(voiceName, actualLanguageCode);
        const marksLanguageCode = resolveLanguageCodeFromVoice(marksVoiceName, actualLanguageCode);

        if (marksVoiceName !== voiceName) {
          console.warn(`⚠️ ${voiceName} does not support SSML marks — using ${marksVoiceName} for timepoints`);
        }

        const markRequest = {
          input: { ssml },
          voice: { languageCode: marksLanguageCode, name: marksVoiceName },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate,
            pitch: 0.0,
            volumeGainDb
          },
          enableTimePointing: ['SSML_MARK'],
        };

        try {
          const [markResponse] = await clientBeta.synthesizeSpeech(markRequest);
          const rawTps = markResponse.timepoints || [];
          const timepoints = rawTps.map((tp) => ({
            markName: tp.markName ?? tp.mark_name ?? '',
            timeSeconds: Number(tp.timeSeconds ?? tp.time_seconds ?? 0),
          })).sort((a, b) => a.timeSeconds - b.timeSeconds);

          const audioBuf = markResponse.audioContent;
          console.log('🟢 Audio response received successfully! (marks)');
          res.set('Content-Type', 'application/json; charset=utf-8');
          return res.json({
            audio: Buffer.from(audioBuf).toString('base64'),
            timepoints,
            wordCount: markCount,
            markMode,
          });
        } catch (markErr) {
          if (!isTtsInvalidArgumentError(markErr)) throw markErr;
          console.warn(`⚠️ SSML marks synthesis failed (${markErr.message}) — falling back to plain audio`);
        }
      } else {
        console.warn(`⚠️ SSML too long (${ssmlBytes} bytes) — falling back to plain audio`);
      }
    }
    if (wantsWordMarks || wantsChunkMarks) {
      console.warn('⚠️ marks unavailable — returning plain audio only');
    }

    const [response] = await client.synthesizeSpeech(request);

    console.log('🟢 Audio response received successfully!');

    if (wantsWordMarks || wantsChunkMarks) {
      res.set('Content-Type', 'application/json; charset=utf-8');
      return res.json({
        audio: Buffer.from(response.audioContent).toString('base64'),
        timepoints: [],
        wordCount: markCount,
        markMode,
      });
    }

    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.send(response.audioContent);
  } catch (error) {
    console.error('🔴 Error generating audio:', error.message);
    if (error?.details) console.error('🔴 Details:', error.details);
    res.status(500).json({ error: `Error generating audio: ${error.message}` });
  }
});

// 환경 변수에서 MongoDB URI 읽기
const uri = process.env.MONGO_URI;

// mydatabase 아래 컬렉션 3개: newsvoca, synonyms, popularvoca

// News Voca (page30_guestbook.html) → 컬렉션 newsvoca
const guestbookEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' },
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false }
}, { collection: 'newsvoca' });

const GuestbookEntry = mongoose.model('GuestbookEntry', guestbookEntrySchema);

// Synonyms (guestbook_v.html) → 컬렉션 synonyms
const vocabularyEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'synonyms' });

const VocabularyEntry = mongoose.model('VocabularyEntry', vocabularyEntrySchema);

// Popular Voca (guestbook_v_easy.html) → 컬렉션 popularvoca
const easyVocaEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'popularvoca' });

const EasyVocaEntry = mongoose.model('EasyVocaEntry', easyVocaEntrySchema);

// Situational English (situational-english-list.html) → 컬렉션 situationalenglish
const situationalEnglishEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'situationalenglish' });

const SituationalEnglishEntry = mongoose.model('SituationalEnglishEntry', situationalEnglishEntrySchema);

// Pros & Cons (pros-cons-list.html) → 컬렉션 proscons
const prosConsEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'proscons' });

const ProsConsEntry = mongoose.model('ProsConsEntry', prosConsEntrySchema);

// Word of the Day (page30_guestbook_wordofday.html) → 컬렉션 wordofday
const wordOfDayEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'wordofday' });

const WordOfDayEntry = mongoose.model('WordOfDayEntry', wordOfDayEntrySchema);

// 문장으로 익히는 단어 (one-sentence.html) → 컬렉션 onesentence
const oneSentenceCfSchema = new mongoose.Schema({
  word: { type: String, default: '' },
  pos: { type: String, default: '' },
  meaning: { type: String, default: '' },
}, { _id: false });

const oneSentenceEntrySchema = new mongoose.Schema({
  word: { type: String, required: true },
  pos: { type: String, default: '' },
  meaning: { type: String, default: '' },
  ko: { type: String, default: '' },
  en: { type: String, required: true },
  highlight: { type: String, default: '' },
  ipa: { type: String, default: '' },
  ipaKo: { type: String, default: '' },
  /* 예: [{ word:'weather', pos:'동사', meaning:'견뎌내다' }] → cf. weather 동사 - 견뎌내다 */
  cf: { type: [oneSentenceCfSchema], default: [] },
  memo: { type: String, default: '' },
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
}, { collection: 'onesentence' });

const OneSentenceEntry = mongoose.model('OneSentenceEntry', oneSentenceEntrySchema);

const englishWritingSchema = new mongoose.Schema({
  key: { type: String, default: 'latest', unique: true },
  title: { type: String, default: '' },
  text: { type: String, default: '' },
  source: { type: String, default: '' },
  url: { type: String, default: '' },
  videoId: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
});
const EnglishWriting = mongoose.model('EnglishWriting', englishWritingSchema);

// 문장 피드 단어별 익명 댓글 → 컬렉션 onesentencecomments
const oneSentenceCommentSchema = new mongoose.Schema({
  wordKey: { type: String, required: true, index: true },
  word: { type: String, default: '' },
  pos: { type: String, default: '' },
  nickname: { type: String, default: '' },
  body: { type: String, required: true },
  passwordHash: { type: String, required: true },
  date: { type: Date, default: Date.now },
  deleteFailCount: { type: Number, default: 0 },
  deleteLockedUntil: { type: Date, default: null },
}, { collection: 'onesentencecomments' });
oneSentenceCommentSchema.index({ wordKey: 1, date: 1 });
const OneSentenceComment = mongoose.model('OneSentenceComment', oneSentenceCommentSchema);

/** 게시판 글(slug)별 익명 댓글 — 뉴스 영어 등 → 컬렉션 boardcomments */
const boardCommentSchema = new mongoose.Schema({
  board: { type: String, required: true, index: true },
  contentKey: { type: String, required: true, index: true },
  title: { type: String, default: '' },
  nickname: { type: String, default: '' },
  body: { type: String, required: true },
  passwordHash: { type: String, required: true },
  date: { type: Date, default: Date.now },
  deleteFailCount: { type: Number, default: 0 },
  deleteLockedUntil: { type: Date, default: null },
}, { collection: 'boardcomments' });
boardCommentSchema.index({ board: 1, contentKey: 1, date: 1 });
const BoardComment = mongoose.model('BoardComment', boardCommentSchema);

const oneSentenceCommentIpCooldown = new Map(); // ip -> lastPostMs
/** IP별 등록 시각 로그 (봇·대량 등록 상한) */
const oneSentenceCommentIpCreates = new Map(); // ip -> number[] timestamps
const oneSentenceCommentIpWordCreates = new Map(); // `${ip}::${wordKey}` -> number[]
const oneSentenceCommentIpBodies = new Map(); // `${ip}::${bodyNorm}` -> lastMs
/** IP별 비밀번호 대입 방어 (관리자·댓글) */
const authFailByIp = new Map(); // ip -> { count, lockedUntil }

function getRequestIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.ip || req.socket?.remoteAddress || 'unknown';
}

function pruneTimestamps(list, sinceMs) {
  const arr = Array.isArray(list) ? list : [];
  return arr.filter((t) => t >= sinceMs);
}

function normalizeCommentBodyKey(body) {
  return String(body || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 댓글 등록 남용 제한.
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
function checkCommentCreateLimits(ip, wordKey, body) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const bodyKey = `${ip}::${normalizeCommentBodyKey(body)}`;
  const wordMapKey = `${ip}::${String(wordKey || '').trim()}`;

  const lastSameBody = oneSentenceCommentIpBodies.get(bodyKey) || 0;
  if (lastSameBody && now - lastSameBody < COMMENT_DUP_BODY_WINDOW_MS) {
    return { ok: false, status: 429, error: '같은 내용의 댓글은 잠시 후 다시 등록할 수 있어요.' };
  }

  const ipTimes = pruneTimestamps(oneSentenceCommentIpCreates.get(ip), dayAgo);
  const hourCount = ipTimes.filter((t) => t >= hourAgo).length;
  if (hourCount >= COMMENT_IP_HOURLY_MAX) {
    return { ok: false, status: 429, error: '잠시 후 다시 작성해 주세요. (시간당 등록 한도)' };
  }
  if (ipTimes.length >= COMMENT_IP_DAILY_MAX) {
    return { ok: false, status: 429, error: '오늘 댓글 등록 한도에 도달했어요.' };
  }

  const wordTimes = pruneTimestamps(oneSentenceCommentIpWordCreates.get(wordMapKey), hourAgo);
  if (wordTimes.length >= COMMENT_IP_WORD_HOURLY_MAX) {
    return { ok: false, status: 429, error: '이 단어에는 잠시 후 다시 댓글을 남길 수 있어요.' };
  }

  return { ok: true, ipTimes, wordTimes, bodyKey, wordMapKey, now };
}

function recordCommentCreateSuccess(ip, limitState) {
  if (!limitState || !limitState.ok) return;
  const { ipTimes, wordTimes, bodyKey, wordMapKey, now } = limitState;
  ipTimes.push(now);
  oneSentenceCommentIpCreates.set(ip, ipTimes);
  const nextWord = (wordTimes || []).concat(now);
  oneSentenceCommentIpWordCreates.set(wordMapKey, nextWord);
  oneSentenceCommentIpBodies.set(bodyKey, now);
  oneSentenceCommentIpCooldown.set(ip, now);
}

function isIpAuthLocked(ip) {
  const row = authFailByIp.get(ip);
  return !!(row && row.lockedUntil && row.lockedUntil > Date.now());
}

function rejectIfIpAuthLocked(ip, res) {
  if (!isIpAuthLocked(ip)) return false;
  res.status(429).json({ error: '잠시 잠겼어요. 30분 뒤 다시 시도해 주세요.' });
  return true;
}

function recordIpAuthFail(ip, { maxFails = AUTH_COMMENT_IP_MAX_FAILS, lockMs = AUTH_LOCK_MS } = {}) {
  const now = Date.now();
  const row = authFailByIp.get(ip) || { count: 0, lockedUntil: 0 };
  if (row.lockedUntil && row.lockedUntil > now) return row;
  row.count += 1;
  if (row.count >= maxFails) {
    row.lockedUntil = now + lockMs;
    row.count = 0;
  }
  authFailByIp.set(ip, row);
  return row;
}

function clearIpAuthFail(ip) {
  authFailByIp.delete(ip);
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || process.env.admin_password || '';
}

/** 모든 관리자 변이 API 공통: timing-safe 비교 + IP 실패 잠금 */
function requireAdmin(req, res) {
  const ip = getRequestIp(req);
  if (rejectIfIpAuthLocked(ip, res)) return false;
  const { adminPasswordInput } = req.body || {};
  const adminPassword = getAdminPassword();
  if (!adminPassword || !safeEqualString(adminPasswordInput, adminPassword)) {
    recordIpAuthFail(ip, { maxFails: AUTH_ADMIN_MAX_FAILS, lockMs: AUTH_LOCK_MS });
    res.status(403).json({ error: 'Invalid admin password' });
    return false;
  }
  clearIpAuthFail(ip);
  return true;
}

function publicComment(doc) {
  return {
    id: String(doc._id),
    wordKey: doc.wordKey,
    nickname: doc.nickname || '',
    body: doc.body,
    date: doc.date,
  };
}

function publicBoardComment(doc) {
  return {
    id: String(doc._id),
    board: doc.board,
    contentKey: doc.contentKey,
    nickname: doc.nickname || '',
    body: doc.body,
    date: doc.date,
  };
}

// 영어 단어 퀴즈 (vocabulary-quiz.html) → 컬렉션 vocabularyquiz
const vocabularyQuizEntrySchema = new mongoose.Schema({
  title: String,
  quizzes: { type: [mongoose.Schema.Types.Mixed], default: [] },
  sourceUrl: { type: String, default: '' },
  sourceLabel: { type: String, default: '' },
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'vocabularyquiz' });

const VocabularyQuizEntry = mongoose.model('VocabularyQuizEntry', vocabularyQuizEntrySchema);

// 포토영어 (photo-english-list.html) → 컬렉션 photoenglish
const photoEnglishEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'photoenglish' });

const PhotoEnglishEntry = mongoose.model('PhotoEnglishEntry', photoEnglishEntrySchema);

// 랭킹 뉴스 (ranking-news-list.html) → 컬렉션 rankingnews
const rankingNewsEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'rankingnews' });

const RankingNewsEntry = mongoose.model('RankingNewsEntry', rankingNewsEntrySchema);

// 요리 어휘 (cooking-voca-list.html) → 컬렉션 cookingvoca
const cookingVocaEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'cookingvoca' });

const CookingVocaEntry = mongoose.model('CookingVocaEntry', cookingVocaEntrySchema);

// 컬쳐 어휘 (culture-voca-list.html) → 컬렉션 culturevoca
const cultureVocaEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'culturevoca' });

const CultureVocaEntry = mongoose.model('CultureVocaEntry', cultureVocaEntrySchema);

// 국방뉴스 (defense-news-list.html) → 컬렉션 defensenews
const defenseNewsEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'defensenews' });

const DefenseNewsEntry = mongoose.model('DefenseNewsEntry', defenseNewsEntrySchema);

// 경제뉴스 (economy-news-list.html) → 컬렉션 economynews
const economyNewsEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'economynews' });

const EconomyNewsEntry = mongoose.model('EconomyNewsEntry', economyNewsEntrySchema);

// 여행뉴스 (travel-news-list.html) → 컬렉션 travelnews
const travelNewsEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'travelnews' });

const TravelNewsEntry = mongoose.model('TravelNewsEntry', travelNewsEntrySchema);

// 스포츠뉴스 (sports-news-list.html) → 컬렉션 sportsnews
const sportsNewsEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'sportsnews' });

const SportsNewsEntry = mongoose.model('SportsNewsEntry', sportsNewsEntrySchema);

/** 추가 뉴스 보드 (미국·날씨/환경·유통·문학·헬스·정치·산업·AI·사건사고·우크라/러시아) */
let EXTRA_NEWS_BOARDS = [];
try {
  EXTRA_NEWS_BOARDS = JSON.parse(
    fs.readFileSync(new URL('./scripts/new-boards.json', import.meta.url), 'utf8')
  );
  if (!Array.isArray(EXTRA_NEWS_BOARDS)) EXTRA_NEWS_BOARDS = [];
} catch (e) {
  console.warn('[new-boards] scripts/new-boards.json 없음 — 추가 뉴스 보드 비활성:', e.message);
}
const extraNewsModels = {};
for (const board of EXTRA_NEWS_BOARDS) {
  const schema = new mongoose.Schema({
    title: String,
    message: String,
    nickname: String,
    password: String,
    date: { type: Date, default: Date.now },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    likedFingerprints: { type: [String], default: [] },
    isSecret: { type: Boolean, default: false },
    slug: { type: String, default: '' },
    metaDescription: { type: String, default: '' }
  }, { collection: board.collection });
  extraNewsModels[board.key] = mongoose.model(board.model, schema);
}

// 한국뉴스 (korea-news-list.html) → 컬렉션 koreanews
// category: '국방' | '국제' (제목 접두사 [국방]/[국제] 와 함께 사용)
const koreaNewsEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' },
  thumbnail: { type: String, default: '' },
  category: { type: String, default: '', enum: ['', '국방', '국제'] }
}, { collection: 'koreanews' });

const KoreaNewsEntry = mongoose.model('KoreaNewsEntry', koreaNewsEntrySchema);

// 쇼츠 배경 이미지 (shorts-bg-image-list.html) → 컬렉션 shortsbgimage
const shortsBgImageEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'shortsbgimage' });

const ShortsBgImageEntry = mongoose.model('ShortsBgImageEntry', shortsBgImageEntrySchema);

// Opinions (english-opinions-list.html) → 컬렉션 opinions
const opinionEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'opinions' });

const OpinionEntry = mongoose.model('OpinionEntry', opinionEntrySchema);

// 마음 다스리는 글 (calm-mind-list.html) → 컬렉션 calmmind
const calmMindEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'calmmind' });

const CalmMindEntry = mongoose.model('CalmMindEntry', calmMindEntrySchema);

// 영어 명언 (english-quotes-list.html) → 컬렉션 englishquotes
const englishQuotesEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  likedFingerprints: { type: [String], default: [] },
  isSecret: { type: Boolean, default: false },
  slug: { type: String, default: '' },
  metaDescription: { type: String, default: '' }
}, { collection: 'englishquotes' });

const EnglishQuotesEntry = mongoose.model('EnglishQuotesEntry', englishQuotesEntrySchema);

async function findEntryBySlug(req, res, Model, label) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.' });
    }
    /* password 필드는 조회에서 제외 (UX-031) */
    const entry = await Model.findOne({ slug: req.params.slug }).select(
      '-password -passwordHash -likedFingerprints'
    );
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    res.status(200).json({ entry });
  } catch (error) {
    console.error(`${label} by-slug 오류:`, error);
    res.status(500).json({ error: 'Error retrieving entry' });
  }
}

/** economy/travel/sports 와 동일 CRUD 보드를 path 하나로 등록 */
function registerSimpleNewsBoard(app, { key, label, viewPrefix, Model }) {
  const base = `/${key}`;
  app.get(base, async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
      }
      const entries = await Model.find().select('-password -passwordHash -likedFingerprints');
      res.status(200).json({ entries });
    } catch (error) {
      console.error(`${label} entries 오류:`, error);
      res.status(500).json({ error: `Error retrieving ${key} entries`, entries: [] });
    }
  });

  app.get(`${base}/by-slug/:slug`, (req, res) => findEntryBySlug(req, res, Model, label));

  app.post(base, requireWriteToken, async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.',
        detail: 'MongoDB connection not ready',
      });
    }
    const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
    if (!title || !message || !nickname || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newEntry = new Model({
      title,
      message,
      nickname,
      password: hashedPassword,
      isSecret: isSecret || false,
      slug: slug || '',
      metaDescription: metaDescription || '',
    });
    try {
      await newEntry.save();
      res.status(201).json({ entry: newEntry });
    } catch (error) {
      console.error(`${label} save 오류:`, error);
      res.status(500).json({ error: `Error saving ${key} entry`, detail: error.message });
    }
  });

  app.post(`${base}/:id/view`, (req, res) => handlePostView(req, res, Model, key, `${label} view`));

  app.post(`${base}/:id/like`, (req, res) => incrementEntryLike(req, res, Model));

  app.post(`${base}-viewpost`, async (req, res) => {
    const { id, password } = req.body;
    const entry = await Model.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.views += 1;
    await entry.save();
    res.json({ entry });
  });

  app.post(`${base}-updatepost`, async (req, res) => {
    try {
      const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
      const entry = await Model.findById(id);
      if (!entry) return res.status(404).json({ error: 'Post not found' });
      const isMatch = await safeBcryptCompare(password, entry.password);
      if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
      entry.title = title;
      entry.message = message;
      entry.nickname = nickname;
      entry.isSecret = isSecret;
      if (slug !== undefined) entry.slug = slug;
      if (metaDescription !== undefined) entry.metaDescription = metaDescription;
      await entry.save();
      res.json({ entry });
    } catch (error) {
      res.status(500).json({ error: 'Error updating post' });
    }
  });

  app.post(`${base}-deletepost`, async (req, res) => {
    const { id, password } = req.body;
    const entry = await Model.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    try {
      await Model.findByIdAndDelete(id);
      res.json({ message: 'Post deleted' });
    } catch (error) {
      res.status(500).json({ error: `Error deleting ${key} entry` });
    }
  });

  app.post(`${base}-admin/deletepost`, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.body;
    try {
      const entry = await Model.findById(id);
      if (!entry) return res.status(404).json({ error: 'Post not found' });
      await Model.findByIdAndDelete(id);
      res.json({ message: 'Post deleted by admin' });
    } catch (error) {
      res.status(500).json({ error: 'Error deleting post' });
    }
  });

  app.post(`${base}/delete-by-slug`, async (req, res) => {
    const { slug, password } = req.body;
    if (!slug || !password) {
      return res.status(400).json({ error: 'slug and password are required' });
    }
    try {
      const entry = await Model.findOne({ slug });
      if (!entry) return res.json({ deleted: 0 });
      const isMatch = await safeBcryptCompare(password, entry.password);
      if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
      await Model.findByIdAndDelete(entry._id);
      res.json({ deleted: 1 });
    } catch (error) {
      console.error(`${key}/delete-by-slug 오류:`, error);
      res.status(500).json({ error: `Error deleting ${key} entry` });
    }
  });
}

function applySeoFieldsToBody(body, entry) {
  const { slug, metaDescription } = body;
  if (slug !== undefined) entry.slug = slug;
  if (metaDescription !== undefined) entry.metaDescription = metaDescription;
}

function seoFieldsFromBody(body) {
  const { slug, metaDescription } = body;
  return {
    slug: slug || '',
    metaDescription: metaDescription || '',
  };
}

app.set('view engine', 'ejs');
app.set('views', './views');


// 루트 경로 엔드포인트 추가
app.get('/', (req, res) => {
  res.send('Welcome to the English With Easy Word Backend!');
});

// Open-Meteo 날씨 프록시 (브라우저 CORS 회피)
const weatherCache = new Map();
const WEATHER_CACHE_MS = 30 * 60 * 1000;
const WEATHER_FETCH_TIMEOUT_MS = 15000;
const WEATHER_FETCH_RETRIES = 2;

function weatherCacheKey(lat, lon) {
  return Math.round(lat * 10) + ':' + Math.round(lon * 10);
}

function mapWttrCodeToWmo(code) {
  const c = parseInt(code, 10);
  if (c === 113) return 0;
  if (c === 116) return 2;
  if (c === 119 || c === 122) return 3;
  if (c === 143 || c === 248 || c === 260) return 45;
  if (c >= 263 && c <= 284) return 51;
  if (c === 176 || (c >= 293 && c <= 308) || (c >= 353 && c <= 359)) return 61;
  if (c >= 227 && c <= 230) return 71;
  if (c >= 323 && c <= 338) return 71;
  if (c === 200 || (c >= 386 && c <= 395)) return 95;
  return 3;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenMeteo(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
    '&longitude=' + lon +
    '&current=temperature_2m,apparent_temperature,weathercode&timezone=auto';

  let lastError;
  for (let attempt = 0; attempt <= WEATHER_FETCH_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {}, WEATHER_FETCH_TIMEOUT_MS);
      if (!response.ok) {
        throw new Error('Open-Meteo HTTP ' + response.status);
      }
      const data = await response.json();
      const cur = data && data.current;
      if (!cur || cur.temperature_2m == null) {
        throw new Error('Open-Meteo returned no current data');
      }
      return {
        temperature: cur.temperature_2m,
        apparentTemperature: cur.apparent_temperature,
        weathercode: cur.weathercode,
        resolvedLabel: null
      };
    } catch (err) {
      lastError = err;
      if (attempt < WEATHER_FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function fetchWttrIn(lat, lon) {
  const url = 'https://wttr.in/' + lat + ',' + lon + '?format=j1';
  const response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'EnglishEasyStudy-Weather/1.0 (contact: englisheasystudy.com)' }
  }, WEATHER_FETCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error('wttr.in HTTP ' + response.status);
  }
  const data = await response.json();
  const cur = data && data.current_condition && data.current_condition[0];
  if (!cur || cur.temp_C == null) {
    throw new Error('wttr.in returned no current data');
  }
  const area = data.nearest_area && data.nearest_area[0];
  const areaName = area && area.areaName && area.areaName[0] && area.areaName[0].value;
  return {
    temperature: parseFloat(cur.temp_C),
    apparentTemperature: parseFloat(cur.FeelsLikeC),
    weathercode: mapWttrCodeToWmo(cur.weatherCode),
    resolvedLabel: areaName || null
  };
}

async function fetchWeatherData(lat, lon) {
  try {
    return await fetchOpenMeteo(lat, lon);
  } catch (openMeteoErr) {
    console.warn('Open-Meteo failed, using wttr.in fallback:', openMeteoErr.message);
    return await fetchWttrIn(lat, lon);
  }
}

function formatAreaLabel(address) {
  if (!address || typeof address !== 'object') return null;

  const shortenCity = (name) => {
    if (!name) return '';
    return name
      .replace(/특별시$/, '')
      .replace(/광역시$/, '')
      .replace(/특별자치시$/, '')
      .replace(/특별자치도$/, '')
      .trim();
  };

  const city = shortenCity(
    address.city || address.town || address.county || address.province || address.state
  );
  const district = address.borough || address.city_district || address.district || address.county;
  const neighborhood =
    address.suburb || address.quarter || address.neighbourhood || address.village || address.hamlet;

  const parts = [];
  if (city) parts.push(city);
  if (district && district !== city) parts.push(district);
  if (neighborhood && neighborhood !== district && neighborhood !== city) parts.push(neighborhood);

  return parts.length ? parts.join(' ') : null;
}

async function resolveAreaLabel(lat, lon) {
  const url =
    'https://nominatim.openstreetmap.org/reverse?lat=' + lat +
    '&lon=' + lon +
    '&format=json&accept-language=ko&addressdetails=1&zoom=14';

  try {
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'EnglishEasyStudy-Weather/1.0 (https://englisheasystudy.com)' }
    }, 8000);
    if (!response.ok) return null;
    const data = await response.json();
    return formatAreaLabel(data && data.address);
  } catch {
    return null;
  }
}

app.get('/weather', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const label = typeof req.query.label === 'string' ? req.query.label.slice(0, 40) : '서울';

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  const key = weatherCacheKey(lat, lon);
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.ts < WEATHER_CACHE_MS) {
    return res.json({ ...cached.payload, stale: false });
  }

  try {
    const [cur, areaLabel] = await Promise.all([
      fetchWeatherData(lat, lon),
      resolveAreaLabel(lat, lon)
    ]);
    const resolvedLabel = areaLabel || cur.resolvedLabel || label;
    const payload = {
      label: resolvedLabel,
      temperature: cur.temperature,
      apparentTemperature: cur.apparentTemperature,
      weathercode: cur.weathercode,
      stale: false
    };
    weatherCache.set(key, { ts: Date.now(), payload });
    res.json(payload);
  } catch (err) {
    const cause = err && err.cause ? String(err.cause) : '';
    console.error('Weather proxy error:', err.message, cause);
    if (cached) {
      return res.json({ ...cached.payload, stale: true });
    }
    res.status(502).json({ error: 'Failed to fetch weather' });
  }
});

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

// 2.English Study Route
app.post('/englishstudy', async (req, res) => {
  try {
    const userInput = req.body.inputWord;

    if (!userInput) {
      throw new Error('No input word provided');
    }
    
    console.log("Input word:", userInput);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are an English teacher living in korea. you must not forget you are speaking to young students. You must avoid responding to inquiries that contain inappropriate, sexual, or offensive language, including explicit terms such as "fuck," "sex," "cock," "pussy," "dick," "tits," "retard," "fag," "cunt," "asshole," "bitch," "whore," and "tranny." You must avoid answering sensitive issues such as violence and suicide for students. Instead, when users request clarification on the meaning of a word, you must provide 10 example sentences that use key phrases and idiomatic expressions, providing a series of sentences that follow a logical sequence, all must be centered around the theme of the user input word. Each example should be formatted to include a direct English translation followed by its Korean translation. all centered around the theme of the selected topic. The output must be in this format:
            Example:
            "I got up early at 6 a.m. to start preparing for the trip. (나는 여행 준비를 위해 오전 6시에 일찍 일어났다.)"
            "After breakfast, I got dressed and packed my suitcase. (아침을 먹은 후 옷을 입고 여행 가방을 쌌다.)"
            "I got a taxi to the airport to avoid traffic. (교통 체증을 피하기 위해 공항으로 가는 택시를 탔다.)"
            "Once at the airport, I got my boarding pass from the self-check-in kiosk. (공항에 도착하자마자 셀프 체크인 키오스크에서 탑승권을 받았다.)"
            "I got through security quickly because of my priority pass. (우선 탑승 패스 덕분에 보안을 빠르게 통과했다.)"
            "Before boarding, I got a cup of coffee to stay awake. (탑승 전에 잠을 깨기 위해 커피 한 잔을 샀다.)"
            "On the flight, I got a comfortable seat by the window. (비행기에서는 창가에 편안한 자리를 얻었다.)"
            "After landing, I got my luggage from the baggage carousel. (착륙 후 수하물 컨베이어 벨트에서 내 짐을 찾았다.)"
            "I got directions to the hotel from the airport information desk. (공항 안내 데스크에서 호텔까지 가는 길을 물어보았다.)"
            "Once I reached the hotel, I got my room key and settled in for a restful night. (호텔에 도착하자마자 방 열쇠를 받고 편안한 밤을 보냈다.)"`
        },
        {
          role: 'user',
          content: userInput
        }
      ],
      model: 'gpt-3.5-turbo',
    });

    const responseContent = completion.choices[0].message.content;
    console.log("Generated text:", responseContent);
    res.json({ assistant: responseContent });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

// New Business Advisor role
app.post('/business-advice', async (req, res) => {
  try {
    // Extract the question from the request body
    const question = req.body.questionInput;

    // Verify that the question exists
    if (!question) {
      return res.status(400).json({ advice: 'Please provide a valid question.' });
    }

    console.log("Question input:", question);  // 디버깅을 위해 추가

    // Call the OpenAI API to get advice
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher living in korea.You must avoid responding to inquiries that contain inappropriate, sexual, or offensive language, including explicit terms such as "fuck," "sex," "cock," "pussy," "dick," "tits," "retard," "fag," "cunt," "asshole," "bitch," "whore," and "tranny. You also must not encourage people to do illegal or unethical things such as violence, suicide. you must avoid sensitive issues. Other than that, You must provide answers to the questions that students ask. You must answer in english. you must not forget you are speaking to young students.'
        },
        {
          role: 'user',
          content: question
        }
      ],
    });

    // Extract the first response content
    const responseContent = completion.choices[0].message.content;
    console.log("Sending Business Advice response:", responseContent);

    // Send back the advice as JSON
    res.json({ advice: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


// English Chat Route/////////////////////////////////////
app.post('/english-chat', async (req, res) => {
  try {
    // Extract user input from the request body
    const userInput = req.body.inputMessage;

    if (!userInput) {
      throw new Error('No input message provided');
    }

    console.log("Input message:", userInput);  // 디버깅을 위해 추가

    // Simple conversation history (no session dependency)
    const messages = [
      {
        role: 'system',
        content: `You are a close friend having a casual chat. Be natural, spontaneous, and conversational - just like talking to a real friend. Your role is to:

1. **Continue the conversation naturally**: Don't start with greetings every time. Just respond to what they said
2. **Be genuinely conversational**: Respond like a real friend would, not like a teacher or tutor
3. **Share your own thoughts and experiences**: "Oh, I totally get that!", "That reminds me of when I...", "I'm actually thinking about..."
4. **Ask natural follow-up questions**: Based on what they say, not generic questions. If they say "I'm tired", ask "Why? Did you stay up late?" not "How are you?"
5. **Use casual, everyday language**: "That's cool!", "No way!", "Seriously?", "I know, right?"
6. **Show genuine interest**: React to what they're saying with emotion and curiosity
7. **Avoid repetitive patterns**: Don't ask the same questions repeatedly or use the same greetings. Keep the conversation flowing naturally
8. **Be spontaneous**: Share random thoughts, make jokes, react naturally to what they say
9. **Use contractions and informal language**: "I'm", "you're", "that's", "gonna", "wanna", etc.
10. **React with emotion**: "Wow!", "Oh no!", "That's awesome!", "That sucks!", "Haha, really?"
11. **Keep it light and fun**: Make the conversation enjoyable, not educational
12. **Don't repeat greetings**: Once the conversation has started, don't keep saying "Hey" or "Hello" - just continue the chat

Remember: You're a friend, not a teacher. Just chat naturally about whatever comes up in daily life!`
      },
      {
        role: 'user',
        content: userInput
      }
    ];

    // Call the OpenAI API to generate a response
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 150,
      temperature: 0.8
    });

    // Extract the response content
    const responseContent = completion.choices[0].message.content;
    console.log("Sending English Chat response:", responseContent);

    // No session dependency - simple response

    // Send back the response as JSON
    res.json({ response: responseContent });
  } catch (error) {
    console.error('Error:', error);

    // 보다 상세한 오류 메시지 출력
    if (error.response) {
      console.error('OpenAI API Error:', error.response.data);
      res.status(error.response.status).json({ error: error.response.data });
    } else {
      res.status(500).send(`Error processing your request: ${error.message}`);
    }
  }
});








// New Speaking Practice Route
app.post('/speaking-practice', async (req, res) => {
  try {
    const spokenText = req.body.spokenText;

    if (!spokenText) {
      throw new Error('No spoken text provided');
    }

    console.log("Spoken text:", spokenText);  // Debugging

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher living in Korea. Avoid inappropriate, sexual, or offensive language. Provide conversational responses and ask follow-up questions.'
        },
        {
          role: 'user',
          content: spokenText
        }
      ],
    });

    const responseContent = completion.data.choices[0].message.content;
    console.log("Sending Speaking Practice response:", responseContent);
    res.json({ response: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

// New Speaking Practice Route2
app.post('/speaking-practice2', async (req, res) => {
  try {
    const spokenText = req.body.spokenText;

    if (!spokenText) {
      throw new Error('No spoken text provided');
    }

    console.log("Spoken text:", spokenText);  // Debugging

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher living in Korea. Avoid inappropriate, sexual, or offensive language. Provide conversational responses and ask follow-up questions.'
        },
        {
          role: 'user',
          content: spokenText
        }
      ],
    });

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;
    console.log("Sending Speaking Practice response:", responseContent);
    res.json({ response: responseContent });
  } catch (error) {
    console.error('Error:', error.message, error.stack);
    res.status(500).json({ message: `Error processing your request: ${error.message}` });
  }
});


const words = [
  'accept', 'achieve', 'add', 'admire', 'admit', 'advise', 'afford', 'agree', 'alert', 'allow',
  'amuse', 'analyse', 'announce', 'annoy', 'answer', 'apologize', 'appear', 'applaud', 'appreciate', 'approve',
  'argue', 'arrange', 'arrest', 'arrive', 'ask', 'assist', 'assure', 'attach', 'attack', 'attempt',
  'attend', 'attract', 'avoid', 'back', 'bake', 'balance', 'ban', 'bang', 'base', 'bat',
  'bathe', 'battle', 'be', 'beam', 'bear', 'beat', 'become', 'beg', 'begin', 'behave',
  'believe', 'belong', 'bend', 'bet', 'bind', 'bite', 'bleach', 'bless', 'blind', 'blink',
  'blot', 'blow', 'boast', 'boil', 'bolt', 'bomb', 'book', 'bore', 'borrow', 'bounce',
  'bow', 'box', 'brake', 'branch', 'breathe', 'breed', 'bring', 'broadcast', 'brush', 'bubble',
  'build', 'bump', 'burn', 'burst', 'bury', 'buy', 'calculate', 'call', 'camp', 'care',
  'carry', 'carve', 'cause', 'challenge', 'change', 'charge', 'chase', 'cheat', 'check', 'cheer',
  'chew', 'choke', 'choose', 'chop', 'claim', 'clap', 'clean', 'clear', 'clip', 'close',
  'coach', 'coil', 'collect', 'colour', 'comb', 'come', 'command', 'communicate', 'compare', 'compete',
  'complain', 'complete', 'concentrate', 'concern', 'confess', 'confuse', 'connect', 'consider', 'consist', 'contain',
  'continue', 'copy', 'correct', 'cough', 'count', 'cover', 'crack', 'crash', 'crawl', 'cross',
  'crush', 'cry', 'cure', 'curl', 'curve', 'cut', 'cycle', 'dam', 'damage', 'dance',
  'dare', 'deal', 'decay', 'deceive', 'decide', 'decorate', 'delay', 'delight', 'deliver', 'depend',
  'describe', 'desert', 'deserve', 'destroy', 'detect', 'develop', 'disagree', 'disappear', 'disapprove', 'disarm',
  'discover', 'dislike', 'divide', 'double', 'doubt', 'drag', 'drain', 'dream', 'dress', 'drip',
  'drop', 'drown', 'drum', 'dry', 'dust', 'earn', 'educate', 'embarrass', 'employ', 'empty',
  'encourage', 'end', 'enjoy', 'enter', 'entertain', 'escape', 'examine', 'excite', 'excuse', 'exercise',
  'exist', 'expand', 'expect', 'explain', 'explode', 'extend', 'face', 'fade', 'fail', 'fancy',
  'fasten', 'fax', 'fear', 'fence', 'fetch', 'fight', 'file', 'fill', 'film', 'find',
  'fire', 'fit', 'fix', 'flap', 'flash', 'float', 'flood', 'flow', 'flower', 'fold',
  'follow', 'fool', 'force', 'form', 'found', 'frame', 'freeze', 'frighten', 'fry', 'gather',
  'gaze', 'gel', 'get', 'give', 'glow', 'glue', 'grab', 'grate', 'grease', 'greet',
  'grin', 'grip', 'groan', 'guarantee', 'guard', 'guess', 'guide', 'hammer', 'hand', 'handle',
  'hang', 'happen', 'harass', 'harm', 'hate', 'haunt', 'heal', 'heap', 'hear', 'heat',
  'help', 'hook', 'hop', 'hope', 'hover', 'hug', 'hum', 'hunt', 'hurry', 'hurt',
  'identify', 'ignore', 'imagine', 'impress', 'improve', 'include', 'increase', 'influence', 'inform', 'inject',
  'injure', 'instruct', 'intend', 'interest', 'interfere', 'interrupt', 'introduce', 'invent', 'invite', 'involve',
  'iron', 'irritate', 'jail', 'jam', 'jog', 'join', 'joke', 'judge', 'juggle', 'jump',
  'kick', 'kill', 'kiss', 'kneel', 'knit', 'knock', 'knot', 'know', 'label', 'land',
  'last', 'laugh', 'launch', 'learn', 'level', 'license', 'lick', 'lie', 'lift', 'light',
  'like', 'list', 'listen', 'live', 'load', 'lock', 'long', 'look', 'lose', 'love',
  'maintain', 'make', 'manage', 'march', 'mark', 'marry', 'match', 'mate', 'matter', 'measure',
  'meddle', 'melt', 'memorize', 'mend', 'mess up', 'milk', 'mine', 'miss', 'mix', 'moan',
  'moor', 'mourn', 'move', 'mow', 'muddle', 'mug', 'multiply', 'murder', 'nail', 'name',
  'need', 'nest', 'nod', 'note', 'notice', 'number', 'obey', 'object', 'observe', 'obtain',
  'occur', 'offend', 'offer', 'open', 'operate', 'order', 'overflow', 'owe', 'own', 'pack',
  'paddle', 'paint', 'park', 'part', 'pass', 'paste', 'pat', 'pause', 'pay', 'peck',
  'pedal', 'peel', 'peep', 'perform', 'permit', 'phone', 'pick', 'pinch', 'pine', 'place',
  'plan', 'plant', 'play', 'please', 'plug', 'point', 'poke', 'polish', 'pop', 'possess',
  'post', 'pour', 'practice', 'pray', 'preach', 'precede', 'prefer', 'prepare', 'present', 'preserve',
  'press', 'pretend', 'prevent', 'prick', 'print', 'produce', 'program', 'promise', 'protect', 'provide',
  'pull', 'pump', 'punch', 'puncture', 'punish', 'push', 'question', 'queue', 'race', 'radiate',
  'rain', 'raise', 'reach', 'realize', 'receive', 'recognize', 'record', 'reduce', 'reflect', 'refuse',
  'regret', 'reign', 'reject', 'rejoice', 'relax', 'release', 'rely', 'remain', 'remember', 'remind',
  'remove', 'repair', 'repeat', 'replace', 'reply', 'report', 'reproduce', 'request', 'rescue', 'retire',
  'return', 'rhyme', 'ride', 'ring', 'rinse', 'risk', 'rob', 'rock', 'roll', 'rot',
  'rub', 'ruin', 'rule', 'run', 'rush', 'sack', 'sail', 'satisfy', 'save', 'saw',
  'say', 'scare', 'scatter', 'scream', 'screw', 'scribble', 'scrub', 'seal', 'search', 'see',
  'sell', 'send', 'sense', 'separate', 'serve', 'set', 'settle', 'sew', 'shade', 'shake',
  'shape', 'share', 'shave', 'shelter', 'shine', 'shiver', 'shock', 'shop', 'shrug', 'sigh',
  'sign', 'signal', 'sin', 'sip', 'sit', 'ski', 'skip', 'slap', 'sleep', 'slice',
  'slide', 'slip', 'slow', 'smash', 'smell', 'smile', 'smoke', 'snatch', 'sneeze', 'sniff',
  'snore', 'snow', 'soak', 'soothe', 'sound', 'sow', 'spark', 'sparkle', 'speak', 'spell',
  'spend', 'spill', 'spoil', 'spot', 'spray', 'sprout', 'squash', 'squeak', 'squeal', 'squeeze',
  'stain', 'stamp', 'stand', 'stare', 'start', 'stay', 'steer', 'step', 'stir', 'stitch',
  'stop', 'store', 'strap', 'strengthen', 'stretch', 'strip', 'stroke', 'stuff', 'subtract', 'succeed',
  'suck', 'suffer', 'suggest', 'suit', 'supply', 'support', 'suppose', 'surprise', 'surround', 'suspect',
  'suspend', 'switch', 'talk', 'tame', 'tap', 'taste', 'teach', 'tear', 'tease', 'telephone',
  'tell', 'tempt', 'terrify', 'thank', 'thaw', 'tick', 'tickle', 'tie', 'time', 'tip',
  'tire', 'touch', 'tour', 'tow', 'trace', 'trade', 'train', 'transport', 'trap', 'travel',
  'treat', 'tremble', 'trick', 'trip', 'trot', 'trouble', 'trust', 'try', 'turn', 'twist',
  'type', 'undress', 'unfasten', 'unite', 'unlock', 'unpack', 'untidy', 'use', 'vanish', 'visit',
  'wail', 'wait', 'wake', 'walk', 'wander', 'want', 'warm', 'warn', 'wash', 'waste',
  'watch', 'water', 'wave', 'wear', 'weigh', 'welcome', 'whine', 'whip', 'whirl', 'whisper',
  'whistle', 'wink', 'wipe', 'wish', 'wobble', 'wonder', 'work', 'worry', 'wrap', 'wreck',
  'wrestle', 'wriggle', 'write', 'yawn', 'yell', 'zip', 'zoom'
];


function getRandomWord() {
  const randomIndex = Math.floor(Math.random() * words.length);
  return words[randomIndex];
}

//=================page16html
// Function to get a random word (renamed to getRandomWord2)
function getRandomWord2() {
  const words = [
    'be', 'have', 'do', 'say', 'make', 'go', 'take', 'come', 'see', 'know',
    'get', 'give', 'think', 'tell', 'work', 'call', 'try', 'ask', 'need', 'feel',
    'become', 'leave', 'put', 'mean', 'keep', 'let', 'begin', 'seem', 'help', 'talk',
    'turn', 'start', 'show', 'hear', 'play', 'run', 'move', 'like', 'live', 'believe',
    'hold', 'bring', 'happen', 'write', 'provide', 'sit', 'stand', 'lose', 'pay', 'meet',
    'include', 'continue', 'set', 'learn', 'change', 'lead', 'understand', 'watch', 'follow', 'stop',
    'create', 'speak', 'read', 'allow', 'add', 'spend', 'grow', 'open', 'walk', 'win',
    'offer', 'remember', 'love', 'consider', 'buy', 'wait', 'serve', 'die', 'send', 'expect',
    'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remain', 'suggest', 'raise', 'pass',
    'sell', 'require', 'report', 'decide', 'pull', 'return', 'explain', 'hope', 'develop', 'carry',
    'break', 'receive', 'agree', 'support', 'hit', 'produce', 'eat', 'cover', 'catch', 'draw',
    'choose', 'refer', 'appear', 'open', 'close', 'push', 'save', 'thank', 'try', 'use',
    'want', 'work', 'find', 'give', 'show', 'tell', 'call', 'ask', 'need', 'feel',
    'help', 'like', 'live', 'play', 'run', 'move', 'believe', 'bring', 'happen', 'write',
    'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'set', 'learn', 'change', 'watch',
    'follow', 'stop', 'create', 'speak', 'read', 'allow', 'spend', 'grow', 'offer', 'remember',
    'love', 'consider', 'buy', 'wait', 'die', 'send', 'expect', 'build', 'stay', 'fall',
    'cut', 'reach', 'kill', 'remain', 'suggest', 'raise', 'pass', 'sell', 'require', 'report',
    'decide', 'pull', 'return', 'hope', 'develop', 'carry', 'break', 'receive', 'agree', 'support',
    'hit', 'produce', 'eat', 'cover', 'catch', 'draw', 'choose', 'refer', 'appear', 'open',
    'close', 'push', 'thank', 'use', 'want', 'work', 'find', 'give', 'show', 'tell',
    'call', 'ask', 'need', 'feel', 'help', 'like', 'live', 'play', 'run', 'move',
    'believe', 'bring', 'happen', 'write', 'sit', 'stand', 'lose', 'pay', 'meet', 'include',
    'set', 'learn', 'change', 'watch', 'follow', 'stop', 'create', 'speak', 'read', 'allow',
    'spend', 'grow', 'offer', 'remember', 'love', 'consider', 'buy', 'wait', 'die', 'send',
    'expect', 'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remain', 'suggest', 'raise',
    'pass', 'sell', 'require', 'report', 'decide', 'pull', 'return', 'hope', 'develop', 'carry',
    'break', 'receive', 'agree', 'support', 'hit', 'produce', 'eat', 'cover', 'catch', 'draw',
    'choose', 'refer', 'appear'
];
  return words[Math.floor(Math.random() * words.length)];
}

// Quiz Route
app.post('/quiz', async (req, res) => {
  try {
    const word = getRandomWord2();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher. Create a vocabulary quiz for beginner to early middle school students. The sentence should be very short and simple, with a blank (____) where a word is missing. After the sentence, provide 4 multiple-choice options in this exact format:\n\n1. word\n2. word\n3. word\n4. word\n\nDo not include any hints or Korean translations.'
        },
        {
          role: 'user',
          content: `Create a quiz using the word "${word}". Write a simple sentence with a blank (____), then give 4 answer options numbered 1 to 4.`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    console.log("Sending Quiz response:", responseContent);
    res.json({ quiz: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

// Check Answer Route
app.post('/quiz/check', async (req, res) => {
  try {
    const { question, answer } = req.body;

    if (!question || !answer) {
      throw new Error('Question or answer not provided');
    }

    console.log("Question:", question);
    console.log("Answer:", answer);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher. A student answered a vocabulary quiz. Based on the sentence and selected answer, return the result using the following exact format :\n\nAnswer : <correct word>\nSentence : <the complete sentence with the correct word filled in>\nTranslation : <polite Korean translation of the sentence>\nExplanation : <brief explanation in English of why the word is correct>'
        },
        {
          role: 'user',
          content: `Sentence : ${question}\nSelected answer : ${answer}\n\nPlease respond exactly in this format :\nAnswer : word\nSentence : full sentence\nTranslation : polite Korean\nExplanation : short reason why the word is correct`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    console.log("Sending Check response:", responseContent);
    res.json({ result: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

// Show Answer Route
app.post('/quiz/show', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      throw new Error('Question not provided');
    }

    console.log("Received question:", question);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher. Choose the correct answer from the numbered options. Provide the answer in this EXACT format:\n\nAnswer: [number]. [word]\n\nexplanation: [One short sentence only]\n\nSimilar: [word1, word2]'
        },
        {
          role: 'user',
          content: `Choose the correct answer from the numbered options:\n\n${question}\n\nIMPORTANT: Be very brief. Summary should be ONE sentence only.`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    console.log("Sending Show Answer response:", responseContent);
    res.json({ answer: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});




//page================ Get Hint Route
app.post('/get-hint', async (req, res) => {
  try {
    const { item, hintIndex } = req.body;

    if (!item || hintIndex === undefined) {
      throw new Error('Item or hintIndex not provided');
    }

    console.log(`Item: ${item}, HintIndex: ${hintIndex}`);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant providing hints for a 20 Questions game. You must not provide the same hints twice. You must consider students are middle or high school students, so the level should be appropriate for students.'
        },
        {
          role: 'user',
          content: `Provide a hint for the word "${item}" suitable for hint number ${hintIndex + 1}.`
        }
      ],
    });

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content.trim();
    console.log("Sending Hint response:", responseContent);
    res.json({ hint: responseContent });
  } catch (error) {
    console.error('Error:', error);
    if (error.response) {
      console.error('OpenAI API Error:', error.response.data);
      res.status(error.response.status).json({ error: error.response.data });
    } else {
      res.status(500).send(`Error processing your request: ${error.message}`);
    }
  }
});

// Get Random Item Route
app.get('/get-random-item', (req, res) => {
  try {
    const randomItem = getRandomWord();
    console.log(`Random item selected: ${randomItem}`);
    res.json({ item: randomItem });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


// New Route to generate short text   page21=================================
app.post('/generate-short-text', async (req, res) => {
  try {
    const topic = req.body.topic;

    if (!topic) {
      throw new Error('No topic provided');
    }

    console.log("Selected topic:", topic);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are an English teacher living in Korea. You must not forget you are speaking to young students. Avoid responding to inquiries that contain inappropriate, sexual, or offensive language. Provide a long academic text (about 1000 characters) related to the selected topic. The text should be simple, easy to understand, and suitable for young students.`
        },
        {
          role: 'user',
          content: `Generate a long text for the topic "${topic}". The text should be about 1000 characters long.`
        }
      ],
      max_tokens: 512
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    let responseContent = completion.choices[0].message.content;
    console.log("Generated short text:", responseContent);

    // Ensure text is close to 1000 characters
    while (responseContent.length < 900) { // Set a lower threshold for minimum length
      const additionalCompletion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are an English teacher living in Korea. You must not forget you are speaking to young students. Avoid responding to inquiries that contain inappropriate, sexual, or offensive language. Provide a long academic text (about 1000 characters) related to the selected topic. The text should be simple, easy to understand, and suitable for young students.`
          },
          {
            role: 'user',
            content: `Continue the text for the topic "${topic}". Ensure the total length is about 1000 characters.`
          }
        ],
        max_tokens: 512
      });

      console.log("Additional completion response:", JSON.stringify(additionalCompletion, null, 2));

      if (!additionalCompletion.choices || additionalCompletion.choices.length === 0) {
        throw new Error('No choices in the additional completion response');
      }

      const additionalContent = additionalCompletion.choices[0].message.content;
      responseContent += " " + additionalContent;
      console.log("Extended short text:", additionalContent);
    }

    res.json({ shortText: responseContent });
  } catch (error) {
    console.error('Error generating short text:', error.message);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


app.post('/get-translation-explanation', async (req, res) => {
  try {
    const shortText = req.body.shortText;

    if (!shortText) {
      throw new Error('No short text provided');
    }

    console.log("Short text:", shortText);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are an English teacher living in Korea. Provide the Korean translation for the following text.`
        },
        {
          role: 'user',
          content: `Provide a translation for the following text: "${shortText}". The translation must be in Korean.`
        }
      ],
      max_tokens: 3000
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;
    console.log("Translation and explanation:", responseContent);

    res.json({ translationExplanation: responseContent });
  } catch (error) {
    console.error('Error getting translation and explanation:', error.message);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

//generated sentences=======================================
app.post('/generate-sentences', async (req, res) => {
  try {
    const { topic } = req.body;

    if (!topic) {
      return res.status(400).json({ advice: 'Please provide a valid topic.' });
    }

    console.log("Selected topic:", topic);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an English teacher. Provide 10 useful sentences for tourists. Each sentence must be in English followed by the Korean translation in parentheses. The format should be: "Please keep your belongings close to you at all times. (소지품을 항상 가까이에 보관해주세요.)"'},
        { role: 'user', content: `Generate useful expressions in english and korean for tourists related to the "${topic}".` }
      ],
      max_tokens: 512
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;

    res.json({ sentences: responseContent });
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Error details:', error.response ? error.response.data : 'No additional error details');
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

//===============================================================================
app.post('/get-synonyms', async (req, res) => {
  try {
    const { word } = req.body;
    console.log(`Received word: ${word}`);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Provide synonyms and related example sentences followed by the Korean translation in parentheses. the format must be "Apart - We sat apart from each other during the meeting. (우리는 회의 중에 서로 떨어져 앉았다.)".'
        },
        {
          role: 'user',
          content: `Give me synonyms and related simple and useful expressions as much as you can, followed by the Korean translation in parentheses for the word "${word}".`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    res.json({ synonyms: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error fetching synonyms.');
  }
});

//================================================================================page22.html
app.post('/ask-question', async (req, res) => {
  try {
    const { question } = req.body;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Answer the user\'s question based on the provided synonyms and example sentences. You must use the same language that users enter. korean to korean, english to english.'
        },
        {
          role: 'user',
          content: question
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    res.json({ synonyms: responseContent });
  } catch (error) {
    console.error('Error fetching synonyms:', error);
    res.status(500).send('Error fetching synonyms.');
  }
});


//================================================이 코드 보류page23
app.post('/get-synonyms-korean', async (req, res) => {
  try {
    const { word } = req.body;
    console.log(`Received word: ${word}`); // 요청 확인을 위한 로그

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Provide synonyms and related example sentences followed by the Korean translation in parentheses. The format must be "Apart - We sat apart from each other during the meeting. (우리는 회의 중에 서로 떨어져 앉았다.)".'
        },
        {
          role: 'user',
          content: `Give me synonyms and related simple and useful expressions as much as you can, followed by the Korean translation in parentheses for the word "${word}".`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    res.json({ synonyms: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

app.post('/ask-question-korean', async (req, res) => {
  try {
    const { question } = req.body;
    console.log(`Received question: ${question}`); // 요청 확인을 위한 로그

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Answer the user\'s question based on the provided synonyms and example sentences. You must use the same language that users enter. Korean to Korean, English to English.'
        },
        {
          role: 'user',
          content: question
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    res.json({ synonyms: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

//==========================================================
app.post('/get-fortune', async (req, res) => {
  try {
    const { word } = req.body;
    console.log(`Received word: ${word}`); // 요청 확인을 위한 로그

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a friendly and encouraging fortune teller who gives simple and positive predictions for young students.
            Your answers must be in simple English followed by Korean translations.
            Whenever a user provides a date, time, and place, you weave these elements into your fortune-telling, 
            offering clear and supportive predictions. Each response must be crafted with care to evoke a sense of positivity and motivation.
            Ensure that each prediction includes specific details such as:
            - Positive events that may happen.
            - Encouraging emotional states or changes the person might experience.
            - Natural phenomena (like weather, blooming flowers, etc.) related to the place and time provided.
            - Simple symbolic references that can be easily understood.
            - How these details connect to the person's past, present, or future in a positive way.`
        },
        {
          role: 'user',
          content: `Please provide a fortune: ${word}`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    console.log(`Response from OpenAI: ${responseContent}`);
    res.json({ fortune: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


//generated sentences=======================================page25
app.post('/generate-sentences2', async (req, res) => {
  try {
    const { topic } = req.body;

    if (!topic) {
      return res.status(400).json({ advice: 'Please provide a valid topic.' });
    }

    console.log("Selected topic:", topic);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an English teacher. Provide 10 useful sentences for students. Each sentence must be in English followed by the Korean translation in parentheses. The format should be: "Please keep your belongings close to you at all times. (소지품을 항상 가까이에 보관해주세요.)"'},
        { role: 'user', content: `Generate useful expressions in english and korean for students related to the "${topic}".` }
      ],
      max_tokens: 1000
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;

    res.json({ sentences: responseContent });
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Error details:', error.response ? error.response.data : 'No additional error details');
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

//===============================================================================

//generated sentences=======================================page25
app.post('/generate-sentences-routines', async (req, res) => {
  try {
    const { topic } = req.body;

    if (!topic) {
      return res.status(400).json({ advice: 'Please provide a valid topic.' });
    }

    console.log("Selected topic:", topic);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an English teacher. Provide 10 useful sentences for students. Each sentence must be in English followed by the Korean translation in parentheses. The format should be: "Please keep your belongings close to you at all times. (소지품을 항상 가까이에 보관해주세요.)"'},
        { role: 'user', content: `Generate useful expressions in english and korean for students related to the "${topic}".` }
      ],
      max_tokens: 1000
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;

    res.json({ sentences: responseContent });
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Error details:', error.response ? error.response.data : 'No additional error details');
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


//================================== News Voca API (newsvoca 컬렉션) – /guestbook


// New entry 생성 시 비밀번호 해시 처리
app.get('/guestbook', async (req, res) => {
  try {
    // MongoDB 연결 상태 확인
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        error: 'MongoDB 연결이 되지 않았습니다. MONGO_URI 환경 변수를 확인해주세요.',
        entries: []
      });
    }
    const entries = await GuestbookEntry.find().select('-password -passwordHash -likedFingerprints');
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Guestbook entries 오류:', error);
    res.status(500).json({ 
      error: 'Error retrieving guestbook entries',
      details: error.message,
      entries: []
    });
  }
});

app.get('/guestbook/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, GuestbookEntry, 'Guestbook')
);

app.post('/guestbook', requireWriteToken, async (req, res) => {
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  // date는 스키마의 default: Date.now로 자동 설정됨
  const newEntry = new GuestbookEntry({ 
    title, 
    message, 
    nickname, 
    password: hashedPassword,
    isSecret: isSecret || false,
    slug: slug || '',
    metaDescription: metaDescription || ''
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving guestbook entry' });
  }
});

// 조회수 증가 엔드포인트 (DB 1시간 중복 + IP 분당 rate limit)

async function handlePostView(req, res, Model, boardKey, logLabel = 'view') {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid post id' });
    }
    const entry = await Model.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });

    const decision = await allowViewIncrement(getViewClientIp(req), boardKey, id);
    if (!decision.ok) {
      return res.json({ entry, views: entry.views || 0, message: decision.message });
    }

    const updated = await Model.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true });
    if (!updated) return res.status(404).json({ error: 'Post not found' });
    return res.json({ entry: updated, views: updated.views });
  } catch (error) {
    console.error(`${logLabel} 오류:`, error);
    return res.status(500).json({ error: 'Error incrementing view count' });
  }
}


async function incrementEntryLike(req, res, Model) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid post id' });
    }
    const fingerprint = getClientIp(req);
    const entry = await Model.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const prints = entry.likedFingerprints || [];
    if (prints.includes(fingerprint)) {
      return res.json({ likes: entry.likes || 0, alreadyLiked: true });
    }
    entry.likes = (entry.likes || 0) + 1;
    entry.likedFingerprints = [...prints, fingerprint];
    await entry.save();
    res.json({ likes: entry.likes, alreadyLiked: false });
  } catch (error) {
    console.error('좋아요 증가 오류:', error);
    res.status(500).json({ error: 'Error incrementing like count' });
  }
}

app.post('/guestbook/:id/view', (req, res) => handlePostView(req, res, GuestbookEntry, 'guestbook'));

app.post('/guestbook/:id/like', (req, res) => incrementEntryLike(req, res, GuestbookEntry));

app.post('/viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await GuestbookEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await GuestbookEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await GuestbookEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting guestbook entry' });
  }
});

app.post('/guestbook/delete-by-slug', async (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) {
    return res.status(400).json({ error: 'slug and password are required' });
  }
  try {
    const entry = await GuestbookEntry.findOne({ slug });
    if (!entry) {
      return res.json({ deleted: 0 });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    await GuestbookEntry.findByIdAndDelete(entry._id);
    res.json({ deleted: 1 });
  } catch (error) {
    console.error('guestbook/delete-by-slug 오류:', error);
    res.status(500).json({ error: 'Error deleting guestbook entry' });
  }
});

app.post('/deleteposts-by-password', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }
  try {
    const entries = await GuestbookEntry.find().select('_id password');
    const checks = await Promise.all(
      entries.map(async (entry) => ({
        id: entry._id,
        match: await safeBcryptCompare(password, entry.password),
      }))
    );
    const matchingIds = checks.filter((c) => c.match).map((c) => c.id);
    if (matchingIds.length > 0) {
      await GuestbookEntry.deleteMany({ _id: { $in: matchingIds } });
    }
    res.json({ deleted: matchingIds.length });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting guestbook entries' });
  }
});
///=============
const adminPassword = process.env.ADMIN_PASSWORD || process.env.admin_password;

app.post('/admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;

  try {
    const entry = await GuestbookEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await GuestbookEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await GuestbookEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

//================================== Word of the Day API (wordofday 컬렉션)
app.get('/wordofday', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await WordOfDayEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Word of Day entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving word of day entries', entries: [] });
  }
});

app.get('/wordofday/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, WordOfDayEntry, 'WordOfDay')
);

app.post('/wordofday', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new WordOfDayEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    ...seoFieldsFromBody({ slug, metaDescription }),
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Word of Day save 오류:', error);
    res.status(500).json({ error: 'Error saving word of day entry', detail: error.message });
  }
});

app.post('/wordofday/:id/view', (req, res) => handlePostView(req, res, WordOfDayEntry, 'wordofday'));

app.post('/wordofday/:id/like', (req, res) => incrementEntryLike(req, res, WordOfDayEntry));

app.post('/wordofday-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await WordOfDayEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/wordofday-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await WordOfDayEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    applySeoFieldsToBody({ slug, metaDescription }, entry);
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/wordofday-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await WordOfDayEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await WordOfDayEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting guestbook entry' });
  }
});

app.post('/wordofday-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await WordOfDayEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await WordOfDayEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

//================================== 생활 영어 한 줄 (expressions)
registerExpressionsApi(app, { requireAdmin });

registerWordMeaningQuizApi(app);
registerExamApi(app);

//================================== 댓글/다운로드/검색 랭킹 대시보드
const rankingApi = registerRankingApi(app, { getRequestIp });

//================================== 영작 (여러 편, 유튜브 `영작 | 제목`)
function englishWritingPublic(doc) {
  return {
    id: doc.key && doc.key !== 'latest' ? doc.key : (doc.videoId || doc.key || ''),
    title: doc.title || '',
    text: doc.text || '',
    source: doc.source || '',
    url: doc.url || '',
    videoId: doc.videoId || '',
    updatedAt: doc.updatedAt || null,
  };
}

function englishWritingKey(videoId, title) {
  const id = String(videoId || '').trim().slice(0, 40);
  if (id) return id;
  const slug = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9A-Za-z가-힣]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || 'latest';
}

async function foldLatestEnglishWriting() {
  const latest = await EnglishWriting.findOne({ key: 'latest' });
  if (!latest) return;
  const key = String(latest.videoId || '').trim();
  if (!key) return;
  const other = await EnglishWriting.findOne({ key });
  if (!other) {
    await EnglishWriting.updateOne({ _id: latest._id }, { $set: { key } });
  } else {
    await EnglishWriting.deleteOne({ _id: latest._id });
  }
}

app.get('/english-writing', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.' });
    }
    await foldLatestEnglishWriting();
    const id = String(req.query.id || '').trim();
    if (id) {
      const doc =
        (await EnglishWriting.findOne({ key: id }).lean()) ||
        (await EnglishWriting.findOne({ videoId: id }).lean());
      if (!doc) return res.status(404).json({ error: '영작을 찾지 못했습니다.' });
      return res.status(200).json(englishWritingPublic(doc));
    }
    const docs = await EnglishWriting.find().sort({ updatedAt: -1 }).lean();
    res.status(200).json({
      items: docs.map((doc) => {
        const row = englishWritingPublic(doc);
        delete row.text;
        return row;
      }),
    });
  } catch (error) {
    console.error('English writing read 오류:', error);
    res.status(500).json({ error: 'Error retrieving english writing' });
  }
});

app.post('/english-writing', requireWriteToken, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.' });
    }
    const title = String(req.body?.title || '')
      .replace(/^\s*(영작|영어작문)\s*[|｜]\s*/, '')
      .trim()
      .slice(0, 200);
    const text = String(req.body?.text || '').trim().slice(0, 20000);
    if (!title || !text) {
      return res.status(400).json({ error: 'title and text are required' });
    }
    const videoId = String(req.body?.videoId || '').slice(0, 40);
    const key = englishWritingKey(videoId, title);
    const doc = await EnglishWriting.findOneAndUpdate(
      { key },
      {
        $set: {
          title,
          text,
          source: String(req.body?.source || '').slice(0, 300),
          url: String(req.body?.url || '').slice(0, 500),
          videoId,
          updatedAt: new Date(),
        },
        $setOnInsert: { key },
      },
      { upsert: true, new: true }
    );
    if (key !== 'latest') {
      await EnglishWriting.deleteOne({ key: 'latest', videoId: videoId || '__none__' });
    }
    res.status(200).json({
      ok: true,
      id: doc.key,
      title: doc.title,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    console.error('English writing save 오류:', error);
    res.status(500).json({ error: 'Error saving english writing' });
  }
});

//================================== One Sentence API (onesentence 컬렉션)
app.get('/onesentence', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    /* 오래된 것부터 = 화면 001 → 아래로 누적 */
    const entries = await OneSentenceEntry.find().sort({ date: 1, _id: 1 });
    res.status(200).json({ entries });
  } catch (error) {
    console.error('One Sentence entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving one-sentence entries', entries: [] });
  }
});

app.post('/onesentence', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: 'MongoDB에 연결되지 않았습니다.',
      detail: 'MongoDB connection not ready',
    });
  }
  const { word, pos, meaning, ko, en, highlight, ipa, ipaKo, cf, nickname, password } = req.body;
  if (!word || !en || !nickname || !password) {
    return res.status(400).json({ error: 'word, en, nickname, password are required' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const cfList = Array.isArray(cf)
      ? cf
          .map((c) => ({
            word: String(c?.word || '').trim(),
            pos: String(c?.pos || '').trim(),
            meaning: String(c?.meaning || '').trim(),
          }))
          .filter((c) => c.word)
      : [];
    const newEntry = new OneSentenceEntry({
      word: String(word).trim(),
      pos: String(pos || '').trim(),
      meaning: String(meaning || '').trim(),
      ko: String(ko || '').trim(),
      en: String(en).trim(),
      highlight: String(highlight || word).trim(),
      ipa: String(ipa || '').trim(),
      ipaKo: String(ipaKo || '').trim(),
      cf: cfList,
      nickname,
      password: hashedPassword,
    });
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('One Sentence save 오류:', error);
    res.status(500).json({ error: 'Error saving one-sentence entry', detail: error.message });
  }
});


function normalizeOneSentenceCf(cf) {
  if (Array.isArray(cf)) {
    return cf
      .map((c) => ({
        word: String(c?.word || '').trim(),
        pos: String(c?.pos || '').trim(),
        meaning: String(c?.meaning || '').trim(),
      }))
      .filter((c) => c.word);
  }
  const raw = String(cf || '').trim();
  if (!raw) return [];
  // "taken aback 숙어 - 깜짝 놀라다" / "weather 동사 - 견뎌내다"
  const m = raw.match(/^(.+?)\s+(\S+)\s*[-–—]\s*(.+)$/);
  if (m) {
    return [{ word: m[1].trim(), pos: m[2].trim(), meaning: m[3].trim() }];
  }
  return [{ word: raw, pos: '', meaning: '' }];
}

function requireOneSentenceAdmin(req, res) {
  return requireAdmin(req, res);
}

app.post('/onesentence/admin/create', async (req, res) => {
  if (!requireOneSentenceAdmin(req, res)) return;
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
  }
  const { word, pos, meaning, ko, en, highlight, ipa, ipaKo, cf, memo } = req.body || {};
  if (!word || !en) {
    return res.status(400).json({ error: 'word and en are required' });
  }
  try {
    const randomPw = `os_admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const hashedPassword = await bcrypt.hash(randomPw, 10);
    const newEntry = new OneSentenceEntry({
      word: String(word).trim(),
      pos: String(pos || '').trim(),
      meaning: String(meaning || '').trim(),
      ko: String(ko || '').trim(),
      en: String(en).trim(),
      highlight: String(highlight || word).trim(),
      ipa: String(ipa || '').trim(),
      ipaKo: String(ipaKo || '').trim(),
      cf: normalizeOneSentenceCf(cf),
      memo: String(memo || '').trim(),
      nickname: 'admin',
      password: hashedPassword,
    });
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('One Sentence admin create 오류:', error);
    res.status(500).json({ error: 'Error saving one-sentence entry', detail: error.message });
  }
});

app.post('/onesentence/admin/memo', async (req, res) => {
  if (!requireOneSentenceAdmin(req, res)) return;
  const { id, memo } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    const entry = await OneSentenceEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    entry.memo = String(memo == null ? '' : memo).trim();
    await entry.save();
    res.json({ entry });
  } catch (error) {
    console.error('One Sentence admin memo 오류:', error);
    res.status(500).json({ error: 'Error updating memo' });
  }
});

app.post('/onesentence/admin/deletepost', async (req, res) => {
  if (!requireOneSentenceAdmin(req, res)) return;
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    const entry = await OneSentenceEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await OneSentenceEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    console.error('One Sentence admin delete 오류:', error);
    res.status(500).json({ error: 'Error deleting one-sentence entry' });
  }
});

//================================== One Sentence Comments API
app.get('/onesentence/comments/counts', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', counts: {} });
    }
    const rows = await OneSentenceComment.aggregate([
      { $group: { _id: '$wordKey', count: { $sum: 1 } } },
    ]);
    const counts = {};
    rows.forEach((r) => {
      if (r && r._id) counts[r._id] = r.count;
    });
    res.json({ counts });
  } catch (error) {
    console.error('One Sentence comment counts 오류:', error);
    res.status(500).json({ error: 'Error retrieving comment counts', counts: {} });
  }
});

app.get('/onesentence/comments', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', comments: [] });
    }
    const wordKey = String(req.query.wordKey || '').trim();
    if (!wordKey) return res.status(400).json({ error: 'wordKey is required', comments: [] });
    const rows = await OneSentenceComment.find({ wordKey }).sort({ date: 1, _id: 1 }).select('-passwordHash');
    res.json({ comments: rows.map(publicComment) });
  } catch (error) {
    console.error('One Sentence comments list 오류:', error);
    res.status(500).json({ error: 'Error retrieving comments', comments: [] });
  }
});

app.post('/onesentence/comments', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
  }
  const { wordKey, word, pos, nickname, body, password, adminPasswordInput, website } = req.body || {};
  const key = String(wordKey || '').trim();
  if (!key) return res.status(400).json({ error: 'wordKey is required' });

  // 허니팟: 봇이 숨은 필드를 채우면 저장하지 않음 (성공처럼 보이게 201)
  if (String(website == null ? '' : website).trim()) {
    return res.status(201).json({
      comment: {
        id: 'ok',
        wordKey: key,
        nickname: String(nickname || '').trim() || '익명',
        body: String(body || '').trim().slice(0, 100),
        date: new Date().toISOString(),
      },
    });
  }

  const checked = validateCommentFields({ nickname, body, password });
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  const ip = getRequestIp(req);
  if (rejectIfIpAuthLocked(ip, res)) return;

  if (checked.reservedNick || isReservedAdminNickname(checked.nickname)) {
    const adminPw = getAdminPassword();
    if (!adminPw || !safeEqualString(adminPasswordInput, adminPw)) {
      recordIpAuthFail(ip, { maxFails: AUTH_ADMIN_MAX_FAILS, lockMs: AUTH_LOCK_MS });
      return res.status(403).json({ error: 'admin / 관리자 / 주인장 닉네임은 관리자 비밀번호가 필요해요.' });
    }
    clearIpAuthFail(ip);
  }

  const last = oneSentenceCommentIpCooldown.get(ip) || 0;
  if (Date.now() - last < COMMENT_CREATE_COOLDOWN_MS) {
    return res.status(429).json({ error: '잠시 후 다시 작성해 주세요. (60초에 1개)' });
  }

  const limitState = checkCommentCreateLimits(ip, key, checked.body);
  if (!limitState.ok) {
    return res.status(limitState.status).json({ error: limitState.error });
  }

  try {
    const passwordHash = await bcrypt.hash(checked.password, BCRYPT_ROUNDS);
    const doc = new OneSentenceComment({
      wordKey: key,
      word: String(word || '').trim(),
      pos: String(pos || '').trim(),
      nickname: checked.nickname,
      body: checked.body,
      passwordHash,
    });
    await doc.save();
    recordCommentCreateSuccess(ip, limitState);
    try {
      await rankingApi.recordCommentWord({
        word: doc.word,
        body: checked.body,
        ip,
        source: 'onesentence',
        date: doc.date,
      });
    } catch (e) {
      console.warn('ranking comment hook skipped', e.message);
    }
    res.status(201).json({ comment: publicComment(doc) });
  } catch (error) {
    console.error('One Sentence comment create 오류:', error);
    res.status(500).json({ error: 'Error saving comment' });
  }
});

async function verifyOneSentenceCommentPassword(doc, pw, ip) {
  if (doc.deleteLockedUntil && doc.deleteLockedUntil.getTime() > Date.now()) {
    return { ok: false, status: 429, error: '잠시 잠겼어요. 30분 뒤 다시 시도해 주세요.' };
  }
  const matched = await safeBcryptCompare(pw, doc.passwordHash);
  if (!matched) {
    doc.deleteFailCount = (doc.deleteFailCount || 0) + 1;
    if (doc.deleteFailCount >= COMMENT_DOC_MAX_FAILS) {
      doc.deleteLockedUntil = new Date(Date.now() + COMMENT_DOC_LOCK_MS);
      doc.deleteFailCount = 0;
    }
    await doc.save();
    if (ip) recordIpAuthFail(ip, { maxFails: AUTH_COMMENT_IP_MAX_FAILS, lockMs: AUTH_LOCK_MS });
    return { ok: false, status: 403, error: '비밀번호가 맞지 않아요' };
  }
  doc.deleteFailCount = 0;
  doc.deleteLockedUntil = null;
  if (ip) clearIpAuthFail(ip);
  return { ok: true };
}

app.post('/onesentence/comments/delete', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
  }
  const ip = getRequestIp(req);
  if (rejectIfIpAuthLocked(ip, res)) return;
  const { id, password } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  const pw = String(password == null ? '' : password);
  if (!pw || pw.length < 4 || pw.length > 14 || /\s/.test(pw)) {
    return res.status(400).json({ error: '비밀번호는 4~14자로 입력해 주세요.' });
  }
  try {
    const doc = await OneSentenceComment.findById(id);
    if (!doc) return res.status(404).json({ error: 'Comment not found' });
    const verified = await verifyOneSentenceCommentPassword(doc, pw, ip);
    if (!verified.ok) return res.status(verified.status).json({ error: verified.error });
    await OneSentenceComment.findByIdAndDelete(id);
    res.json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('One Sentence comment delete 오류:', error);
    res.status(500).json({ error: 'Error deleting comment' });
  }
});

app.post('/onesentence/comments/edit', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
  }
  const ip = getRequestIp(req);
  if (rejectIfIpAuthLocked(ip, res)) return;
  const { id, password, nickname, body, adminPasswordInput } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  const checked = validateCommentFields({ nickname, body, password });
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  if (checked.reservedNick || isReservedAdminNickname(checked.nickname)) {
    const adminPw = getAdminPassword();
    if (!adminPw || !safeEqualString(adminPasswordInput, adminPw)) {
      recordIpAuthFail(ip, { maxFails: AUTH_ADMIN_MAX_FAILS, lockMs: AUTH_LOCK_MS });
      return res.status(403).json({ error: 'admin / 관리자 / 주인장 닉네임은 관리자 비밀번호가 필요해요.' });
    }
    clearIpAuthFail(ip);
  }
  try {
    const doc = await OneSentenceComment.findById(id);
    if (!doc) return res.status(404).json({ error: 'Comment not found' });
    const verified = await verifyOneSentenceCommentPassword(doc, checked.password, ip);
    if (!verified.ok) return res.status(verified.status).json({ error: verified.error });
    doc.nickname = checked.nickname;
    doc.body = checked.body;
    await doc.save();
    res.json({ comment: publicComment(doc) });
  } catch (error) {
    console.error('One Sentence comment edit 오류:', error);
    res.status(500).json({ error: 'Error updating comment' });
  }
});

app.post('/onesentence/comments/admin/delete', async (req, res) => {
  if (!requireOneSentenceAdmin(req, res)) return;
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    const doc = await OneSentenceComment.findById(id);
    if (!doc) return res.status(404).json({ error: 'Comment not found' });
    await OneSentenceComment.findByIdAndDelete(id);
    res.json({ message: 'Comment deleted by admin' });
  } catch (error) {
    console.error('One Sentence comment admin delete 오류:', error);
    res.status(500).json({ error: 'Error deleting comment' });
  }
});

//================================== Board Comments API (뉴스 영어 등 글 단위)
app.get('/board-comments/count', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', count: 0 });
    }
    const board = String(req.query.board || '').trim();
    const contentKey = String(req.query.contentKey || '').trim();
    if (!board || !contentKey) return res.status(400).json({ error: 'board and contentKey required', count: 0 });
    const count = await BoardComment.countDocuments({ board, contentKey });
    res.json({ count });
  } catch (error) {
    console.error('Board comment count 오류:', error);
    res.status(500).json({ error: 'Error retrieving comment count', count: 0 });
  }
});

app.get('/board-comments', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', comments: [] });
    }
    const board = String(req.query.board || '').trim();
    const contentKey = String(req.query.contentKey || '').trim();
    if (!board || !contentKey) {
      return res.status(400).json({ error: 'board and contentKey required', comments: [] });
    }
    const rows = await BoardComment.find({ board, contentKey }).sort({ date: 1, _id: 1 }).select('-passwordHash');
    res.json({ comments: rows.map(publicBoardComment) });
  } catch (error) {
    console.error('Board comments list 오류:', error);
    res.status(500).json({ error: 'Error retrieving comments', comments: [] });
  }
});

app.post('/board-comments', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
  }
  const { board, contentKey, title, nickname, body, password, adminPasswordInput, website } = req.body || {};
  const boardKey = String(board || '').trim();
  const key = String(contentKey || '').trim();
  if (!boardKey || !key) return res.status(400).json({ error: 'board and contentKey are required' });

  if (String(website == null ? '' : website).trim()) {
    return res.status(201).json({
      comment: {
        id: 'ok',
        board: boardKey,
        contentKey: key,
        nickname: String(nickname || '').trim() || '익명',
        body: String(body || '').trim().slice(0, 100),
        date: new Date().toISOString(),
      },
    });
  }

  const checked = validateCommentFields({ nickname, body, password });
  if (!checked.ok) return res.status(400).json({ error: checked.error });

  const ip = getRequestIp(req);
  if (rejectIfIpAuthLocked(ip, res)) return;

  if (checked.reservedNick || isReservedAdminNickname(checked.nickname)) {
    const adminPw = getAdminPassword();
    if (!adminPw || !safeEqualString(adminPasswordInput, adminPw)) {
      recordIpAuthFail(ip, { maxFails: AUTH_ADMIN_MAX_FAILS, lockMs: AUTH_LOCK_MS });
      return res.status(403).json({ error: 'admin / 관리자 / 주인장 닉네임은 관리자 비밀번호가 필요해요.' });
    }
    clearIpAuthFail(ip);
  }

  const limitKey = `${boardKey}::${key}`;
  const last = oneSentenceCommentIpCooldown.get(ip) || 0;
  if (Date.now() - last < COMMENT_CREATE_COOLDOWN_MS) {
    return res.status(429).json({ error: '잠시 후 다시 작성해 주세요. (60초에 1개)' });
  }

  const limitState = checkCommentCreateLimits(ip, limitKey, checked.body);
  if (!limitState.ok) {
    return res.status(limitState.status).json({ error: limitState.error });
  }

  try {
    const passwordHash = await bcrypt.hash(checked.password, BCRYPT_ROUNDS);
    const doc = new BoardComment({
      board: boardKey,
      contentKey: key,
      title: String(title || '').trim().slice(0, 200),
      nickname: checked.nickname,
      body: checked.body,
      passwordHash,
    });
    await doc.save();
    recordCommentCreateSuccess(ip, limitState);
    try {
      await rankingApi.recordCommentWord({
        word: String(req.body?.word || '').trim(),
        body: checked.body,
        ip,
        source: boardKey || 'board',
        date: doc.date,
      });
    } catch (e) {
      console.warn('ranking board-comment hook skipped', e.message);
    }
    res.status(201).json({ comment: publicBoardComment(doc) });
  } catch (error) {
    console.error('Board comment create 오류:', error);
    res.status(500).json({ error: 'Error saving comment' });
  }
});

app.post('/board-comments/delete', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
  }
  const ip = getRequestIp(req);
  if (rejectIfIpAuthLocked(ip, res)) return;
  const { id, password } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  const pw = String(password == null ? '' : password);
  if (!pw || pw.length < 4 || pw.length > 14 || /\s/.test(pw)) {
    return res.status(400).json({ error: '비밀번호는 4~14자로 입력해 주세요.' });
  }
  try {
    const doc = await BoardComment.findById(id);
    if (!doc) return res.status(404).json({ error: 'Comment not found' });
    const verified = await verifyOneSentenceCommentPassword(doc, pw, ip);
    if (!verified.ok) return res.status(verified.status).json({ error: verified.error });
    await BoardComment.findByIdAndDelete(id);
    res.json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('Board comment delete 오류:', error);
    res.status(500).json({ error: 'Error deleting comment' });
  }
});

app.post('/board-comments/edit', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
  }
  const ip = getRequestIp(req);
  if (rejectIfIpAuthLocked(ip, res)) return;
  const { id, password, nickname, body, adminPasswordInput } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  const checked = validateCommentFields({ nickname, body, password });
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  if (checked.reservedNick || isReservedAdminNickname(checked.nickname)) {
    const adminPw = getAdminPassword();
    if (!adminPw || !safeEqualString(adminPasswordInput, adminPw)) {
      recordIpAuthFail(ip, { maxFails: AUTH_ADMIN_MAX_FAILS, lockMs: AUTH_LOCK_MS });
      return res.status(403).json({ error: 'admin / 관리자 / 주인장 닉네임은 관리자 비밀번호가 필요해요.' });
    }
    clearIpAuthFail(ip);
  }
  try {
    const doc = await BoardComment.findById(id);
    if (!doc) return res.status(404).json({ error: 'Comment not found' });
    const verified = await verifyOneSentenceCommentPassword(doc, checked.password, ip);
    if (!verified.ok) return res.status(verified.status).json({ error: verified.error });
    doc.nickname = checked.nickname;
    doc.body = checked.body;
    await doc.save();
    res.json({ comment: publicBoardComment(doc) });
  } catch (error) {
    console.error('Board comment edit 오류:', error);
    res.status(500).json({ error: 'Error updating comment' });
  }
});

app.post('/board-comments/admin/delete', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    const doc = await BoardComment.findById(id);
    if (!doc) return res.status(404).json({ error: 'Comment not found' });
    await BoardComment.findByIdAndDelete(id);
    res.json({ message: 'Comment deleted by admin' });
  } catch (error) {
    console.error('Board comment admin delete 오류:', error);
    res.status(500).json({ error: 'Error deleting comment' });
  }
});

//================================== Vocabulary Quiz API (vocabularyquiz 컬렉션)
app.get('/vocabulary-quiz', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await VocabularyQuizEntry.find().sort({ date: 1 });
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Vocabulary Quiz entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving vocabulary quiz entries', entries: [] });
  }
});

app.get('/vocabulary-quiz/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, VocabularyQuizEntry, 'VocabularyQuiz')
);

app.post('/vocabulary-quiz', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
  }
  const {
    title, quizzes, sourceUrl, sourceLabel, nickname, password,
    isSecret, slug, metaDescription
  } = req.body;
  if (!title || !Array.isArray(quizzes) || !quizzes.length || !nickname || !password) {
    return res.status(400).json({ error: 'title, quizzes, nickname and password are required' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newEntry = new VocabularyQuizEntry({
      title,
      quizzes,
      sourceUrl: sourceUrl || '',
      sourceLabel: sourceLabel || '',
      nickname,
      password: hashedPassword,
      isSecret: isSecret || false,
      ...seoFieldsFromBody({ slug, metaDescription }),
    });
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Vocabulary Quiz save 오류:', error);
    res.status(500).json({ error: 'Error saving vocabulary quiz entry', detail: error.message });
  }
});

app.post('/vocabulary-quiz-deletepost', async (req, res) => {
  const { id, password } = req.body;
  try {
    const entry = await VocabularyQuizEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    await VocabularyQuizEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting vocabulary quiz entry' });
  }
});

//================================== Photo English API (photoenglish 컬렉션)
app.get('/photo-english', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await PhotoEnglishEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Photo English entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving photo english entries', entries: [] });
  }
});

app.get('/photo-english/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, PhotoEnglishEntry, 'PhotoEnglish')
);

app.post('/photo-english', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new PhotoEnglishEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    ...seoFieldsFromBody({ slug, metaDescription }),
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Photo English save 오류:', error);
    res.status(500).json({ error: 'Error saving photo english entry', detail: error.message });
  }
});

app.post('/photo-english/:id/view', (req, res) => handlePostView(req, res, PhotoEnglishEntry, 'photo-english'));

app.post('/photo-english/:id/like', (req, res) => incrementEntryLike(req, res, PhotoEnglishEntry));

app.post('/photo-english-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await PhotoEnglishEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/photo-english-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await PhotoEnglishEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    applySeoFieldsToBody({ slug, metaDescription }, entry);
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/photo-english-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await PhotoEnglishEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await PhotoEnglishEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting guestbook entry' });
  }
});

app.post('/photo-english-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await PhotoEnglishEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await PhotoEnglishEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

//================================== Ranking News API (rankingnews 컬렉션)
app.get('/ranking-news', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await RankingNewsEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Ranking News entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving ranking news entries', entries: [] });
  }
});

app.get('/ranking-news/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, RankingNewsEntry, 'RankingNews')
);

app.post('/ranking-news', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new RankingNewsEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    slug: slug || '', metaDescription: metaDescription || ''
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Ranking News save 오류:', error);
    res.status(500).json({ error: 'Error saving ranking news entry', detail: error.message });
  }
});

app.post('/ranking-news/:id/view', (req, res) => handlePostView(req, res, RankingNewsEntry, 'ranking-news'));

app.post('/ranking-news/:id/like', (req, res) => incrementEntryLike(req, res, RankingNewsEntry));

app.post('/ranking-news-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await RankingNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/ranking-news-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await RankingNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/ranking-news-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await RankingNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await RankingNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting ranking news entry' });
  }
});

app.post('/ranking-news-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await RankingNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await RankingNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

//================================== Cooking Voca API (cookingvoca 컬렉션)
app.get('/cooking-voca', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await CookingVocaEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Cooking Voca entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving cooking voca entries', entries: [] });
  }
});

app.get('/cooking-voca/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, CookingVocaEntry, 'CookingVoca')
);

app.post('/cooking-voca', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new CookingVocaEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    slug: slug || '', metaDescription: metaDescription || ''
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Cooking Voca save 오류:', error);
    res.status(500).json({ error: 'Error saving cooking voca entry', detail: error.message });
  }
});

app.post('/cooking-voca/:id/view', (req, res) => handlePostView(req, res, CookingVocaEntry, 'cooking-voca'));

app.post('/cooking-voca/:id/like', (req, res) => incrementEntryLike(req, res, CookingVocaEntry));

app.post('/cooking-voca-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await CookingVocaEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/cooking-voca-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await CookingVocaEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/cooking-voca-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await CookingVocaEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await CookingVocaEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting cooking voca entry' });
  }
});

app.post('/cooking-voca-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await CookingVocaEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await CookingVocaEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

//================================== Culture Voca API (culturevoca 컬렉션)
app.get('/culture-voca', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await CultureVocaEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Culture Voca entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving culture voca entries', entries: [] });
  }
});

app.get('/culture-voca/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, CultureVocaEntry, 'CultureVoca')
);

app.post('/culture-voca', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new CultureVocaEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    slug: slug || '', metaDescription: metaDescription || ''
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Culture Voca save 오류:', error);
    res.status(500).json({ error: 'Error saving culture voca entry', detail: error.message });
  }
});

app.post('/culture-voca/:id/view', (req, res) => handlePostView(req, res, CultureVocaEntry, 'culture-voca'));

app.post('/culture-voca/:id/like', (req, res) => incrementEntryLike(req, res, CultureVocaEntry));

app.post('/culture-voca-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await CultureVocaEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/culture-voca-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await CultureVocaEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/culture-voca-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await CultureVocaEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await CultureVocaEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting culture voca entry' });
  }
});

app.post('/culture-voca-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await CultureVocaEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await CultureVocaEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

//================================== Defense News API (defensenews 컬렉션)
app.get('/defense-news', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await DefenseNewsEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Defense News entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving defense news entries', entries: [] });
  }
});

app.get('/defense-news/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, DefenseNewsEntry, 'DefenseNews')
);

app.post('/defense-news', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new DefenseNewsEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    slug: slug || '', metaDescription: metaDescription || ''
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Defense News save 오류:', error);
    res.status(500).json({ error: 'Error saving defense news entry', detail: error.message });
  }
});

app.post('/defense-news/:id/view', (req, res) => handlePostView(req, res, DefenseNewsEntry, 'defense-news'));

app.post('/defense-news/:id/like', (req, res) => incrementEntryLike(req, res, DefenseNewsEntry));

app.post('/defense-news-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await DefenseNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/defense-news-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await DefenseNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/defense-news-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await DefenseNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await DefenseNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting defense news entry' });
  }
});

app.post('/defense-news-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await DefenseNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await DefenseNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/defense-news/delete-by-slug', async (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) {
    return res.status(400).json({ error: 'slug and password are required' });
  }
  try {
    const entry = await DefenseNewsEntry.findOne({ slug });
    if (!entry) {
      return res.json({ deleted: 0 });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    await DefenseNewsEntry.findByIdAndDelete(entry._id);
    res.json({ deleted: 1 });
  } catch (error) {
    console.error('defense-news/delete-by-slug 오류:', error);
    res.status(500).json({ error: 'Error deleting defense news entry' });
  }
});

//================================== Economy News API (economynews 컬렉션)
app.get('/economy-news', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await EconomyNewsEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Economy News entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving economy news entries', entries: [] });
  }
});

app.get('/economy-news/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, EconomyNewsEntry, 'EconomyNews')
);

app.post('/economy-news', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new EconomyNewsEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    slug: slug || '', metaDescription: metaDescription || ''
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Economy News save 오류:', error);
    res.status(500).json({ error: 'Error saving economy news entry', detail: error.message });
  }
});

app.post('/economy-news/:id/view', (req, res) => handlePostView(req, res, EconomyNewsEntry, 'economy-news'));

app.post('/economy-news/:id/like', (req, res) => incrementEntryLike(req, res, EconomyNewsEntry));

app.post('/economy-news-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await EconomyNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/economy-news-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await EconomyNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/economy-news-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await EconomyNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await EconomyNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting economy news entry' });
  }
});

app.post('/economy-news-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await EconomyNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await EconomyNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/economy-news/delete-by-slug', async (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) {
    return res.status(400).json({ error: 'slug and password are required' });
  }
  try {
    const entry = await EconomyNewsEntry.findOne({ slug });
    if (!entry) {
      return res.json({ deleted: 0 });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    await EconomyNewsEntry.findByIdAndDelete(entry._id);
    res.json({ deleted: 1 });
  } catch (error) {
    console.error('economy-news/delete-by-slug 오류:', error);
    res.status(500).json({ error: 'Error deleting economy news entry' });
  }
});

//================================== Travel News API (travelnews 컬렉션)
app.get('/travel-news', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await TravelNewsEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Travel News entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving travel news entries', entries: [] });
  }
});

app.get('/travel-news/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, TravelNewsEntry, 'TravelNews')
);

app.post('/travel-news', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new TravelNewsEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    slug: slug || '', metaDescription: metaDescription || ''
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Travel News save 오류:', error);
    res.status(500).json({ error: 'Error saving travel news entry', detail: error.message });
  }
});

app.post('/travel-news/:id/view', (req, res) => handlePostView(req, res, TravelNewsEntry, 'travel-news'));

app.post('/travel-news/:id/like', (req, res) => incrementEntryLike(req, res, TravelNewsEntry));

app.post('/travel-news-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await TravelNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/travel-news-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await TravelNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/travel-news-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await TravelNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await TravelNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting travel news entry' });
  }
});

app.post('/travel-news-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await TravelNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await TravelNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/travel-news/delete-by-slug', async (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) {
    return res.status(400).json({ error: 'slug and password are required' });
  }
  try {
    const entry = await TravelNewsEntry.findOne({ slug });
    if (!entry) {
      return res.json({ deleted: 0 });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    await TravelNewsEntry.findByIdAndDelete(entry._id);
    res.json({ deleted: 1 });
  } catch (error) {
    console.error('travel-news/delete-by-slug 오류:', error);
    res.status(500).json({ error: 'Error deleting travel news entry' });
  }
});

//================================== Sports News API (sportsnews 컬렉션)
app.get('/sports-news', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await SportsNewsEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Sports News entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving sports news entries', entries: [] });
  }
});

app.get('/sports-news/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, SportsNewsEntry, 'SportsNews')
);

app.post('/sports-news', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new SportsNewsEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    slug: slug || '', metaDescription: metaDescription || ''
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Sports News save 오류:', error);
    res.status(500).json({ error: 'Error saving sports news entry', detail: error.message });
  }
});

app.post('/sports-news/:id/view', (req, res) => handlePostView(req, res, SportsNewsEntry, 'sports-news'));

app.post('/sports-news/:id/like', (req, res) => incrementEntryLike(req, res, SportsNewsEntry));

app.post('/sports-news-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await SportsNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/sports-news-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await SportsNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/sports-news-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await SportsNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await SportsNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting sports news entry' });
  }
});

app.post('/sports-news-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await SportsNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await SportsNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/sports-news/delete-by-slug', async (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) {
    return res.status(400).json({ error: 'slug and password are required' });
  }
  try {
    const entry = await SportsNewsEntry.findOne({ slug });
    if (!entry) {
      return res.json({ deleted: 0 });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    await SportsNewsEntry.findByIdAndDelete(entry._id);
    res.json({ deleted: 1 });
  } catch (error) {
    console.error('sports-news/delete-by-slug 오류:', error);
    res.status(500).json({ error: 'Error deleting sports news entry' });
  }
});

//================================== Extra news boards (미국·날씨/환경·유통·문학·헬스·정치·산업·AI·사건사고·우크라/러시아)
for (const board of EXTRA_NEWS_BOARDS) {
  registerSimpleNewsBoard(app, {
    key: board.key,
    label: board.labelFull || board.label,
    viewPrefix: board.viewPrefix,
    Model: extraNewsModels[board.key],
  });
  console.log(`- Extra board registered: /${board.key} (${board.labelFull})`);
}

//================================== Korea News API (koreanews 컬렉션) — 국방 / 국제
app.get('/korea-news', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const filter = {};
    if (req.query.category === '국방' || req.query.category === '국제') {
      filter.category = req.query.category;
    }
    const entries = await KoreaNewsEntry.find(filter);
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Korea News entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving korea news entries', entries: [] });
  }
});

app.get('/korea-news/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, KoreaNewsEntry, 'KoreaNews')
);

app.post('/korea-news', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription, category } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const cat = category === '국방' || category === '국제' ? category : '';
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new KoreaNewsEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    slug: slug || '', metaDescription: metaDescription || '', category: cat
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Korea News save 오류:', error);
    res.status(500).json({ error: 'Error saving korea news entry', detail: error.message });
  }
});

app.post('/korea-news/:id/view', (req, res) => handlePostView(req, res, KoreaNewsEntry, 'korea-news'));

app.post('/korea-news/:id/like', (req, res) => incrementEntryLike(req, res, KoreaNewsEntry));

app.post('/korea-news-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await KoreaNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/korea-news-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription, category } = req.body;
    const entry = await KoreaNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    if (category !== undefined) {
      entry.category = category === '국방' || category === '국제' ? category : '';
    }
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/korea-news-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await KoreaNewsEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await KoreaNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting korea news entry' });
  }
});

app.post('/korea-news-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await KoreaNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await KoreaNewsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/korea-news/delete-by-slug', async (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) {
    return res.status(400).json({ error: 'slug and password are required' });
  }
  try {
    const entry = await KoreaNewsEntry.findOne({ slug });
    if (!entry) {
      return res.json({ deleted: 0 });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    await KoreaNewsEntry.findByIdAndDelete(entry._id);
    res.json({ deleted: 1 });
  } catch (error) {
    console.error('korea-news/delete-by-slug 오류:', error);
    res.status(500).json({ error: 'Error deleting korea news entry' });
  }
});

//================================== Shorts Background Image API (shortsbgimage 컬렉션)
app.get('/shorts-bg-image', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', entries: [] });
    }
    const entries = await ShortsBgImageEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Shorts bg image entries 오류:', error);
    res.status(500).json({ error: 'Error retrieving shorts bg image entries', entries: [] });
  }
});

app.get('/shorts-bg-image/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, ShortsBgImageEntry, 'ShortsBgImage')
);

app.post('/shorts-bg-image', requireWriteToken, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new ShortsBgImageEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false,
    slug: slug || '', metaDescription: metaDescription || ''
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Shorts bg image save 오류:', error);
    res.status(500).json({ error: 'Error saving shorts bg image entry', detail: error.message });
  }
});

app.post('/shorts-bg-image/:id/view', (req, res) => handlePostView(req, res, ShortsBgImageEntry, 'shorts-bg-image'));

app.post('/shorts-bg-image/:id/like', (req, res) => incrementEntryLike(req, res, ShortsBgImageEntry));

app.post('/shorts-bg-image-viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await ShortsBgImageEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/shorts-bg-image-updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await ShortsBgImageEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    if (slug !== undefined) entry.slug = slug;
    if (metaDescription !== undefined) entry.metaDescription = metaDescription;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

app.post('/shorts-bg-image-deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await ShortsBgImageEntry.findById(id);
  if (!entry) return res.status(404).json({ error: 'Post not found' });
  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
  try {
    await ShortsBgImageEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting shorts bg image entry' });
  }
});

app.post('/shorts-bg-image-admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;
  try {
    const entry = await ShortsBgImageEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await ShortsBgImageEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/shorts-bg-image/delete-by-slug', async (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) {
    return res.status(400).json({ error: 'slug and password are required' });
  }
  try {
    const entry = await ShortsBgImageEntry.findOne({ slug });
    if (!entry) {
      return res.json({ deleted: 0 });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    await ShortsBgImageEntry.findByIdAndDelete(entry._id);
    res.json({ deleted: 1 });
  } catch (error) {
    console.error('shorts-bg-image/delete-by-slug 오류:', error);
    res.status(500).json({ error: 'Error deleting shorts bg image entry' });
  }
});

//================================== Vocabulary API – Synonyms (synonyms 컬렉션)

// Vocabulary entries 조회
app.get('/vocabulary', async (req, res) => {
  try {
    // MongoDB 연결 상태 확인
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        error: 'MongoDB 연결이 되지 않았습니다. MONGO_URI 환경 변수를 확인해주세요.',
        entries: []
      });
    }
    const entries = await VocabularyEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Vocabulary entries 오류:', error);
    res.status(500).json({ 
      error: 'Error retrieving vocabulary entries',
      details: error.message,
      entries: []
    });
  }
});

// Vocabulary entry 생성
app.get('/vocabulary/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, VocabularyEntry, 'Vocabulary')
);

app.post('/vocabulary', requireWriteToken, async (req, res) => {
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new VocabularyEntry({ 
    title, 
    message, 
    nickname, 
    password: hashedPassword,
    isSecret: isSecret || false,
    ...seoFieldsFromBody({ slug, metaDescription }),
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving vocabulary entry' });
  }
});

// Vocabulary 조회수 증가 엔드포인트
app.post('/vocabulary/:id/view', (req, res) => handlePostView(req, res, VocabularyEntry, 'vocabulary'));

app.post('/vocabulary/:id/like', (req, res) => incrementEntryLike(req, res, VocabularyEntry));

// Vocabulary entry 조회 (비밀번호 확인)
app.post('/vocabulary/viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await VocabularyEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

// Vocabulary entry 삭제
app.post('/vocabulary/deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await VocabularyEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await VocabularyEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting vocabulary entry' });
  }
});

// Vocabulary entry 관리자 삭제
app.post('/vocabulary/admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;

  try {
    const entry = await VocabularyEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await VocabularyEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

// Vocabulary entry 수정
app.post('/vocabulary/updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await VocabularyEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    applySeoFieldsToBody({ slug, metaDescription }, entry);
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

//================================== Opinions API (opinions 컬렉션)

app.get('/opinions', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB 연결이 되지 않았습니다. MONGO_URI 환경 변수를 확인해주세요.',
        entries: []
      });
    }
    const entries = await OpinionEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Opinions entries 오류:', error);
    res.status(500).json({
      error: 'Error retrieving opinion entries',
      details: error.message,
      entries: []
    });
  }
});

app.get('/opinions/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, OpinionEntry, 'Opinions')
);

app.post('/opinions', requireWriteToken, async (req, res) => {
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new OpinionEntry({
    title,
    message,
    nickname,
    password: hashedPassword,
    isSecret: isSecret || false,
    ...seoFieldsFromBody({ slug, metaDescription }),
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving opinion entry' });
  }
});

app.post('/opinions/:id/view', (req, res) => handlePostView(req, res, OpinionEntry, 'opinions'));

app.post('/opinions/:id/like', (req, res) => incrementEntryLike(req, res, OpinionEntry));

app.post('/opinions/viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await OpinionEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/opinions/deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await OpinionEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await OpinionEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting opinion entry' });
  }
});

app.post('/opinions/admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;

  try {
    const entry = await OpinionEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await OpinionEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/opinions/updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await OpinionEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    applySeoFieldsToBody({ slug, metaDescription }, entry);
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

//================================== Calm Mind API (calmmind 컬렉션)

app.get('/calm-mind', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB 연결이 되지 않았습니다. MONGO_URI 환경 변수를 확인해주세요.',
        entries: []
      });
    }
    const entries = await CalmMindEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Calm Mind entries 오류:', error);
    res.status(500).json({
      error: 'Error retrieving calm mind entries',
      details: error.message,
      entries: []
    });
  }
});

app.get('/calm-mind/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, CalmMindEntry, 'Calm Mind')
);

app.post('/calm-mind', requireWriteToken, async (req, res) => {
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new CalmMindEntry({
    title,
    message,
    nickname,
    password: hashedPassword,
    isSecret: isSecret || false,
    ...seoFieldsFromBody({ slug, metaDescription }),
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving calm mind entry' });
  }
});

app.post('/calm-mind/:id/view', (req, res) => handlePostView(req, res, CalmMindEntry, 'calm-mind'));

app.post('/calm-mind/:id/like', (req, res) => incrementEntryLike(req, res, CalmMindEntry));

app.post('/calm-mind/viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await CalmMindEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/calm-mind/deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await CalmMindEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await CalmMindEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting calm mind entry' });
  }
});

app.post('/calm-mind/admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;

  try {
    const entry = await CalmMindEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await CalmMindEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/calm-mind/updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await CalmMindEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    applySeoFieldsToBody({ slug, metaDescription }, entry);
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

//================================== English Quotes API (englishquotes 컬렉션)

app.get('/english-quotes', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB 연결이 되지 않았습니다. MONGO_URI 환경 변수를 확인해주세요.',
        entries: []
      });
    }
    const entries = await EnglishQuotesEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('English Quotes entries 오류:', error);
    res.status(500).json({
      error: 'Error retrieving english quotes entries',
      details: error.message,
      entries: []
    });
  }
});

app.get('/english-quotes/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, EnglishQuotesEntry, 'English Quotes')
);

app.post('/english-quotes', requireWriteToken, async (req, res) => {
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new EnglishQuotesEntry({
    title,
    message,
    nickname,
    password: hashedPassword,
    isSecret: isSecret || false,
    ...seoFieldsFromBody({ slug, metaDescription }),
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving english quotes entry' });
  }
});

app.post('/english-quotes/:id/view', (req, res) => handlePostView(req, res, EnglishQuotesEntry, 'english-quotes'));

app.post('/english-quotes/:id/like', (req, res) => incrementEntryLike(req, res, EnglishQuotesEntry));

app.post('/english-quotes/viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await EnglishQuotesEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/english-quotes/deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await EnglishQuotesEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await EnglishQuotesEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting english quotes entry' });
  }
});

app.post('/english-quotes/admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;

  try {
    const entry = await EnglishQuotesEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await EnglishQuotesEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/english-quotes/updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await EnglishQuotesEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    applySeoFieldsToBody({ slug, metaDescription }, entry);
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

//================================== Popular Voca API (popularvoca 컬렉션)

app.get('/easy-voca', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB 연결이 되지 않았습니다. MONGO_URI 환경 변수를 확인해주세요.',
        entries: []
      });
    }
    const entries = await EasyVocaEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Easy Voca entries 오류:', error);
    res.status(500).json({
      error: 'Error retrieving easy voca entries',
      details: error.message,
      entries: []
    });
  }
});

app.get('/easy-voca/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, EasyVocaEntry, 'EasyVoca')
);

app.post('/easy-voca', requireWriteToken, async (req, res) => {
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new EasyVocaEntry({
    title,
    message,
    nickname,
    password: hashedPassword,
    isSecret: isSecret || false,
    ...seoFieldsFromBody({ slug, metaDescription }),
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving easy voca entry' });
  }
});

app.post('/easy-voca/:id/view', (req, res) => handlePostView(req, res, EasyVocaEntry, 'easy-voca'));

app.post('/easy-voca/:id/like', (req, res) => incrementEntryLike(req, res, EasyVocaEntry));

app.post('/easy-voca/viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await EasyVocaEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/easy-voca/deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await EasyVocaEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password required' });
  }
  if (!entry.password) {
    return res.status(400).json({ error: 'Post has no stored password' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await EasyVocaEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting easy voca entry' });
  }
});

app.post('/easy-voca/admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;

  try {
    const entry = await EasyVocaEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    await EasyVocaEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/easy-voca/updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await EasyVocaEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    applySeoFieldsToBody({ slug, metaDescription }, entry);
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

//================================== Situational English API (situationalenglish 컬렉션)

app.get('/situational-english', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB 연결이 되지 않았습니다. MONGO_URI 환경 변수를 확인해주세요.',
        entries: []
      });
    }
    const entries = await SituationalEnglishEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Situational English entries 오류:', error);
    res.status(500).json({
      error: 'Error retrieving situational english entries',
      details: error.message,
      entries: []
    });
  }
});

app.get('/situational-english/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, SituationalEnglishEntry, 'SituationalEnglish')
);

app.post('/situational-english', requireWriteToken, async (req, res) => {
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new SituationalEnglishEntry({
    title,
    message,
    nickname,
    password: hashedPassword,
    isSecret: isSecret || false,
    ...seoFieldsFromBody({ slug, metaDescription }),
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving situational english entry' });
  }
});

app.post('/situational-english/:id/view', (req, res) => handlePostView(req, res, SituationalEnglishEntry, 'situational-english'));

app.post('/situational-english/:id/like', (req, res) => incrementEntryLike(req, res, SituationalEnglishEntry));

app.post('/situational-english/viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await SituationalEnglishEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/situational-english/deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await SituationalEnglishEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password required' });
  }
  if (!entry.password) {
    return res.status(400).json({ error: 'Post has no stored password' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await SituationalEnglishEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting situational english entry' });
  }
});

app.post('/situational-english/admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;

  try {
    const entry = await SituationalEnglishEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    await SituationalEnglishEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/situational-english/updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await SituationalEnglishEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    applySeoFieldsToBody({ slug, metaDescription }, entry);
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

//================================== Pros & Cons API (proscons 컬렉션)

app.get('/pros-cons', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB 연결이 되지 않았습니다. MONGO_URI 환경 변수를 확인해주세요.',
        entries: []
      });
    }
    const entries = await ProsConsEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Pros & Cons entries 오류:', error);
    res.status(500).json({
      error: 'Error retrieving pros & cons entries',
      details: error.message,
      entries: []
    });
  }
});

app.get('/pros-cons/by-slug/:slug', (req, res) =>
  findEntryBySlug(req, res, ProsConsEntry, 'ProsCons')
);

app.post('/pros-cons', requireWriteToken, async (req, res) => {
  const { title, message, nickname, password, isSecret, slug, metaDescription } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new ProsConsEntry({
    title,
    message,
    nickname,
    password: hashedPassword,
    isSecret: isSecret || false,
    ...seoFieldsFromBody({ slug, metaDescription }),
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving pros & cons entry' });
  }
});

app.post('/pros-cons/:id/view', (req, res) => handlePostView(req, res, ProsConsEntry, 'pros-cons'));

app.post('/pros-cons/:id/like', (req, res) => incrementEntryLike(req, res, ProsConsEntry));

app.post('/pros-cons/viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await ProsConsEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/pros-cons/deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await ProsConsEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password required' });
  }
  if (!entry.password) {
    return res.status(400).json({ error: 'Post has no stored password' });
  }

  const isMatch = await safeBcryptCompare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await ProsConsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting pros & cons entry' });
  }
});

app.post('/pros-cons/admin/deletepost', async (req, res) => {
  if (!requireAdmin(req, res)) return;
    const { id } = req.body;

  try {
    const entry = await ProsConsEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    await ProsConsEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/pros-cons/updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret, slug, metaDescription } = req.body;
    const entry = await ProsConsEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    applySeoFieldsToBody({ slug, metaDescription }, entry);
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});

//==============================================================================
// RSS 피드 엔드포인트 추가
app.get('/rss', async (req, res) => {
  try {
    // 데이터베이스에서 최신 포스트를 가져옵니다.
    const entries = await GuestbookEntry.find().sort({ date: -1 }).limit(20);

    // RSS 피드 생성
    const feed = new RSS({
      title: 'free english study',
      description: 'English Happy Learning',
      feed_url: 'https://englisheasystudy.com/rss',
      site_url: 'https://englisheasystudy.com/',
      language: 'en'
    });

    // 포스트 데이터를 RSS 피드에 추가
    entries.forEach(entry => {
      feed.item({
        title: entry.title,
        description: entry.message,
        url: `https://englisheasystudy.com/${entry.url}`,
        date: entry.date
      });
    });

    // RSS 피드를 XML 형식으로 응답
    res.type('application/rss+xml');
    res.send(feed.xml());
  } catch (error) {
    console.error('Error generating RSS feed:', error);
    res.status(500).send('Error generating RSS feed.');
  }
});

/* node index.js 직접 실행 시에만 listen (Cloudtype은 server.js 진입) */
if (!globalThis.__EES_BOOTED_BY_SERVER && !app.__eesListening) {
  app.set('trust proxy', true);
  app.get('/healthz', (req, res) => {
    res.status(200).type('text/plain').send('OK');
  });
  const directPort = Number(process.env.PORT) || 3000;
  const s = app.listen(directPort, '0.0.0.0', () => {
    console.log(`Server is running on port ${directPort} (index.js direct)`);
  });
  s.keepAliveTimeout = 65_000;
  s.headersTimeout = 66_000;
  app.__eesListening = true;
}

// Mongo는 비동기 — /healthz는 DB 없이 OK
if (uri) {
  mongoose
    .connect(uri, { serverSelectionTimeoutMS: 20000 })
    .then(async () => {
      console.log('MongoDB 연결 성공');
      const db = mongoose.connection.db;
      if (db) {
        try {
          await db.createCollection('wordofday');
          console.log('wordofday 컬렉션 생성됨');
        } catch (e) {
          if (e.code !== 48 && e.codeName !== 'NamespaceExists') console.error('wordofday 컬렉션:', e.message);
        }
        try {
          await db.createCollection('onesentence');
          console.log('onesentence 컬렉션 생성됨');
        } catch (e) {
          if (e.code !== 48 && e.codeName !== 'NamespaceExists') console.error('onesentence 컬렉션:', e.message);
        }
        try {
          await db.createCollection('onesentencecomments');
          console.log('onesentencecomments 컬렉션 생성됨');
        } catch (e) {
          if (e.code !== 48 && e.codeName !== 'NamespaceExists') console.error('onesentencecomments 컬렉션:', e.message);
        }
        try {
          await db.createCollection('siteevents');
        } catch (e) {
          if (e.code !== 48 && e.codeName !== 'NamespaceExists') console.error('siteevents 컬렉션:', e.message);
        }
        try {
          const existing = await db.collection('siteevents').estimatedDocumentCount();
          if (existing === 0 && rankingApi?.backfillFromComments) {
            const n = await rankingApi.backfillFromComments({
              OneSentenceComment,
              BoardComment,
            });
            console.log('ranking backfill comments →', n);
          }
        } catch (e) {
          console.warn('ranking backfill skipped', e.message);
        }
        try {
          await db.createCollection('photoenglish');
          console.log('photoenglish 컬렉션 생성됨');
        } catch (e) {
          if (e.code !== 48 && e.codeName !== 'NamespaceExists') console.error('photoenglish 컬렉션:', e.message);
        }
        try {
          await db.createCollection('englishquotes');
          console.log('englishquotes 컬렉션 생성됨');
        } catch (e) {
          if (e.code !== 48 && e.codeName !== 'NamespaceExists') console.error('englishquotes 컬렉션:', e.message);
        }
      
        try {
          await db.createCollection('expressions');
          console.log('expressions 컬렉션 생성됨');
        } catch (e) {
          if (e.code !== 48 && e.codeName !== 'NamespaceExists') console.error('expressions 컬렉션:', e.message);
        }
}
    })
    .catch((error) => {
      console.error('MongoDB 연결 실패:', error);
    });
} else {
  console.log('MongoDB URI가 설정되지 않아 데이터베이스 연결을 건너뜁니다.');
}