/**
 * quiz_meaning 비어 있는 word_quiz_info만 GPT로 채움
 *
 *   cd backend
 *   node scripts/word-meaning-quiz-fill-meanings.js --limit=200 --dry-run
 *   node scripts/word-meaning-quiz-fill-meanings.js --limit=50
 *
 * meaning_checked=true 또는 quiz_meaning 있는 행은 건드리지 않음.
 * OpenAI는 이 스크립트에서만 사용 (퀴즈 API 런타임 미호출).
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getWordQuizInfoModel, LEVELS, QUIZ_POS } from '../models/word-quiz-schemas.js';
import { countChars, validateExistingMeaning } from '../lib/word-quiz-meaning-validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const BATCH = 50;
const MAX_RETRIES = 3;

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function argValue(flag, fallback = null) {
  const pref = `${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function validateItem(item, allowedIds) {
  const id = String(item?.id || '').trim();
  if (!allowedIds.has(id)) return { ok: false, reason: 'unknown_id' };
  const quiz_meaning = String(item?.quiz_meaning || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!quiz_meaning) return { ok: false, reason: 'empty_meaning' };
  if (countChars(quiz_meaning) > 12) return { ok: false, reason: 'meaning_too_long' };
  if (!/[가-힣]/.test(quiz_meaning)) return { ok: false, reason: 'no_hangul' };
  const pos = String(item?.pos || '').trim();
  if (!QUIZ_POS.includes(pos)) return { ok: false, reason: 'bad_pos' };
  let level = String(item?.level || '').trim();
  if (level && !LEVELS.includes(level)) level = '';
  let example = String(item?.example || '').trim();
  let example_ko = String(item?.example_ko || '').trim();
  const words = example ? example.split(/\s+/).filter(Boolean) : [];
  if (words.length > 12) {
    example = words.slice(0, 12).join(' ');
  }
  /* existing 재사용 규칙과 충돌하지 않게 한 번 더 */
  const v = validateExistingMeaning(quiz_meaning);
  if (!v.ok && v.reason !== 'too_long') {
    /* GPT 12자 이하는 too_long 아님 — sentence_like 등은 거절 */
    if (v.reason === 'sentence_like' || v.reason === 'too_many_senses' || v.reason === 'latin_heavy') {
      return { ok: false, reason: v.reason };
    }
  }
  return {
    ok: true,
    id,
    quiz_meaning,
    pos,
    level: level || null,
    example: example || null,
    example_ko: example_ko || null,
  };
}

function buildPrompt(batch) {
  /* ObjectId 환각 방지: 배치 내 짧은 키(n1..)만 보내고 나중에 매핑 */
  const lines = batch.map((d, i) => ({
    id: `n${i + 1}`,
    word: d.word,
    pos_hint: d.pos,
    pos_source: d.pos_source || '',
    raw_example: d.example || '',
    raw_example_ko: d.example_ko || '',
  }));
  return `당신은 한국 중고등학생용 영단어 뜻 편집자입니다.
아래 단어마다 가장 흔한 한국어 뜻 하나만 만드세요.

규칙:
- id 값은 목록의 n1, n2… 를 그대로 쓰세요. 임의 id를 만들지 마세요.
- quiz_meaning: 공백 포함 12자 이내, 설명 없이 뜻만. 동사는 "~하다/~되다", 형용사는 "~한/~운/~은", 명사는 명사.
- 꼭 필요하면 쉼표로 최대 2개 뜻.
- pos: noun|verb|adjective|adverb|other 중 하나 (pos_hint 우선).
- level: beginner(중학 기본)|intermediate(고교·수능)|advanced(그 이상).
- example: 12단어 이내 쉬운 영어 문장, example_ko: 자연스러운 해석.
- JSON만 출력: {"items":[{"id":"n1","quiz_meaning":"","pos":"","level":"","example":"","example_ko":""}]}

단어 목록:
${JSON.stringify(lines, null, 2)}`;
}

async function callOpenAI(openai, model, batch) {
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Return JSON only. Follow the schema exactly.',
      },
      { role: 'user', content: buildPrompt(batch) },
    ],
  });
  const raw = completion.choices[0]?.message?.content || '';
  const usage = completion.usage || {};
  const data = JSON.parse(
    String(raw)
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()
  );
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    items,
    tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
  };
}

async function fillBatch(openai, model, batch) {
  const keyToId = new Map(batch.map((d, i) => [`n${i + 1}`, String(d._id)]));
  const allowedKeys = new Set(keyToId.keys());
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const { items, tokens } = await callOpenAI(openai, model, batch);
      const ok = [];
      const failed = [];
      for (const item of items) {
        const key = String(item?.id || '').trim();
        const realId = keyToId.get(key);
        if (!realId) {
          failed.push({ id: key, reason: 'unknown_id' });
          continue;
        }
        const v = validateItem({ ...item, id: key }, allowedKeys);
        if (v.ok) ok.push({ ...v, id: realId });
        else failed.push({ id: realId, reason: v.reason });
      }
      const got = new Set(ok.map((x) => x.id));
      for (const d of batch) {
        const id = String(d._id);
        if (!got.has(id) && !failed.some((f) => String(f.id) === id)) {
          failed.push({ id, reason: 'missing_in_response' });
        }
      }
      return { ok, failed, tokens };
    } catch (err) {
      lastErr = err;
      const wait = 500 * 2 ** (attempt - 1);
      console.warn(`  재시도 ${attempt}/${MAX_RETRIES}: ${err.message} (${wait}ms)`);
      await sleep(wait);
    }
  }
  return {
    ok: [],
    failed: batch.map((d) => ({ id: String(d._id), reason: lastErr?.message || 'api_error' })),
    tokens: 0,
  };
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const limit = Math.max(1, Number(argValue('--limit', '500')) || 500);
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!apiKey) {
    console.error('OPENAI_API_KEY 없음');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.mongo_uri;
  if (!uri) {
    console.error('MONGODB_URI 없음');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
  const WordQuizInfo = getWordQuizInfoModel();

  const query = {
    enabled: true,
    meaning_checked: { $ne: true },
    $or: [{ quiz_meaning: null }, { quiz_meaning: '' }, { quiz_meaning: { $exists: false } }],
  };
  const docs = await WordQuizInfo.find(query).sort({ word: 1 }).limit(limit).lean();
  console.log(`대상 ${docs.length}건 (limit=${limit}, dryRun=${dryRun}, model=${model})`);

  const openai = new OpenAI({ apiKey });
  const preview = [];
  let processed = 0;
  let success = 0;
  let failed = 0;
  let tokens = 0;

  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    console.log(`배치 ${i / BATCH + 1}: ${batch.length}건`);
    const result = await fillBatch(openai, model, batch);
    tokens += result.tokens;
    processed += batch.length;
    failed += result.failed.length;

    for (const row of result.ok) {
      success += 1;
      preview.push(row);
      if (!dryRun) {
        await WordQuizInfo.updateOne(
          { _id: row.id, meaning_checked: { $ne: true } },
          {
            $set: {
              quiz_meaning: row.quiz_meaning,
              pos: row.pos,
              level: row.level || undefined,
              example: row.example,
              example_ko: row.example_ko,
              meaning_source: 'gpt',
              meaning_checked: false,
            },
          }
        );
      }
    }
    for (const f of result.failed) {
      console.warn(`  skip ${f.id}: ${f.reason}`);
    }
    await sleep(400);
  }

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const previewPath = path.join(outDir, 'fill-preview.csv');
  const header = ['id', 'quiz_meaning', 'pos', 'level', 'example', 'example_ko'];
  const lines = [header.join(',')];
  for (const r of preview) {
    lines.push(
      [r.id, r.quiz_meaning, r.pos, r.level || '', r.example || '', r.example_ko || '']
        .map(csvEscape)
        .join(',')
    );
  }
  fs.writeFileSync(previewPath, `\uFEFF${lines.join('\n')}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        processed,
        success,
        failed,
        tokensApprox: tokens,
        dryRun,
        preview: previewPath,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[error]', err.message || err);
  process.exit(1);
});
