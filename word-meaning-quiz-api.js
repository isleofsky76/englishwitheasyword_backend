/**
 * /api/word-meaning-quiz/* — 영어 단어 → 한국어 뜻 4지선다
 * OpenAI 호출 없음. word_quiz_info 만 사용.
 */
import crypto from 'crypto';
import {
  getWordQuizInfoModel,
  getWordMeaningQuizSessionModel,
  LEVELS,
} from './models/word-quiz-schemas.js';

const DEFAULT_COUNT = () =>
  Math.max(1, Math.min(30, Number(process.env.QUIZ_QUESTION_COUNT) || 10));
const LEVEL_MIN = () =>
  Math.max(1, Number(process.env.QUIZ_LEVEL_MIN_WORDS) || 20);
const ONLY_CHECKED = () =>
  String(process.env.QUIZ_ONLY_CHECKED || 'false').toLowerCase() === 'true';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function splitSenses(meaning) {
  return String(meaning || '')
    .split(/[,，、/;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sensesOverlap(a, b) {
  const sa = new Set(splitSenses(a).map((x) => x.replace(/\s+/g, '')));
  const sb = splitSenses(b).map((x) => x.replace(/\s+/g, ''));
  return sb.some((x) => sa.has(x));
}

function baseCandidateFilter() {
  const q = {
    enabled: true,
    quiz_meaning: { $nin: [null, ''] },
    pos: { $exists: true, $ne: '' },
  };
  if (ONLY_CHECKED()) q.meaning_checked = true;
  return q;
}

async function countByLevel() {
  const WordQuizInfo = getWordQuizInfoModel();
  const base = baseCandidateFilter();
  const all = await WordQuizInfo.countDocuments(base);
  const levels = {};
  for (const lv of LEVELS) {
    levels[lv] = await WordQuizInfo.countDocuments({ ...base, level: lv });
  }
  return { all, levels, min: LEVEL_MIN() };
}

function normalizeLevel(raw) {
  const s = String(raw || 'all').trim().toLowerCase();
  if (s === 'all' || s === '전체' || !s) return 'all';
  if (LEVELS.includes(s)) return s;
  const map = {
    beginner: 'beginner',
    intermediate: 'intermediate',
    advanced: 'advanced',
    초급: 'beginner',
    중급: 'intermediate',
    고급: 'advanced',
  };
  return map[s] || 'all';
}

async function pickRandomDocs(filter, size, excludeIds = []) {
  const WordQuizInfo = getWordQuizInfoModel();
  const match = { ...filter };
  if (excludeIds.length) {
    match._id = { $nin: excludeIds };
  }
  const pipeline = [{ $match: match }, { $sample: { size } }];
  return WordQuizInfo.aggregate(pipeline);
}

function buildDistractors(correct, pool) {
  const correctMeaning = String(correct.quiz_meaning || '').trim();
  const correctGroup = String(correct.meaning_group || '').trim();
  const usedTexts = new Set([correctMeaning.replace(/\s+/g, '')]);

  const samePos = [];
  const otherPos = [];
  for (const d of pool) {
    if (String(d._id) === String(correct._id)) continue;
    const meaning = String(d.quiz_meaning || '').trim();
    if (!meaning) continue;
    const key = meaning.replace(/\s+/g, '');
    if (usedTexts.has(key)) continue;
    if (correctGroup && d.meaning_group && String(d.meaning_group) === correctGroup) continue;
    if (meaning === correctMeaning) continue;
    if (sensesOverlap(correctMeaning, meaning)) continue;

    const row = { meaning, pos: d.pos, level: d.level };
    if (d.pos === correct.pos) samePos.push(row);
    else otherPos.push(row);
  }

  const preferSameLevel = (list) => {
    const sameLv = list.filter((x) => correct.level && x.level === correct.level);
    return shuffle(sameLv.length ? sameLv.concat(list) : list);
  };

  const picks = [];
  for (const row of preferSameLevel(samePos)) {
    if (picks.length >= 3) break;
    const key = row.meaning.replace(/\s+/g, '');
    if (usedTexts.has(key)) continue;
    usedTexts.add(key);
    picks.push(row.meaning);
  }
  for (const row of preferSameLevel(otherPos)) {
    if (picks.length >= 3) break;
    const key = row.meaning.replace(/\s+/g, '');
    if (usedTexts.has(key)) continue;
    usedTexts.add(key);
    picks.push(row.meaning);
  }
  return picks;
}

function publicQuestions(session) {
  return (session.questions || []).map((q) => ({
    index: q.index,
    word: q.word,
    posSource: q.posSource || '',
    example: q.example || '',
    exampleKo: q.exampleKo || '',
    options: (q.options || []).map((o) => ({ key: o.key, text: o.text })),
    answered: Boolean(q.answered),
    /* 답한 뒤에만 결과 필드 */
    ...(q.answered
      ? {
          correct: q.correct,
          correctKey: q.correctKey,
          correctMeaning: q.correctMeaning,
          contentUrl: q.contentUrl || null,
          chosenKey: q.chosenKey,
        }
      : {}),
  }));
}

export function registerWordMeaningQuizApi(app) {
  app.get('/api/word-meaning-quiz/meta', async (req, res) => {
    try {
      const counts = await countByLevel();
      const min = counts.min;
      res.json({
        questionCount: DEFAULT_COUNT(),
        defaultLevel: 'all',
        levels: [
          {
            id: 'all',
            label: '전체',
            available: counts.all >= DEFAULT_COUNT(),
            count: counts.all,
            readyLabel: counts.all >= DEFAULT_COUNT() ? null : '준비 중',
          },
          ...LEVELS.map((id) => {
            const label =
              id === 'beginner' ? '초급' : id === 'intermediate' ? '중급' : '고급';
            const count = counts.levels[id] || 0;
            const available = count >= min;
            return {
              id,
              label,
              available,
              count,
              readyLabel: available ? null : '준비 중',
            };
          }),
        ],
      });
    } catch (err) {
      console.error('[word-meaning-quiz/meta]', err);
      res.status(500).json({ error: '메타 정보를 불러오지 못했습니다.' });
    }
  });

  app.post('/api/word-meaning-quiz/start', async (req, res) => {
    try {
      const level = normalizeLevel(req.body?.level);
      const count = DEFAULT_COUNT();
      const excludeRaw = Array.isArray(req.body?.excludeSessionWords)
        ? req.body.excludeSessionWords
        : [];
      const WordQuizInfo = getWordQuizInfoModel();
      const Session = getWordMeaningQuizSessionModel();

      const filter = baseCandidateFilter();
      if (level !== 'all') filter.level = level;

      const available = await WordQuizInfo.countDocuments(filter);
      if (available < count) {
        return res.status(422).json({
          error: '아직 문제를 만들 단어가 부족해요',
          available,
          need: count,
          level,
        });
      }

      /* 정답 후보: 여유분 샘플 후 중복 제거 */
      let poolSize = Math.min(available, Math.max(count * 8, 80));
      let pool = await pickRandomDocs(filter, poolSize);
      if (pool.length < count) {
        pool = await WordQuizInfo.find(filter).limit(count * 3).lean();
        pool = shuffle(pool);
      }

      const excludeSet = new Set(excludeRaw.map(String));
      const chosen = [];
      const seenWords = new Set();
      for (const doc of shuffle(pool)) {
        if (chosen.length >= count) break;
        const w = String(doc.word || '').toLowerCase();
        if (seenWords.has(w)) continue;
        if (excludeSet.has(String(doc._id)) && pool.length - chosen.length > count) continue;
        seenWords.add(w);
        chosen.push(doc);
      }
      if (chosen.length < count) {
        return res.status(422).json({
          error: '아직 문제를 만들 단어가 부족해요',
          available: chosen.length,
          need: count,
        });
      }

      /* 오답용 풀: 같은 필터에서 더 크게 */
      const distractorPool = await pickRandomDocs(filter, Math.min(available, 400));

      const questions = [];
      for (let i = 0; i < chosen.length; i += 1) {
        const correct = chosen[i];
        const distractors = buildDistractors(correct, distractorPool);
        if (distractors.length < 3) {
          return res.status(422).json({
            error: '아직 문제를 만들 단어가 부족해요',
            detail: '오답 후보 부족',
            word: correct.word,
          });
        }
        const correctKey = crypto.randomBytes(4).toString('hex');
        const optionRows = shuffle([
          { key: correctKey, text: String(correct.quiz_meaning).trim() },
          ...distractors.slice(0, 3).map((text) => ({
            key: crypto.randomBytes(4).toString('hex'),
            text,
          })),
        ]);
        questions.push({
          index: i,
          wordQuizInfoId: correct._id,
          word: correct.word,
          posSource: String(correct.pos_source || '').trim(),
          example: String(correct.example || '').trim(),
          exampleKo: String(correct.example_ko || '').trim(),
          options: optionRows,
          correctKey,
          correctMeaning: String(correct.quiz_meaning).trim(),
          contentUrl: correct.content_url || null,
          answered: false,
          chosenKey: null,
          correct: null,
        });
      }

      const sessionId = crypto.randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await Session.create({
        sessionId,
        level,
        questionCount: count,
        questions,
        excludeWordIds: chosen.map((c) => c._id),
        expiresAt,
      });

      res.status(201).json({
        sessionId,
        total: count,
        level,
        questions: publicQuestions({ questions }),
      });
    } catch (err) {
      console.error('[word-meaning-quiz/start]', err);
      res.status(500).json({ error: '퀴즈를 시작하지 못했습니다.' });
    }
  });

  app.post('/api/word-meaning-quiz/answer', async (req, res) => {
    try {
      const sessionId = String(req.body?.sessionId || '').trim();
      const index = Number(req.body?.index);
      const key = String(req.body?.key || '').trim();
      if (!sessionId || !Number.isInteger(index) || !key) {
        return res.status(400).json({ error: 'sessionId, index, key 가 필요합니다.' });
      }
      const Session = getWordMeaningQuizSessionModel();
      const session = await Session.findOne({ sessionId });
      if (!session || session.expiresAt < new Date()) {
        return res.status(404).json({ error: '세션이 없거나 만료되었습니다.' });
      }
      const q = session.questions.find((x) => x.index === index);
      if (!q) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
      if (q.answered) {
        return res.status(409).json({ error: '이미 답한 문제입니다.' });
      }
      const optionKeys = new Set((q.options || []).map((o) => o.key));
      if (!optionKeys.has(key)) {
        return res.status(400).json({ error: '잘못된 보기입니다.' });
      }
      q.answered = true;
      q.chosenKey = key;
      q.correct = key === q.correctKey;
      await session.save();

      const chosenOpt = (q.options || []).find((o) => o.key === key);
      res.json({
        correct: q.correct,
        correctKey: q.correctKey,
        correctMeaning: q.correctMeaning,
        contentUrl: q.contentUrl || null,
        myMeaning: chosenOpt ? chosenOpt.text : null,
      });
    } catch (err) {
      console.error('[word-meaning-quiz/answer]', err);
      res.status(500).json({ error: '채점에 실패했습니다.' });
    }
  });

  app.get('/api/word-meaning-quiz/result', async (req, res) => {
    try {
      const sessionId = String(req.query?.sessionId || '').trim();
      if (!sessionId) return res.status(400).json({ error: 'sessionId 가 필요합니다.' });
      const Session = getWordMeaningQuizSessionModel();
      const session = await Session.findOne({ sessionId }).lean();
      if (!session) return res.status(404).json({ error: '세션이 없습니다.' });

      const items = (session.questions || []).map((q) => {
        const mine = (q.options || []).find((o) => o.key === q.chosenKey);
        return {
          index: q.index,
          word: q.word,
          correctMeaning: q.correctMeaning,
          myMeaning: mine ? mine.text : null,
          correct: Boolean(q.correct),
          contentUrl: q.answered ? q.contentUrl || null : null,
        };
      });
      const answered = items.filter((x) => x.myMeaning != null);
      const correctCount = answered.filter((x) => x.correct).length;
      const total = session.questionCount || items.length;
      res.json({
        total,
        correctCount,
        rate: total ? Math.round((correctCount / total) * 100) : 0,
        level: session.level,
        items,
      });
    } catch (err) {
      console.error('[word-meaning-quiz/result]', err);
      res.status(500).json({ error: '결과를 불러오지 못했습니다.' });
    }
  });

  app.get('/api/word-meaning-quiz/session/:sessionId', async (req, res) => {
    try {
      const sessionId = String(req.params.sessionId || '').trim();
      const Session = getWordMeaningQuizSessionModel();
      const session = await Session.findOne({ sessionId }).lean();
      if (!session || new Date(session.expiresAt) < new Date()) {
        return res.status(404).json({ error: '세션이 없거나 만료되었습니다.' });
      }
      const nextIndex = (session.questions || []).findIndex((q) => !q.answered);
      res.json({
        sessionId: session.sessionId,
        total: session.questionCount,
        level: session.level,
        nextIndex: nextIndex < 0 ? session.questionCount : nextIndex,
        done: nextIndex < 0,
        questions: publicQuestions(session),
      });
    } catch (err) {
      console.error('[word-meaning-quiz/session]', err);
      res.status(500).json({ error: '세션을 불러오지 못했습니다.' });
    }
  });
}
