/**
 * word_quiz_info / word_meaning_quiz_sessions 컬렉션·인덱스
 *
 *   cd backend
 *   node scripts/word-meaning-quiz-migrate.js --apply
 *   node scripts/word-meaning-quiz-migrate.js --rollback
 *
 * onesentence 원본은 변경하지 않음.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  getWordQuizInfoModel,
  getWordMeaningQuizSessionModel,
} from '../models/word-quiz-schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.mongo_uri;
  if (!uri) {
    console.error('MONGODB_URI / MONGO_URI 없음');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
  console.log('MongoDB 연결 OK');
}

async function apply() {
  const db = mongoose.connection.db;
  for (const name of ['word_quiz_info', 'word_meaning_quiz_sessions']) {
    try {
      await db.createCollection(name);
      console.log(`컬렉션 생성: ${name}`);
    } catch (e) {
      if (e.code === 48 || e.codeName === 'NamespaceExists') {
        console.log(`컬렉션 이미 있음: ${name}`);
      } else {
        throw e;
      }
    }
  }

  const WordQuizInfo = getWordQuizInfoModel();
  const Session = getWordMeaningQuizSessionModel();
  await WordQuizInfo.syncIndexes();
  await Session.syncIndexes();
  console.log('인덱스 sync 완료');
  console.log('[apply] 완료 — onesentence 미변경');
}

async function rollback() {
  const db = mongoose.connection.db;
  for (const name of ['word_meaning_quiz_sessions', 'word_quiz_info']) {
    try {
      await db.dropCollection(name);
      console.log(`컬렉션 삭제: ${name}`);
    } catch (e) {
      if (e.code === 26 || e.codeName === 'NamespaceNotFound') {
        console.log(`컬렉션 없음(스킵): ${name}`);
      } else {
        throw e;
      }
    }
  }
  console.log('[rollback] 완료 — onesentence 미변경');
}

async function main() {
  const doApply = hasFlag('--apply');
  const doRollback = hasFlag('--rollback');
  if (doApply === doRollback) {
    console.log(`Usage:
  node scripts/word-meaning-quiz-migrate.js --apply
  node scripts/word-meaning-quiz-migrate.js --rollback`);
    process.exit(1);
  }
  await connect();
  try {
    if (doApply) await apply();
    else await rollback();
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[error]', err.message || err);
  process.exit(1);
});
