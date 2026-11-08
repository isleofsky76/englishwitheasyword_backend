/**
 * /api/exam/* — 수험영어 4지선다 (읽기 전용)
 * OpenAI 없음. exam_categories / exam_words / exam_word_categories 만 사용.
 */
import mongoose from 'mongoose';
import {
  getExamCategoryModel,
  getExamWordModel,
  getExamWordCategoryModel,
} from './models/exam-schemas.js';

const CAT_SLUG_RE = /^[a-z0-9_-]{1,30}$/;

function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 40;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

function parseExclude(raw) {
  if (raw == null || raw === '') return [];
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  const ids = [];
  for (const p of parts) {
    if (mongoose.Types.ObjectId.isValid(p)) ids.push(new mongoose.Types.ObjectId(p));
  }
  return ids;
}

/**
 * 분류 내 활성 단어를 랜덤으로 뽑는다.
 * 규모가 커지면 이 함수만 id-range 방식으로 교체하면 된다.
 */
export async function pickRandomExamWords({ categoryId, limit, excludeIds }) {
  const ExamWord = getExamWordModel();
  const ExamWordCategory = getExamWordCategoryModel();

  const linkMatch = { category_id: categoryId };
  const links = await ExamWordCategory.find(linkMatch).select('word_id').lean();
  let wordIds = links.map((l) => l.word_id);
  if (excludeIds && excludeIds.length) {
    const ban = new Set(excludeIds.map(String));
    wordIds = wordIds.filter((id) => !ban.has(String(id)));
  }
  if (!wordIds.length) return [];

  const pipeline = [
    { $match: { _id: { $in: wordIds }, is_active: true } },
    { $sample: { size: Math.min(limit, wordIds.length) } },
  ];
  return ExamWord.aggregate(pipeline);
}

/** 확장용: mode에 따라 문제 형태를 바꿀 자리 (지금은 en2ko 패스스루) */
export function buildQuestion(word, pool, mode = 'en2ko') {
  void pool;
  if (mode !== 'en2ko') {
    /* 한→영, 철자, 듣기 등은 이후 추가 */
  }
  return {
    id: String(word._id || word.id),
    word: word.word,
    meaning: word.meaning,
    phonetic: word.phonetic || undefined,
    example_en: word.example_en || undefined,
    example_ko: word.example_ko || undefined,
  };
}

export function registerExamApi(app) {
  app.get('/api/exam/categories', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'db_unavailable' });
      }
      const ExamCategory = getExamCategoryModel();
      const rows = await ExamCategory.find({ is_active: true })
        .sort({ sort_order: 1 })
        .select('slug name -_id')
        .lean();
      return res.status(200).json({
        categories: rows.map((c) => ({ slug: c.slug, name: c.name })),
      });
    } catch (err) {
      console.error('[exam/categories]', err);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/exam/words', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'db_unavailable' });
      }

      const cat = String(req.query.cat || '').trim();
      if (!CAT_SLUG_RE.test(cat)) {
        return res.status(404).json({ error: 'category_not_found' });
      }

      const ExamCategory = getExamCategoryModel();
      const category = await ExamCategory.findOne({ slug: cat, is_active: true })
        .select('_id slug')
        .lean();
      if (!category) {
        return res.status(404).json({ error: 'category_not_found' });
      }

      const limit = clampLimit(req.query.limit);
      const excludeIds = parseExclude(req.query.exclude);
      const mode = String(req.query.mode || 'en2ko').trim() || 'en2ko';

      const docs = await pickRandomExamWords({
        categoryId: category._id,
        limit,
        excludeIds,
      });

      const words = docs.map((d) => buildQuestion(d, docs, mode));
      return res.status(200).json({ words });
    } catch (err) {
      console.error('[exam/words]', err);
      return res.status(500).json({ error: 'server_error' });
    }
  });
}
