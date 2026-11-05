/**
 * 사이트 랭킹 대시보드 — 댓글 단어 / 다운로드 / 검색어
 * registerRankingApi(app, { getRequestIp })
 */
import crypto from 'crypto';
import mongoose from 'mongoose';

const KINDS = new Set(['comment', 'download', 'search']);
const PERIODS = new Set(['today', '7d', '30d', 'all']);
const MAX_TERM = 64;
const MAX_BATCH = 40;
const EVENT_COOLDOWN_MS = 800;

const ipLastWrite = new Map(); // ip -> ms

function sha8(s) {
  return crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16);
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function periodSince(period) {
  const now = Date.now();
  if (period === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (period === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return null;
}

/** 영어 단어·짧은 구 정규화 */
export function normalizeRankTerm(raw) {
  let t = String(raw == null ? '' : raw).trim().toLowerCase();
  t = t.replace(/[“”"']/g, "'").replace(/\s+/g, ' ');
  t = t.replace(/^[^a-z]+|[^a-z]+$/gi, '');
  if (!t) return '';
  if (!/^[a-z][a-z0-9' \-]{0,62}$/i.test(t)) return '';
  if (t.length < 2 || t.length > MAX_TERM) return '';
  return t;
}

/** 댓글 본문이 단일 영어 단어(또는 짧은 구)인지 */
export function extractCommentWord(body) {
  const raw = String(body == null ? '' : body).trim();
  if (!raw || /\s{2,}/.test(raw)) return '';
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length > 3) return '';
  return normalizeRankTerm(raw);
}

export function registerRankingApi(app, deps = {}) {
  const getRequestIp =
    typeof deps.getRequestIp === 'function'
      ? deps.getRequestIp
      : (req) => req.ip || 'unknown';

  const siteEventSchema = new mongoose.Schema(
    {
      kind: { type: String, required: true, enum: ['comment', 'download', 'search'], index: true },
      term: { type: String, required: true },
      termNorm: { type: String, required: true, index: true },
      source: { type: String, default: '' },
      actorKey: { type: String, default: '', index: true },
      day: { type: String, default: '', index: true },
      date: { type: Date, default: Date.now, index: true },
    },
    { collection: 'siteevents', timestamps: false }
  );
  siteEventSchema.index({ kind: 1, termNorm: 1, actorKey: 1, day: 1 }, { unique: true, sparse: true });
  siteEventSchema.index({ kind: 1, date: -1 });

  const SiteEvent =
    mongoose.models.SiteEvent || mongoose.model('SiteEvent', siteEventSchema);

  async function recordEvent({ kind, term, source, actorKey, date }) {
    const termNorm = normalizeRankTerm(term);
    if (!KINDS.has(kind) || !termNorm) return { ok: false, reason: 'invalid' };
    const when = date instanceof Date ? date : new Date();
    const day = dayKey(when);
    const actor = String(actorKey || '').slice(0, 40);
    try {
      await SiteEvent.updateOne(
        { kind, termNorm, actorKey: actor || 'anon', day },
        {
          $setOnInsert: {
            kind,
            term: termNorm,
            termNorm,
            source: String(source || '').slice(0, 40),
            actorKey: actor || 'anon',
            day,
            date: when,
          },
        },
        { upsert: true }
      );
      return { ok: true, term: termNorm };
    } catch (e) {
      if (e && e.code === 11000) return { ok: true, term: termNorm, deduped: true };
      throw e;
    }
  }

  async function rankForKind(kind, period, limit) {
    const since = periodSince(period);
    const match = { kind };
    if (since) match.date = { $gte: since };
    const rows = await SiteEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$termNorm',
          count: { $sum: 1 },
          lastAt: { $max: '$date' },
          term: { $first: '$term' },
        },
      },
      { $sort: { count: -1, lastAt: -1 } },
      { $limit: limit },
    ]);
    return rows.map((r, i) => ({
      rank: i + 1,
      term: r.term || r._id,
      count: r.count,
      lastAt: r.lastAt,
    }));
  }

  async function summary(period) {
    const since = periodSince(period);
    const matchBase = since ? { date: { $gte: since } } : {};
    const [byKind, uniqueActors, todayComments] = await Promise.all([
      SiteEvent.aggregate([
        { $match: matchBase },
        { $group: { _id: '$kind', count: { $sum: 1 }, terms: { $addToSet: '$termNorm' } } },
      ]),
      SiteEvent.aggregate([
        { $match: { ...matchBase, kind: 'comment' } },
        { $group: { _id: '$actorKey' } },
        { $count: 'n' },
      ]),
      SiteEvent.countDocuments({
        kind: 'comment',
        date: { $gte: periodSince('today') },
      }),
    ]);
    const map = Object.create(null);
    byKind.forEach((r) => {
      map[r._id] = { events: r.count, uniqueTerms: (r.terms || []).length };
    });
    return {
      comments: map.comment?.events || 0,
      uniqueWords: map.comment?.uniqueTerms || 0,
      downloads: map.download?.events || 0,
      searches: map.search?.events || 0,
      learners: uniqueActors[0]?.n || 0,
      todayComments,
    };
  }

  /** 공개: 대시보드 요약 + 3종 랭킹 */
  app.get('/api/stats/dashboard', async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'MongoDB 연결이 되지 않았습니다.' });
      }
      const period = PERIODS.has(String(req.query.period || ''))
        ? String(req.query.period)
        : '7d';
      const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 20));
      const [stats, comments, downloads, searches] = await Promise.all([
        summary(period),
        rankForKind('comment', period, limit),
        rankForKind('download', period, limit),
        rankForKind('search', period, limit),
      ]);
      res.json({
        period,
        stats,
        rankings: { comments, downloads, searches },
      });
    } catch (error) {
      console.error('stats dashboard 오류:', error);
      res.status(500).json({ error: 'Error retrieving dashboard' });
    }
  });

  /** 공개: 검색/다운로드 이벤트 기록 (중복·쿨다운 제한) */
  app.post('/api/stats/event', async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'MongoDB에 연결되지 않았습니다.' });
      }
      const ip = getRequestIp(req);
      const now = Date.now();
      const last = ipLastWrite.get(ip) || 0;
      if (now - last < EVENT_COOLDOWN_MS) {
        return res.status(429).json({ error: 'too fast' });
      }
      ipLastWrite.set(ip, now);

      const kind = String(req.body?.kind || '').trim();
      const source = String(req.body?.source || '').trim().slice(0, 40);
      let terms = [];
      if (Array.isArray(req.body?.terms)) {
        terms = req.body.terms.slice(0, MAX_BATCH);
      } else if (req.body?.term != null) {
        terms = [req.body.term];
      }
      if (!KINDS.has(kind) || kind === 'comment') {
        return res.status(400).json({ error: 'kind must be download|search' });
      }

      const actorKey = sha8(ip + '|' + dayKey());
      let saved = 0;
      for (const t of terms) {
        const r = await recordEvent({ kind, term: t, source, actorKey });
        if (r.ok) saved += 1;
      }
      res.json({ ok: true, saved });
    } catch (error) {
      console.error('stats event 오류:', error);
      res.status(500).json({ error: 'Error saving event' });
    }
  });

  /** 댓글 저장 후 호출 — 단일 영어 단어면 랭킹 반영 */
  async function recordCommentWord({ body, ip, source, date }) {
    const term = extractCommentWord(body);
    if (!term) return null;
    const actorKey = sha8(String(ip || 'x') + '|' + dayKey(date || new Date()) + '|' + term);
    return recordEvent({
      kind: 'comment',
      term,
      source: source || 'comment',
      actorKey,
      date,
    });
  }

  /** 기존 댓글 백필 (관리용 — 공개 아님, 내부 스크립트/부트) */
  async function backfillFromComments(models) {
    const { OneSentenceComment, BoardComment } = models || {};
    let n = 0;
    if (OneSentenceComment) {
      const rows = await OneSentenceComment.find({}).select('body word date').lean();
      for (const row of rows) {
        const fromBody = extractCommentWord(row.body);
        const fromWord = normalizeRankTerm(row.word);
        const term = fromBody || fromWord;
        if (!term) continue;
        const actorKey = sha8('backfill|os|' + String(row._id));
        const r = await recordEvent({
          kind: 'comment',
          term,
          source: 'onesentence',
          actorKey,
          date: row.date || new Date(),
        });
        if (r.ok) n += 1;
      }
    }
    if (BoardComment) {
      const rows = await BoardComment.find({}).select('body date board').lean();
      for (const row of rows) {
        const term = extractCommentWord(row.body);
        if (!term) continue;
        const actorKey = sha8('backfill|bc|' + String(row._id));
        const r = await recordEvent({
          kind: 'comment',
          term,
          source: row.board || 'board',
          actorKey,
          date: row.date || new Date(),
        });
        if (r.ok) n += 1;
      }
    }
    return n;
  }

  return { recordCommentWord, backfillFromComments, SiteEvent, normalizeRankTerm, extractCommentWord };
}
