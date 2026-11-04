/**
 * 생활 영어 한 줄 (expressions) — 공개 조회 + 관리자 CSV/JSON
 * index.js 에서 registerExpressionsApi(app, deps) 로 연결
 */
import mongoose from 'mongoose';

const MAX_UPLOAD_CHARS = 2_000_000;
const MAX_ROWS = 5000;
const ALLOWED_STATUS = new Set(['draft', 'published']);

export function registerExpressionsApi(app, deps) {
  const { requireAdmin } = deps;

  const expressionSchema = new mongoose.Schema(
    {
      id: { type: String, required: true, unique: true, trim: true },
      ko: { type: String, required: true, trim: true },
      en: { type: String, required: true, trim: true },
      example: { type: String, default: '' },
      translation: { type: String, default: '' },
      category: { type: String, default: '일상 표현' },
      tags: { type: [String], default: [] },
      level: { type: String, default: 'B1' },
      status: { type: String, default: 'published', enum: ['draft', 'published'] },
    },
    { collection: 'expressions', timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } }
  );
  expressionSchema.index({ status: 1, id: 1 });
  expressionSchema.index({
    ko: 'text',
    en: 'text',
    example: 'text',
    translation: 'text',
    tags: 'text',
  });

  const Expression =
    mongoose.models.Expression || mongoose.model('Expression', expressionSchema);

  function publicItem(doc) {
    return {
      id: doc.id,
      ko: doc.ko || '',
      en: doc.en || '',
      example: doc.example || '',
      translation: doc.translation || '',
      category: doc.category || '',
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      level: doc.level || '',
    };
  }

  function escapeRegex(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function parseTags(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t) return [];
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
      } catch {
        /* fall through */
      }
    }
    return t
      .split(/[,|;]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  /** 단순 CSV (따옴표 지원) */
  function parseCsv(text) {
    const src = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let i = 0;
    let inQ = false;
    while (i < src.length) {
      const ch = src[i];
      if (inQ) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQ = false;
          i += 1;
          continue;
        }
        cell += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQ = true;
        i += 1;
        continue;
      }
      if (ch === ',') {
        row.push(cell);
        cell = '';
        i += 1;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map((h) => String(h || '').trim());
    return rows.slice(1).map((r, idx) => {
      const obj = { __row: idx + 2 };
      headers.forEach((h, hi) => {
        obj[h] = r[hi] != null ? String(r[hi]) : '';
      });
      return obj;
    });
  }

  function normalizeInsertRow(raw) {
    const id = String(raw.id || '').trim();
    const ko = String(raw.ko || '').trim();
    const en = String(raw.en || '').trim();
    const status = String(raw.status || 'published').trim().toLowerCase() || 'published';
    const errors = [];
    if (!id) errors.push('id 필수');
    if (!ko) errors.push('ko 필수');
    if (!en) errors.push('en 필수');
    if (!ALLOWED_STATUS.has(status)) errors.push('status는 draft|published');
    return {
      id,
      ko,
      en,
      example: String(raw.example || '').trim(),
      translation: String(raw.translation || '').trim(),
      category: String(raw.category || '일상 표현').trim() || '일상 표현',
      tags: parseTags(raw.tags),
      level: String(raw.level || 'B1').trim() || 'B1',
      status,
      errors,
      __row: raw.__row,
    };
  }

  function normalizeUpdateRow(raw) {
    const id = String(raw.id || '').trim();
    const errors = [];
    if (!id) errors.push('id 필수');
    const hasExample = Object.prototype.hasOwnProperty.call(raw, 'example');
    const hasTranslation = Object.prototype.hasOwnProperty.call(raw, 'translation');
    if (!hasExample && !hasTranslation) errors.push('example 또는 translation 필요');
    return {
      id,
      example: hasExample ? String(raw.example ?? '') : undefined,
      translation: hasTranslation ? String(raw.translation ?? '') : undefined,
      errors,
      __row: raw.__row,
    };
  }

  app.get('/api/expressions', async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.', items: [], hasMore: false, total: 0 });
      }
      const q = String(req.query.q || '').trim().slice(0, 100);
      const category = String(req.query.category || '').trim().slice(0, 80);
      const cursor = String(req.query.cursor || '').trim();
      let limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

      const filter = { status: 'published' };
      if (category) filter.category = category;
      if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ ko: rx }, { en: rx }, { example: rx }, { translation: rx }, { tags: rx }];
      }
      if (cursor) {
        filter.id = { $gt: cursor };
      }

      const countFilter = { status: 'published' };
      if (category) countFilter.category = category;
      if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        countFilter.$or = [{ ko: rx }, { en: rx }, { example: rx }, { translation: rx }, { tags: rx }];
      }

      const [items, total] = await Promise.all([
        Expression.find(filter).sort({ id: 1 }).limit(limit + 1).lean(),
        Expression.countDocuments(countFilter),
      ]);

      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore && page.length ? page[page.length - 1].id : null;

      res.json({
        items: page.map(publicItem),
        nextCursor,
        hasMore,
        total,
      });
    } catch (error) {
      console.error('expressions list 오류:', error);
      res.status(500).json({ error: 'Error retrieving expressions', items: [], hasMore: false, total: 0 });
    }
  });

  app.get('/api/expressions/:id', async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.' });
      }
      const doc = await Expression.findOne({ id: String(req.params.id || '').trim(), status: 'published' }).lean();
      if (!doc) return res.status(404).json({ error: 'Not found' });
      res.json({ item: publicItem(doc) });
    } catch (error) {
      console.error('expressions get 오류:', error);
      res.status(500).json({ error: 'Error retrieving expression' });
    }
  });

  /** 관리자: 검증(dry-run) */
  app.post('/api/expressions/admin/validate', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
    }
    try {
      const mode = String(req.body?.mode || 'insert').trim();
      const format = String(req.body?.format || 'csv').trim().toLowerCase();
      const rawText = String(req.body?.content || '');
      if (!rawText || rawText.length > MAX_UPLOAD_CHARS) {
        return res.status(400).json({ error: 'content 필수 (최대 약 2MB)' });
      }

      let objects = [];
      if (format === 'json') {
        const parsed = JSON.parse(rawText);
        const arr = Array.isArray(parsed) ? parsed : parsed.items || parsed.expressions || [];
        objects = arr.map((o, i) => ({ ...o, __row: i + 1 }));
      } else {
        objects = rowsToObjects(parseCsv(rawText));
      }
      if (objects.length > MAX_ROWS) {
        return res.status(400).json({ error: `행 수 초과 (최대 ${MAX_ROWS})` });
      }

      if (mode === 'update-examples') {
        const preview = [];
        const errors = [];
        let wouldUpdate = 0;
        let missing = 0;
        let noop = 0;
        const seen = new Set();
        for (const raw of objects) {
          const row = normalizeUpdateRow(raw);
          if (row.errors.length) {
            errors.push({ row: row.__row, id: row.id, errors: row.errors });
            continue;
          }
          if (seen.has(row.id)) {
            errors.push({ row: row.__row, id: row.id, errors: ['CSV 내 중복 id'] });
            continue;
          }
          seen.add(row.id);
          const doc = await Expression.findOne({ id: row.id }).lean();
          if (!doc) {
            missing += 1;
            errors.push({ row: row.__row, id: row.id, errors: ['DB에 없음'] });
            continue;
          }
          const before = { example: doc.example || '', translation: doc.translation || '' };
          const after = {
            example: row.example !== undefined ? row.example : before.example,
            translation: row.translation !== undefined ? row.translation : before.translation,
          };
          if (before.example === after.example && before.translation === after.translation) {
            noop += 1;
            continue;
          }
          wouldUpdate += 1;
          if (preview.length < 30) {
            preview.push({ id: row.id, before, after });
          }
        }
        return res.json({
          mode,
          totalRows: objects.length,
          wouldUpdate,
          missing,
          noop,
          errorCount: errors.length,
          errors: errors.slice(0, 50),
          preview,
        });
      }

      /* insert */
      const preview = [];
      const errors = [];
      let wouldInsert = 0;
      let duplicate = 0;
      const seen = new Set();
      const candidates = [];
      for (const raw of objects) {
        const row = normalizeInsertRow(raw);
        if (row.errors.length) {
          errors.push({ row: row.__row, id: row.id, errors: row.errors });
          continue;
        }
        if (seen.has(row.id)) {
          errors.push({ row: row.__row, id: row.id, errors: ['CSV 내 중복 id'] });
          continue;
        }
        seen.add(row.id);
        candidates.push(row);
      }
      const existing = await Expression.find({ id: { $in: candidates.map((c) => c.id) } })
        .select('id')
        .lean();
      const existingSet = new Set(existing.map((e) => e.id));
      for (const row of candidates) {
        if (existingSet.has(row.id)) {
          duplicate += 1;
          continue;
        }
        wouldInsert += 1;
        if (preview.length < 20) preview.push(row);
      }
      res.json({
        mode: 'insert',
        totalRows: objects.length,
        wouldInsert,
        duplicate,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
        preview,
      });
    } catch (error) {
      console.error('expressions validate 오류:', error);
      res.status(500).json({ error: error.message || 'validate failed' });
    }
  });

  /** 관리자: 승인 후 적용 */
  app.post('/api/expressions/admin/apply', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
    }
    try {
      const mode = String(req.body?.mode || 'insert').trim();
      const format = String(req.body?.format || 'csv').trim().toLowerCase();
      const confirm = String(req.body?.confirm || '') === 'APPLY';
      if (!confirm) return res.status(400).json({ error: 'confirm=APPLY 필요' });
      const rawText = String(req.body?.content || '');
      if (!rawText || rawText.length > MAX_UPLOAD_CHARS) {
        return res.status(400).json({ error: 'content 필수' });
      }

      let objects = [];
      if (format === 'json') {
        const parsed = JSON.parse(rawText);
        objects = (Array.isArray(parsed) ? parsed : parsed.items || []).map((o, i) => ({
          ...o,
          __row: i + 1,
        }));
      } else {
        objects = rowsToObjects(parseCsv(rawText));
      }

      if (mode === 'update-examples') {
        let updated = 0;
        let skipped = 0;
        const log = [];
        for (const raw of objects) {
          const row = normalizeUpdateRow(raw);
          if (row.errors.length) {
            skipped += 1;
            continue;
          }
          const $set = { updatedAt: new Date() };
          if (row.example !== undefined) $set.example = row.example;
          if (row.translation !== undefined) $set.translation = row.translation;
          const result = await Expression.updateOne({ id: row.id }, { $set });
          if (result.matchedCount) {
            updated += 1;
            if (log.length < 40) log.push({ id: row.id, updated: true });
          } else skipped += 1;
        }
        console.log('[expressions] update-examples', { updated, skipped });
        return res.json({ mode, updated, skipped, log });
      }

      let inserted = 0;
      let skipped = 0;
      const seen = new Set();
      for (const raw of objects) {
        const row = normalizeInsertRow(raw);
        if (row.errors.length || seen.has(row.id)) {
          skipped += 1;
          continue;
        }
        seen.add(row.id);
        try {
          await Expression.create({
            id: row.id,
            ko: row.ko,
            en: row.en,
            example: row.example,
            translation: row.translation,
            category: row.category,
            tags: row.tags,
            level: row.level,
            status: row.status,
          });
          inserted += 1;
        } catch (e) {
          if (e && e.code === 11000) skipped += 1;
          else throw e;
        }
      }
      console.log('[expressions] insert', { inserted, skipped });
      res.json({ mode: 'insert', inserted, skipped });
    } catch (error) {
      console.error('expressions apply 오류:', error);
      res.status(500).json({ error: error.message || 'apply failed' });
    }
  });

  return { Expression };
}
