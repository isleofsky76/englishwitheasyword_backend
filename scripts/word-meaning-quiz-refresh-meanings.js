/**
 * onesentence 원문 뜻으로 word_quiz_info.quiz_meaning 보강
 * (짧아진 GPT 단일을 여러 뜻 포함 원문으로 되돌림)
 *
 *   cd backend
 *   node scripts/word-meaning-quiz-refresh-meanings.js --dry-run
 *   node scripts/word-meaning-quiz-refresh-meanings.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SOURCE_TYPES } from '../lib/word-quiz-source-adapters.js';
import { trimMeaningForQuiz, splitSenses } from '../lib/word-quiz-meaning-validate.js';
import { getWordQuizInfoModel } from '../models/word-quiz-schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function senseCount(text) {
  return splitSenses(text).length;
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.mongo_uri;
  if (!uri) {
    console.error('MONGODB_URI / MONGO_URI 없음');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });

  const WordQuizInfo = getWordQuizInfoModel();
  const onesentence = mongoose.connection.db.collection('onesentence');
  const rows = await WordQuizInfo.find({
    source_type: SOURCE_TYPES.ONESENTENCE,
    meaning_checked: { $ne: true },
  }).lean();

  let updated = 0;
  let skipped = 0;
  let unusable = 0;
  const preview = [];

  for (const row of rows) {
    let src = null;
    try {
      src = await onesentence.findOne(
        { _id: new mongoose.Types.ObjectId(row.source_id) },
        { projection: { meaning: 1 } }
      );
    } catch {
      skipped += 1;
      continue;
    }
    if (!src) {
      skipped += 1;
      continue;
    }

    const trimmed = trimMeaningForQuiz(src.meaning);
    if (!trimmed.ok) {
      unusable += 1;
      continue;
    }

    const next = trimmed.normalized;
    const cur = String(row.quiz_meaning || '').trim();
    const richer =
      !cur ||
      senseCount(next) > senseCount(cur) ||
      Array.from(next).length > Array.from(cur).length + 1;
    if (!richer || next === cur) {
      skipped += 1;
      continue;
    }

    if (preview.length < 12) {
      preview.push({ word: row.word, from: cur, to: next });
    }

    if (!dryRun) {
      await WordQuizInfo.updateOne(
        { _id: row._id },
        {
          $set: {
            quiz_meaning: next,
            meaning_source: 'existing',
            meaning_checked: false,
          },
        }
      );
    }
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        scanned: rows.length,
        updated,
        skipped,
        unusable,
        preview,
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
