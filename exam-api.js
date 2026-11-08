/**
 * /api/exam/* — 수험영어 4지선다 (읽기 전용)
 * OpenAI 없음. exam_categories / exam_words / exam_word_categories 만 사용.
 *
 * GET /api/exam/categories
 * GET /api/exam/words?cat=elem|middle|high|all&limit=10&page=1&order=seq|random&mode=en2ko
 */
import mongoose from 'mongoose';
import {
  getExamCategoryModel,
  getExamWordModel,
  getExamWordCategoryModel,
} from './models/exam-schemas.js';

const CAT_SLUG_RE = /^[a-z0-9_-]{1,30}$/;
/** 가상 분류: 활성 분류 전체 혼합 (탭「랜덤」) */
const MIX_SLUG = 'all';

function clampLimit(raw, fallback = 10) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

function clampPage(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
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

function parseOrder(raw) {
  const s = String(raw || 'random').trim().toLowerCase();
  return s === 'seq' || s === 'sequential' || s === 'order' ? 'seq' : 'random';
}

async function resolveCategoryIds(cat) {
  const ExamCategory = getExamCategoryModel();
  if (cat === MIX_SLUG) {
    const rows = await ExamCategory.find({ is_active: true }).select('_id').lean();
    return rows.map((r) => r._id);
  }
  if (!CAT_SLUG_RE.test(cat)) return null;
  const one = await ExamCategory.findOne({ slug: cat, is_active: true })
    .select('_id')
    .lean();
  return one ? [one._id] : null;
}

async function activeWordIdsForCategories(categoryIds, excludeIds) {
  const ExamWordCategory = getExamWordCategoryModel();
  const links = await ExamWordCategory.find({
    category_id: { $in: categoryIds },
  })
    .select('word_id')
    .lean();
  let wordIds = [...new Set(links.map((l) => String(l.word_id)))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  if (excludeIds && excludeIds.length) {
    const ban = new Set(excludeIds.map(String));
    wordIds = wordIds.filter((id) => !ban.has(String(id)));
  }
  return wordIds;
}

/**
 * 랜덤 샘플. 규모가 커지면 id-range 방식으로 교체 가능.
 */
export async function pickRandomExamWords({ categoryIds, limit, excludeIds }) {
  const ExamWord = getExamWordModel();
  const wordIds = await activeWordIdsForCategories(categoryIds, excludeIds);
  if (!wordIds.length) return { docs: [], total: 0 };
  const total = await ExamWord.countDocuments({
    _id: { $in: wordIds },
    is_active: true,
  });
  const docs = await ExamWord.aggregate([
    { $match: { _id: { $in: wordIds }, is_active: true } },
    { $sample: { size: Math.min(limit, total || limit) } },
  ]);
  return { docs, total };
}

/** 사전순(단어) 페이지네이션 */
export async function pickSequentialExamWords({
  categoryIds,
  limit,
  page,
  excludeIds,
}) {
  const ExamWord = getExamWordModel();
  const wordIds = await activeWordIdsForCategories(categoryIds, excludeIds);
  if (!wordIds.length) return { docs: [], total: 0, page: 1, pages: 0 };
  const filter = { _id: { $in: wordIds }, is_active: true };
  const total = await ExamWord.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), pages);
  const skip = (safePage - 1) * limit;
  const docs = await ExamWord.find(filter)
    .sort({ word: 1, _id: 1 })
    .skip(skip)
    .limit(limit)
    .lean();
  return { docs, total, page: safePage, pages };
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

/** 표시명에서 불필요한 '영어' 접미 정리 (확장 분류도 짧게) */
function displayName(name) {
  return String(name || '')
    .replace(/영어\s*$/u, '')
    .trim() || name;
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
      const categories = rows.map((c) => ({
        slug: c.slug,
        name: displayName(c.name),
      }));
      /* 혼합 탭은 DB 행이 아니라 API가 붙여 줌 — 공무원 등 추가 시에도 유지 */
      categories.push({ slug: MIX_SLUG, name: '랜덤' });
      return res.status(200).json({ categories });
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
      if (cat !== MIX_SLUG && !CAT_SLUG_RE.test(cat)) {
        return res.status(404).json({ error: 'category_not_found' });
      }

      const categoryIds = await resolveCategoryIds(cat);
      if (!categoryIds || !categoryIds.length) {
        return res.status(404).json({ error: 'category_not_found' });
      }

      const limit = clampLimit(req.query.limit, 10);
      const page = clampPage(req.query.page);
      const excludeIds = parseExclude(req.query.exclude);
      const order = parseOrder(req.query.order);
      const mode = String(req.query.mode || 'en2ko').trim() || 'en2ko';

      let docs;
      let total;
      let safePage = page;
      let pages = 1;

      if (order === 'seq') {
        const result = await pickSequentialExamWords({
          categoryIds,
          limit,
          page,
          excludeIds,
        });
        docs = result.docs;
        total = result.total;
        safePage = result.page;
        pages = result.pages || 1;
      } else {
        /* 랜덤: 매 요청 새 10문항. 점수는 페이지(세트) 단위 100점 */
        const result = await pickRandomExamWords({
          categoryIds,
          limit,
          excludeIds,
        });
        docs = result.docs;
        total = result.total;
        pages = Math.max(1, Math.ceil((total || 0) / limit));
        safePage = Math.min(page, pages);
      }

      const words = docs.map((d) => buildQuestion(d, docs, mode));
      return res.status(200).json({
        words,
        total,
        page: safePage,
        pageSize: limit,
        pages,
        order,
        cat,
      });
    } catch (err) {
      console.error('[exam/words]', err);
      return res.status(500).json({ error: 'server_error' });
    }
  });
}
