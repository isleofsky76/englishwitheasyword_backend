/**
 * CSV → word_quiz_info 반영 (meaning_checked=true, 수정 시 meaning_source=manual)
 *   node scripts/word-meaning-quiz-import-review.js --file=data/quiz-review-export.csv
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getWordQuizInfoModel, LEVELS, QUIZ_POS, MEANING_SOURCES } from '../models/word-quiz-schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

function argValue(flag) {
  const pref = `${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  const i = process.argv.indexOf(flag);
  if (i >= 0) return process.argv[i + 1];
  return null;
}

function parseCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let i = 0;
  let cur = '';
  let row = [];
  let inQ = false;
  while (i < raw.length) {
    const ch = raw[i];
    if (inQ) {
      if (ch === '"' && raw[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQ = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQ = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((cols) => {
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = cols[idx] != null ? String(cols[idx]) : '';
    });
    return obj;
  });
}

async function main() {
  const file = argValue('--file') || path.join(__dirname, '..', 'data', 'quiz-review-export.csv');
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error('파일 없음:', abs);
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(abs, 'utf8'));
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
  const WordQuizInfo = getWordQuizInfoModel();
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const id = String(r.id || '').trim();
    if (!id || !mongoose.isValidObjectId(id)) {
      skipped += 1;
      continue;
    }
    const existing = await WordQuizInfo.findById(id);
    if (!existing) {
      skipped += 1;
      continue;
    }
    const quiz_meaning = String(r.quiz_meaning || '').trim();
    if (!quiz_meaning) {
      skipped += 1;
      continue;
    }
    const pos = String(r.pos || existing.pos || '').trim();
    if (!QUIZ_POS.includes(pos)) {
      skipped += 1;
      continue;
    }
    let level = String(r.level || '').trim();
    if (level && !LEVELS.includes(level)) level = '';
    const changed =
      quiz_meaning !== String(existing.quiz_meaning || '') ||
      pos !== String(existing.pos || '') ||
      (level || '') !== String(existing.level || '') ||
      String(r.example || '') !== String(existing.example || '') ||
      String(r.example_ko || '') !== String(existing.example_ko || '') ||
      String(r.meaning_group || '') !== String(existing.meaning_group || '');

    const set = {
      quiz_meaning,
      pos,
      level: level || undefined,
      example: String(r.example || '').trim() || null,
      example_ko: String(r.example_ko || '').trim() || null,
      meaning_group: String(r.meaning_group || '').trim() || null,
      meaning_checked: true,
    };
    if (changed) set.meaning_source = 'manual';
    else if (!MEANING_SOURCES.includes(existing.meaning_source)) {
      /* keep existing source if unchecked only */
    }

    await WordQuizInfo.updateOne({ _id: id }, { $set: set });
    updated += 1;
  }
  console.log(JSON.stringify({ updated, skipped, file: abs }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
