import OpenAI from 'openai';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import bcrypt from 'bcrypt';

async function safeBcryptCompare(plain, hash) {
  if (plain == null || typeof plain !== 'string' || hash == null || typeof hash !== 'string') return false;
  return bcrypt.compare(plain, hash);
}
import RSS from 'rss'; // RSS 모듈 추가
import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs';
import { promisify } from 'util';
import session from 'express-session';

// .env 파일의 환경 변수를 로드합니다.
dotenv.config();

// Initialize the Express app 로컬용.
const app = express();

// Trust proxy 설정 (IP 주소를 올바르게 가져오기 위해)
app.set('trust proxy', true);

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
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  credentials: false,
  optionsSuccessStatus: 200
}));

// Body parser 설정 (이미지 업로드를 위한 크기 제한 증가)
app.use(express.json({ limit: '10mb' })); // JSON 본문 크기 제한: 10MB
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // URL 인코딩 본문 크기 제한: 10MB

// Session middleware for conversation history
app.use(session({
  secret: 'your-secret-key-here',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// 정적 파일 제공 경로 설정
app.use(express.static('public'));

// Google Cloud Text-to-Speech 클라이언트 초기화
let client = null;

try {
  // JSON 파일에서 직접 인증 정보 로드
  const credentials = JSON.parse(fs.readFileSync('./youtubespeech-430112-5a2ce6dffa5c.json', 'utf8'));
  client = new textToSpeech.TextToSpeechClient({
    credentials: credentials
  });
  console.log("✅ Google Cloud TTS client initialized successfully");
} catch (error) {
  console.log("⚠️ Google Cloud credentials not found, using fallback TTS");
  console.error("Error loading credentials:", error.message);
}

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
    'en-US-Chirp3-HD-Zubenelgenubi': ['en-US-Chirp-HD-D'], // 미국 영어 Chirp-HD-D 음성 (Chirp3-HD-Zubenelgenubi 대체)
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

  // AI 발음: 한국어·영어 모두 에이아이(글자 A I)로 읽기 — OpenAI 등 단어 안 AI는 \b 경계로 제외
  let textForInput = String(text || '');
  const hasAI = /\bAI\b/i.test(textForInput);

  if (hasAI) {
    if (actualLanguageCode === 'ko-KR' || (language && /^ko/i.test(language))) {
      textForInput = textForInput.replace(/\bAI\b/gi, '에이아이');
    } else {
      textForInput = textForInput.replace(/\bAI\b/gi, 'A I');
    }
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
    audioConfig: { audioEncoding: 'MP3', speakingRate: speakingRate, pitch: 0.0 }
  };

  try {
    if (!client) {
      console.log('⚠️ Google Cloud TTS not available, returning error');
      return res.status(503).json({ error: 'Text-to-Speech service not available. Please configure Google Cloud credentials.' });
    }

    const [response] = await client.synthesizeSpeech(request);

    console.log('🟢 Audio response received successfully!');

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

// HTTP 서버는 먼저 listen — K8s/Cloudtype readiness probe(/healthz)가 Mongo보다 먼저 와도 응답 가능
function startServer() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Endpoints:');
    console.log(`- English Study: http://localhost:${PORT}/englishstudy`);
    console.log(`- Business Advice: http://localhost:${PORT}/business-advice`);
    console.log(`- English Chat: http://localhost:${PORT}/english-chat`);
    console.log(`- Health Check: http://localhost:${PORT}/healthz`);
    console.log(`- Root: http://localhost:${PORT}/`);
    console.log(`- Speaking Practice: http://localhost:${PORT}/speaking-practice`);
    console.log(`- Speaking Practice2: http://localhost:${PORT}/speaking-practice2`);
    console.log(`- Quiz: http://localhost:${PORT}/quiz`);
    console.log(`- Quiz Check: http://localhost:${PORT}/quiz/check`);
    console.log(`- Show Answer: http://localhost:${PORT}/quiz/show`);
    console.log(`- Get Hint: http://localhost:${PORT}/get-hint`);
    console.log(`- Get Random Item: http://localhost:${PORT}/get-random-item`);
    console.log(`- Generate Sentences: http://localhost:${PORT}/generate-sentences`);
    console.log(`- Generate Short Text: http://localhost:${PORT}/generate-short-text`);
    console.log(`- Get Translation and Explanation: http://localhost:${PORT}/get-translation-explanation`);
    console.log(`- Get Translation and Explanation: http://localhost:${PORT}/get-synonyms`);
    console.log(`- Get Translation and Explanation: http://localhost:${PORT}/ask-question`);
    console.log(`- Get Translation and Explanation: http://localhost:${PORT}/get-fortune`);
    console.log(`- Generate Sentences: http://localhost:${PORT}/generate-sentences-routines`);
    console.log(`- Weather: http://localhost:${PORT}/weather`);
    console.log(`- Guestbook: http://localhost:${PORT}/guestbook`);
    console.log(`- Vocabulary (Synonym): http://localhost:${PORT}/vocabulary`);
    console.log(`- Easy Voca: http://localhost:${PORT}/easy-voca`);
    console.log(`- Pros & Cons: http://localhost:${PORT}/pros-cons`);
    console.log(`- Photo English: http://localhost:${PORT}/photo-english`);
    console.log(`- Ranking News: http://localhost:${PORT}/ranking-news`);
    console.log(`- Cooking Voca: http://localhost:${PORT}/cooking-voca`);
    console.log(`- Culture Voca: http://localhost:${PORT}/culture-voca`);
    console.log(`- Ads.txt: http://localhost:${PORT}/ads.txt`);
    console.log(`- Generate Audio: http://localhost:${PORT}/generate-audio`);
  });
}

// mydatabase 아래 컬렉션 3개: newsvoca, synonyms, popularvoca

// News Voca (page30_guestbook.html) → 컬렉션 newsvoca
const guestbookEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
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
  isSecret: { type: Boolean, default: false }
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
  isSecret: { type: Boolean, default: false }
}, { collection: 'popularvoca' });

const EasyVocaEntry = mongoose.model('EasyVocaEntry', easyVocaEntrySchema);

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
  isSecret: { type: Boolean, default: false }
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
  isSecret: { type: Boolean, default: false }
}, { collection: 'wordofday' });

const WordOfDayEntry = mongoose.model('WordOfDayEntry', wordOfDayEntrySchema);

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
  isSecret: { type: Boolean, default: false }
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
  isSecret: { type: Boolean, default: false }
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
  isSecret: { type: Boolean, default: false }
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
  isSecret: { type: Boolean, default: false }
}, { collection: 'culturevoca' });

const CultureVocaEntry = mongoose.model('CultureVocaEntry', cultureVocaEntrySchema);

app.set('view engine', 'ejs');
app.set('views', './views');


// 루트 경로 엔드포인트 추가
app.get('/', (req, res) => {
  res.send('Welcome to the English With Easy Word Backend!');
});

// 헬스 체크 엔드포인트 추가
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
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

app.get('/', (req, res) => {
  res.send('Welcome to the English With Easy Word Backend!');
});

app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

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
    const entries = await GuestbookEntry.find();
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

app.post('/guestbook', async (req, res) => {
  const { title, message, nickname, password, isSecret } = req.body;

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
    isSecret: isSecret || false
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving guestbook entry' });
  }
});

// 조회수 증가 엔드포인트 (동일 IP 체크 포함)
const viewTracker = new Map(); // IP와 게시글 ID를 추적하는 맵

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

app.post('/guestbook/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    
    // 동일 IP에서 같은 게시글을 1시간 내에 조회한 경우 조회수 증가하지 않음
    const viewKey = `${clientIp}_${id}`;
    const lastViewTime = viewTracker.get(viewKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000; // 1시간 (밀리초)
    
    if (lastViewTime && (now - lastViewTime) < oneHour) {
      // 1시간 내에 이미 조회한 경우 조회수 증가하지 않음
      const entry = await GuestbookEntry.findById(id);
      if (!entry) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.json({
        entry,
        views: entry.views,
        message: '조회수가 증가하지 않았습니다 (동일 IP, 1시간 내 중복 조회)'
      });
    }
    
    // 조회수 증가
    const entry = await GuestbookEntry.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true }
    );
    
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // 조회 기록 저장 (1시간 후 자동 삭제)
    viewTracker.set(viewKey, now);
    setTimeout(() => {
      viewTracker.delete(viewKey);
    }, oneHour);
    
    res.json({ entry, views: entry.views });
  } catch (error) {
    console.error('조회수 증가 오류:', error);
    res.status(500).json({ error: 'Error incrementing view count' });
  }
});

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
const adminPassword = process.env.ADMIN_PASSWORD;

app.post('/admin/deletepost', async (req, res) => {
  const { id, adminPasswordInput } = req.body;

  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }

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
    const { id, password, title, message, nickname, isSecret } = req.body;
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

app.post('/wordofday', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new WordOfDayEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Word of Day save 오류:', error);
    res.status(500).json({ error: 'Error saving word of day entry', detail: error.message });
  }
});

app.post('/wordofday/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const viewKey = `wod_${clientIp}_${id}`;
    const lastViewTime = viewTracker.get(viewKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    if (lastViewTime && (now - lastViewTime) < oneHour) {
      const entry = await WordOfDayEntry.findById(id);
      if (!entry) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.json({
        entry,
        views: entry.views,
        message: '조회수가 증가하지 않았습니다.'
      });
    }
    const entry = await WordOfDayEntry.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true });
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    viewTracker.set(viewKey, now);
    setTimeout(() => viewTracker.delete(viewKey), oneHour);
    res.json({ entry, views: entry.views });
  } catch (error) {
    console.error('Word of day view 오류:', error);
    res.status(500).json({ error: 'Error incrementing view count' });
  }
});

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
    const { id, password, title, message, nickname, isSecret } = req.body;
    const entry = await WordOfDayEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
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
  const { id, adminPasswordInput } = req.body;
  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }
  try {
    const entry = await WordOfDayEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await WordOfDayEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
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

app.post('/photo-english', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new PhotoEnglishEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Photo English save 오류:', error);
    res.status(500).json({ error: 'Error saving photo english entry', detail: error.message });
  }
});

app.post('/photo-english/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const viewKey = `pe_${clientIp}_${id}`;
    const lastViewTime = viewTracker.get(viewKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    if (lastViewTime && (now - lastViewTime) < oneHour) {
      const entry = await PhotoEnglishEntry.findById(id);
      if (!entry) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.json({
        entry,
        views: entry.views,
        message: '조회수가 증가하지 않았습니다.'
      });
    }
    const entry = await PhotoEnglishEntry.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true });
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    viewTracker.set(viewKey, now);
    setTimeout(() => viewTracker.delete(viewKey), oneHour);
    res.json({ entry, views: entry.views });
  } catch (error) {
    console.error('Photo English view 오류:', error);
    res.status(500).json({ error: 'Error incrementing view count' });
  }
});

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
    const { id, password, title, message, nickname, isSecret } = req.body;
    const entry = await PhotoEnglishEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
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
  const { id, adminPasswordInput } = req.body;
  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }
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

app.post('/ranking-news', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new RankingNewsEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Ranking News save 오류:', error);
    res.status(500).json({ error: 'Error saving ranking news entry', detail: error.message });
  }
});

app.post('/ranking-news/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const viewKey = `rn_${clientIp}_${id}`;
    const lastViewTime = viewTracker.get(viewKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    if (lastViewTime && (now - lastViewTime) < oneHour) {
      const entry = await RankingNewsEntry.findById(id);
      if (!entry) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.json({
        entry,
        views: entry.views,
        message: '조회수가 증가하지 않았습니다.'
      });
    }
    const entry = await RankingNewsEntry.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true });
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    viewTracker.set(viewKey, now);
    setTimeout(() => viewTracker.delete(viewKey), oneHour);
    res.json({ entry, views: entry.views });
  } catch (error) {
    console.error('Ranking News view 오류:', error);
    res.status(500).json({ error: 'Error incrementing view count' });
  }
});

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
    const { id, password, title, message, nickname, isSecret } = req.body;
    const entry = await RankingNewsEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
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
  const { id, adminPasswordInput } = req.body;
  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }
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

app.post('/cooking-voca', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new CookingVocaEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Cooking Voca save 오류:', error);
    res.status(500).json({ error: 'Error saving cooking voca entry', detail: error.message });
  }
});

app.post('/cooking-voca/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const viewKey = `cv_${clientIp}_${id}`;
    const lastViewTime = viewTracker.get(viewKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    if (lastViewTime && (now - lastViewTime) < oneHour) {
      const entry = await CookingVocaEntry.findById(id);
      if (!entry) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.json({
        entry,
        views: entry.views,
        message: '조회수가 증가하지 않았습니다.'
      });
    }
    const entry = await CookingVocaEntry.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true });
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    viewTracker.set(viewKey, now);
    setTimeout(() => viewTracker.delete(viewKey), oneHour);
    res.json({ entry, views: entry.views });
  } catch (error) {
    console.error('Cooking Voca view 오류:', error);
    res.status(500).json({ error: 'Error incrementing view count' });
  }
});

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
    const { id, password, title, message, nickname, isSecret } = req.body;
    const entry = await CookingVocaEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
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
  const { id, adminPasswordInput } = req.body;
  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }
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

app.post('/culture-voca', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다. MongoDB가 실행 중인지 확인하세요.', detail: 'MongoDB connection not ready' });
  }
  const { title, message, nickname, password, isSecret } = req.body;
  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new CultureVocaEntry({
    title, message, nickname, password: hashedPassword, isSecret: isSecret || false
  });
  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    console.error('Culture Voca save 오류:', error);
    res.status(500).json({ error: 'Error saving culture voca entry', detail: error.message });
  }
});

app.post('/culture-voca/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const viewKey = `clv_${clientIp}_${id}`;
    const lastViewTime = viewTracker.get(viewKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    if (lastViewTime && (now - lastViewTime) < oneHour) {
      const entry = await CultureVocaEntry.findById(id);
      if (!entry) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.json({
        entry,
        views: entry.views,
        message: '조회수가 증가하지 않았습니다.'
      });
    }
    const entry = await CultureVocaEntry.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true });
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    viewTracker.set(viewKey, now);
    setTimeout(() => viewTracker.delete(viewKey), oneHour);
    res.json({ entry, views: entry.views });
  } catch (error) {
    console.error('Culture Voca view 오류:', error);
    res.status(500).json({ error: 'Error incrementing view count' });
  }
});

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
    const { id, password, title, message, nickname, isSecret } = req.body;
    const entry = await CultureVocaEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    const isMatch = await safeBcryptCompare(password, entry.password);
    if (!isMatch) return res.status(403).json({ error: 'Invalid password' });
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
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
  const { id, adminPasswordInput } = req.body;
  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }
  try {
    const entry = await CultureVocaEntry.findById(id);
    if (!entry) return res.status(404).json({ error: 'Post not found' });
    await CultureVocaEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
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
app.post('/vocabulary', async (req, res) => {
  const { title, message, nickname, password, isSecret } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new VocabularyEntry({ 
    title, 
    message, 
    nickname, 
    password: hashedPassword,
    isSecret: isSecret || false
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving vocabulary entry' });
  }
});

// Vocabulary 조회수 증가 엔드포인트
const vocabularyViewTracker = new Map();

app.post('/vocabulary/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    
    const viewKey = `${clientIp}_${id}`;
    const lastViewTime = vocabularyViewTracker.get(viewKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    if (lastViewTime && (now - lastViewTime) < oneHour) {
      const entry = await VocabularyEntry.findById(id);
      if (!entry) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.json({
        entry,
        views: entry.views,
        message: '조회수가 증가하지 않았습니다 (동일 IP, 1시간 내 중복 조회)'
      });
    }

    const entry = await VocabularyEntry.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true }
    );
    
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    vocabularyViewTracker.set(viewKey, now);
    setTimeout(() => {
      vocabularyViewTracker.delete(viewKey);
    }, oneHour);
    
    res.json({ entry, views: entry.views });
  } catch (error) {
    console.error('조회수 증가 오류:', error);
    res.status(500).json({ error: 'Error incrementing view count' });
  }
});

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
  const { id, adminPasswordInput } = req.body;

  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }

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
    const { id, password, title, message, nickname, isSecret } = req.body;
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

app.post('/easy-voca', async (req, res) => {
  const { title, message, nickname, password, isSecret } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new EasyVocaEntry({
    title,
    message,
    nickname,
    password: hashedPassword,
    isSecret: isSecret || false
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving easy voca entry' });
  }
});

const easyVocaViewTracker = new Map();

app.post('/easy-voca/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const viewKey = `${clientIp}_${id}`;
    const lastViewTime = easyVocaViewTracker.get(viewKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    if (lastViewTime && (now - lastViewTime) < oneHour) {
      const entry = await EasyVocaEntry.findById(id);
      if (!entry) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.json({
        entry,
        views: entry.views,
        message: '조회수가 증가하지 않았습니다 (동일 IP, 1시간 내 중복 조회)'
      });
    }

    const entry = await EasyVocaEntry.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }

    easyVocaViewTracker.set(viewKey, now);
    setTimeout(() => {
      easyVocaViewTracker.delete(viewKey);
    }, oneHour);

    res.json({ entry, views: entry.views });
  } catch (error) {
    console.error('Easy Voca 조회수 증가 오류:', error);
    res.status(500).json({ error: 'Error incrementing view count' });
  }
});

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
  const { id, adminPasswordInput } = req.body;

  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }

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
    const { id, password, title, message, nickname, isSecret } = req.body;
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

app.post('/pros-cons', async (req, res) => {
  const { title, message, nickname, password, isSecret } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new ProsConsEntry({
    title,
    message,
    nickname,
    password: hashedPassword,
    isSecret: isSecret || false
  });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving pros & cons entry' });
  }
});

const prosConsViewTracker = new Map();

app.post('/pros-cons/:id/view', async (req, res) => {
  try {
    const { id } = req.params;
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    const viewKey = `${clientIp}_${id}`;
    const lastViewTime = prosConsViewTracker.get(viewKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    if (lastViewTime && (now - lastViewTime) < oneHour) {
      const entry = await ProsConsEntry.findById(id);
      if (!entry) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.json({
        entry,
        views: entry.views,
        message: '조회수가 증가하지 않았습니다 (동일 IP, 1시간 내 중복 조회)'
      });
    }

    const entry = await ProsConsEntry.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }

    prosConsViewTracker.set(viewKey, now);
    setTimeout(() => {
      prosConsViewTracker.delete(viewKey);
    }, oneHour);

    res.json({ entry, views: entry.views });
  } catch (error) {
    console.error('Pros & Cons 조회수 증가 오류:', error);
    res.status(500).json({ error: 'Error incrementing view count' });
  }
});

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
  const { id, adminPasswordInput } = req.body;

  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }

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
    const { id, password, title, message, nickname, isSecret } = req.body;
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

// 모든 라우트·미들웨어 등록 후 listen (이전에 listen이 먼저면 /healthz 미등록 → readiness probe EOF)
// Mongo 연결은 비동기로 진행 — 프로브는 DB 없이도 OK 응답 가능
startServer();

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
          await db.createCollection('photoenglish');
          console.log('photoenglish 컬렉션 생성됨');
        } catch (e) {
          if (e.code !== 48 && e.codeName !== 'NamespaceExists') console.error('photoenglish 컬렉션:', e.message);
        }
      }
    })
    .catch((error) => {
      console.error('MongoDB 연결 실패:', error);
    });
} else {
  console.log('MongoDB URI가 설정되지 않아 데이터베이스 연결을 건너뜁니다.');
}