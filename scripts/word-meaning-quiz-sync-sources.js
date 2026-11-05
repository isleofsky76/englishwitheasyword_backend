/**
 * 원본 섹션 → word_quiz_info upsert
 *
 * 1차: onesentence (원본 읽기만, 수정 없음)
 *
 *   cd backend
 *   node scripts/word-meaning-quiz-sync-sources.js --source=onesentence --dry-run
 *   node scripts/word-meaning-quiz-sync-sources.js --source=onesentence
 *
 * --dry-run: DB 미기록, sync-preview-onesentence.csv 출력
 * 기존 quiz_meaning이 있거나 meaning_checked=true 인 행의 뜻 필드는 덮어쓰지 않음
 *   (word/pos/content_url 등 메타는 갱신 가능)
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SOURCE_TYPES, adaptOneSentenceEntries } from '../lib/word-quiz-source-adapters.js';
import { getWordQuizInfoModel } from '../models/word-quiz-schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function argValue(flag) {
  const pref = `${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return null;
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writePreviewCsv(filePath, rows) {
  const header = [
    'source_type',
    'source_id',
    'word',
    'pos',
    'pos_source',
    'quiz_meaning',
    'meaning_source',
    'needs_gpt',
    'reuse_reason',
    'raw_meaning',
    'content_url',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.source_type,
        r.source_id,
        r.word,
        r.pos,
        r.pos_source,
        r.quiz_meaning || '',
        r.meaning_source || '',
        r.needs_gpt ? '1' : '0',
        r.reuse_reason || '',
        r.raw_meaning || '',
        r.content_url || '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  fs.writeFileSync(filePath, `\uFEFF${lines.join('\n')}\n`, 'utf8');
}

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.mongo_uri;
  if (!uri) {
    console.error('MONGODB_URI / MONGO_URI 없음');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
  console.log('MongoDB 연결 OK (읽기: onesentence / 쓰기 대상: word_quiz_info만)');
}

async function loadOneSentenceEntries() {
  const col = mongoose.connection.db.collection('onesentence');
  return col.find({}).sort({ date: 1, _id: 1 }).toArray();
}

function toDbDoc(row) {
  const doc = {
    source_type: row.source_type,
    source_id: row.source_id,
    word: row.word,
    pos: row.pos,
    pos_source: row.pos_source || '',
    content_url: row.content_url || null,
    example: row.example || null,
    example_ko: row.example_ko || null,
    enabled: true,
  };
  if (!row.needs_gpt && row.quiz_meaning) {
    doc.quiz_meaning = row.quiz_meaning;
    doc.meaning_source = 'existing';
    doc.meaning_checked = false;
  }
  return doc;
}

async function upsertRows(rows) {
  const WordQuizInfo = getWordQuizInfoModel();
  let inserted = 0;
  let updated = 0;
  let meaningPreserved = 0;

  for (const row of rows) {
    const filter = { source_type: row.source_type, source_id: row.source_id };
    const existing = await WordQuizInfo.findOne(filter).lean();
    const doc = toDbDoc(row);

    if (!existing) {
      await WordQuizInfo.create({
        ...doc,
        quiz_meaning: doc.quiz_meaning ?? null,
        meaning_source: doc.meaning_source,
        meaning_checked: false,
      });
      inserted += 1;
      continue;
    }

    const set = {
      word: doc.word,
      pos: doc.pos,
      pos_source: doc.pos_source,
      content_url: doc.content_url,
      example: doc.example,
      example_ko: doc.example_ko,
      enabled: true,
    };

    /* 검수됐거나 이미 뜻이 있으면 quiz_meaning 계열 유지 */
    const keepMeaning =
      existing.meaning_checked === true ||
      (existing.quiz_meaning && String(existing.quiz_meaning).trim());

    if (keepMeaning) {
      meaningPreserved += 1;
    } else if (doc.quiz_meaning) {
      set.quiz_meaning = doc.quiz_meaning;
      set.meaning_source = 'existing';
      set.meaning_checked = false;
    }

    await WordQuizInfo.updateOne(filter, { $set: set });
    updated += 1;
  }

  return { inserted, updated, meaningPreserved };
}

async function main() {
  const source = String(argValue('--source') || SOURCE_TYPES.ONESENTENCE).trim();
  const dryRun = hasFlag('--dry-run');

  if (source !== SOURCE_TYPES.ONESENTENCE) {
    console.error(`현재 지원 source: ${SOURCE_TYPES.ONESENTENCE} (요청: ${source})`);
    process.exit(1);
  }

  await connect();
  try {
    const entries = await loadOneSentenceEntries();
    console.log(`onesentence 로드: ${entries.length}건 (원본 수정 없음)`);

    const { rows, stats } = adaptOneSentenceEntries(entries);
    console.log('[stats]', JSON.stringify(stats, null, 2));

    const outDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(outDir, { recursive: true });
    const previewPath = path.join(outDir, `sync-preview-${source}.csv`);
    writePreviewCsv(previewPath, rows);
    console.log(`미리보기 CSV: ${previewPath}`);

    if (dryRun) {
      console.log('[dry-run] word_quiz_info 미기록');
      console.log(
        `요약: 재사용(existing)=${stats.reuse_existing}, GPT 필요=${stats.needs_gpt}, 스킵=${stats.skipped}`
      );
      return;
    }

    const result = await upsertRows(rows);
    console.log('[upsert]', result);
    console.log('[ok] sync 완료 — onesentence 미변경');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[error]', err.message || err);
  process.exit(1);
});
