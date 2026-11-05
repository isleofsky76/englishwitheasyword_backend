import mongoose from 'mongoose';

/** 동일 IP·게시글 1시간 중복 조회 방지 (DB 영속) + IP 분당 조회 상한 */
const VIEW_DEDUP_MS = 60 * 60 * 1000;
const IP_RATE_WINDOW_MS = 60 * 1000;
const IP_RATE_MAX = 40; // 분당 조회수 증가 허용 횟수 (전체 보드 합산)

const viewLogSchema = new mongoose.Schema(
  {
    ip: { type: String, required: true },
    board: { type: String, required: true },
    postId: { type: String, required: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { collection: 'postviewlogs' }
);

viewLogSchema.index({ ip: 1, board: 1, postId: 1, at: -1 });
viewLogSchema.index({ at: 1 }, { expireAfterSeconds: Math.ceil(VIEW_DEDUP_MS / 1000) + 120 });

const PostViewLog =
  mongoose.models.PostViewLog || mongoose.model('PostViewLog', viewLogSchema);

/** IP별 최근 조회 타임스탬프 (프로세스 메모리 — rate limit용) */
const ipViewTimes = new Map();
/** 빠른 중복 체크 캐시 (재시작 시 DB가 최종 권위) */
const memDedupe = new Map();

function normalizeIp(ip) {
  const s = String(ip || 'unknown').trim() || 'unknown';
  return s.replace(/^::ffff:/, '');
}

function pruneIpTimes(ip, now) {
  const since = now - IP_RATE_WINDOW_MS;
  const next = (ipViewTimes.get(ip) || []).filter((t) => t >= since);
  ipViewTimes.set(ip, next);
  return next;
}

function rememberMem(memKey, now) {
  memDedupe.set(memKey, now);
  setTimeout(() => memDedupe.delete(memKey), VIEW_DEDUP_MS);
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'rate'|'duplicate'|'invalid', message: string }>}
 */
export async function allowViewIncrement(ipRaw, board, postId) {
  const ip = normalizeIp(ipRaw);
  const boardKey = String(board || '').trim();
  const id = String(postId || '').trim();
  if (!boardKey || !id || id === 'undefined') {
    return { ok: false, reason: 'invalid', message: 'Invalid view request' };
  }

  const now = Date.now();
  const recent = pruneIpTimes(ip, now);
  if (recent.length >= IP_RATE_MAX) {
    return {
      ok: false,
      reason: 'rate',
      message: '조회 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    };
  }

  const memKey = `${ip}::${boardKey}::${id}`;
  const memAt = memDedupe.get(memKey);
  if (memAt && now - memAt < VIEW_DEDUP_MS) {
    return {
      ok: false,
      reason: 'duplicate',
      message: '조회수가 증가하지 않았습니다 (동일 IP, 1시간 내 중복 조회)',
    };
  }

  if (mongoose.connection.readyState === 1) {
    try {
      const since = new Date(now - VIEW_DEDUP_MS);
      const existing = await PostViewLog.findOne({
        ip,
        board: boardKey,
        postId: id,
        at: { $gte: since },
      })
        .select('_id')
        .lean();
      if (existing) {
        rememberMem(memKey, now);
        return {
          ok: false,
          reason: 'duplicate',
          message: '조회수가 증가하지 않았습니다 (동일 IP, 1시간 내 중복 조회)',
        };
      }
      await PostViewLog.create({
        ip,
        board: boardKey,
        postId: id,
        at: new Date(now),
      });
    } catch (err) {
      console.warn('PostViewLog write warning:', err?.message || err);
    }
  }

  rememberMem(memKey, now);
  recent.push(now);
  ipViewTimes.set(ip, recent);
  return { ok: true };
}

export function getViewClientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = xf || req.ip || req.socket?.remoteAddress || 'unknown';
  return normalizeIp(raw);
}
