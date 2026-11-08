/**
 * 수험영어 CSV 일괄 등록/갱신
 *
 * CSV 형식: word,meaning,category[,phonetic,example_en,example_ko]
 * 또는 seed CSV: no,word,meaning,category,...,is_active,...
 *
 *   cd backend
 *   node scripts/import_words.js --file=db/seeds/basic_vocab_2022_3000.csv
 *   node scripts/import_words.js --file=db/seeds/basic_vocab_2022_3000.csv --dry-run
 *
 * (word, meaning)이 같으면 갱신, 분류 연결은 중복 무시(upsert).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import {
  getExamCategoryModel,
  getExamWordModel,
  getExamWordCategoryModel,
  DEFAULT_EXAM_CATEGORIES,
} from '../models/exam-schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SOURCE_DEFAULT = '2022 개정 기본어휘';

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

/** 간단 CSV 파서 (따옴표 필드 지원) */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQ = true;
      continue;
    }
    if (ch === ',') {
      row.push(cur);
      cur = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      continue;
    }
    if (ch === '\r') continue;
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

async function ensureCategories() {
  const ExamCategory = getExamCategoryModel();
  const bySlug = {};
  for (const c of DEFAULT_EXAM_CATEGORIES) {
    const doc = await ExamCategory.findOneAndUpdate(
      { slug: c.slug },
      {
        $set: {
          name: c.name,
          sort_order: c.sort_order,
        },
        $setOnInsert: {
          slug: c.slug,
          is_active: c.is_active,
        },
      },
      { upsert: true, new: true }
    );
    bySlug[c.slug] = doc;
  }
  return bySlug;
}

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.mongo_uri;
  if (!uri) {
    console.error('MONGO_URI / MONGODB_URI 없음');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
  console.log('MongoDB 연결 OK');
}

async function main() {
  const fileArg = argValue('--file') || 'db/seeds/basic_vocab_2022_3000.csv';
  const dryRun = hasFlag('--dry-run');
  const filePath = path.isAbsolute(fileArg)
    ? fileArg
    : path.join(__dirname, '..', fileArg);

  if (!fs.existsSync(filePath)) {
    console.error('파일 없음:', filePath);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const table = parseCsv(raw);
  if (table.length < 2) {
    console.error('CSV 행이 부족합니다');
    process.exit(1);
  }

  const header = table[0].map((h) => String(h).trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iWord = idx('word');
  const iMeaning = idx('meaning');
  const iCat = idx('category');
  const iActive = idx('is_active');
  const iPhonetic = idx('phonetic');
  const iExEn = idx('example_en');
  const iExKo = idx('example_ko');

  if (iWord < 0 || iMeaning < 0 || iCat < 0) {
    console.error('필수 열: word, meaning, category');
    process.exit(1);
  }

  await connect();
  const bySlug = await ensureCategories();
  const ExamWord = getExamWordModel();
  const ExamWordCategory = getExamWordCategoryModel();
  const ExamCategory = getExamCategoryModel();

  let upserted = 0;
  let linked = 0;
  let skipped = 0;
  const counts = {};

  for (let r = 1; r < table.length; r += 1) {
    const cols = table[r];
    const word = String(cols[iWord] || '').trim();
    const meaning = String(cols[iMeaning] || '').trim();
    const catSlug = String(cols[iCat] || '').trim().toLowerCase();
    if (!word || !meaning || !catSlug) {
      skipped += 1;
      continue;
    }

    let cat = bySlug[catSlug];
    if (!cat) {
      if (dryRun) {
        bySlug[catSlug] = { _id: 'dry', slug: catSlug };
        cat = bySlug[catSlug];
      } else {
        cat = await ExamCategory.findOneAndUpdate(
          { slug: catSlug },
          {
            $setOnInsert: {
              slug: catSlug,
              name: catSlug,
              sort_order: 100,
              is_active: true,
            },
          },
          { upsert: true, new: true }
        );
        bySlug[catSlug] = cat;
      }
    }

    const isActive =
      iActive >= 0
        ? String(cols[iActive] ?? '1').trim() !== '0' &&
          String(cols[iActive]).trim().toLowerCase() !== 'false'
        : true;

    const patch = {
      word,
      meaning,
      source: SOURCE_DEFAULT,
      is_active: isActive,
    };
    if (iPhonetic >= 0 && cols[iPhonetic]) patch.phonetic = String(cols[iPhonetic]).trim();
    if (iExEn >= 0 && cols[iExEn]) patch.example_en = String(cols[iExEn]).trim();
    if (iExKo >= 0 && cols[iExKo]) patch.example_ko = String(cols[iExKo]).trim();

    if (dryRun) {
      upserted += 1;
      linked += 1;
      counts[catSlug] = (counts[catSlug] || 0) + 1;
      continue;
    }

    const wordDoc = await ExamWord.findOneAndUpdate(
      { word, meaning },
      { $set: patch },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    upserted += 1;

    try {
      await ExamWordCategory.updateOne(
        { word_id: wordDoc._id, category_id: cat._id },
        { $setOnInsert: { word_id: wordDoc._id, category_id: cat._id } },
        { upsert: true }
      );
      linked += 1;
    } catch (e) {
      if (e && e.code !== 11000) throw e;
    }
    counts[catSlug] = (counts[catSlug] || 0) + 1;
  }

  console.log(dryRun ? '[dry-run]' : '[done]', {
    upserted,
    linked,
    skipped,
    counts,
  });

  if (!dryRun) {
    const rows = await ExamWordCategory.aggregate([
      {
        $lookup: {
          from: 'exam_categories',
          localField: 'category_id',
          foreignField: '_id',
          as: 'c',
        },
      },
      { $unwind: '$c' },
      { $group: { _id: '$c.name', n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    console.log('검증(분류별 연결 수):');
    for (const row of rows) console.log(' ', row._id, row.n);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
