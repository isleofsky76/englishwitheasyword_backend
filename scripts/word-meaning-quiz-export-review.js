/**
 * 미검수 word_quiz_info → UTF-8 BOM CSV
 *   node scripts/word-meaning-quiz-export-review.js
 *   node scripts/word-meaning-quiz-export-review.js --all
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getWordQuizInfoModel } from '../models/word-quiz-schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const all = process.argv.includes('--all');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
  const WordQuizInfo = getWordQuizInfoModel();
  const q = all ? {} : { meaning_checked: { $ne: true }, quiz_meaning: { $nin: [null, ''] } };
  const rows = await WordQuizInfo.find(q).sort({ word: 1 }).lean();
  const header = [
    'id',
    'source_type',
    'source_id',
    'word',
    'pos',
    'pos_source',
    'quiz_meaning',
    'level',
    'example',
    'example_ko',
    'meaning_group',
    'meaning_source',
    'meaning_checked',
    'content_url',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r._id,
        r.source_type,
        r.source_id,
        r.word,
        r.pos,
        r.pos_source,
        r.quiz_meaning,
        r.level,
        r.example,
        r.example_ko,
        r.meaning_group,
        r.meaning_source,
        r.meaning_checked ? 'true' : 'false',
        r.content_url,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  const out = path.join(__dirname, '..', 'data', 'quiz-review-export.csv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `\uFEFF${lines.join('\n')}\n`, 'utf8');
  console.log(`wrote ${rows.length} rows → ${out}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
