/**
 * 04 수험영어 — MongoDB 스키마 (MySQL schema.sql 대응)
 * collections: exam_categories, exam_words, exam_word_categories
 */
import mongoose from 'mongoose';

const examCategorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, maxlength: 30 },
    name: { type: String, required: true, maxlength: 50 },
    sort_order: { type: Number, required: true, default: 0, index: true },
    is_active: { type: Boolean, required: true, default: true, index: true },
  },
  { collection: 'exam_categories', timestamps: false }
);

const examWordSchema = new mongoose.Schema(
  {
    word: { type: String, required: true, maxlength: 100, index: true },
    meaning: { type: String, required: true, maxlength: 200 },
    part_of_speech: { type: String, default: null, maxlength: 20 },
    phonetic: { type: String, default: null, maxlength: 100 },
    example_en: { type: String, default: null, maxlength: 500 },
    example_ko: { type: String, default: null, maxlength: 500 },
    cefr: { type: String, default: null, maxlength: 5 },
    source: { type: String, default: null, maxlength: 100, index: true },
    is_active: { type: Boolean, required: true, default: true, index: true },
  },
  { collection: 'exam_words', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

examWordSchema.index({ word: 1, meaning: 1 }, { unique: true });

const examWordCategorySchema = new mongoose.Schema(
  {
    word_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExamWord',
      required: true,
      index: true,
    },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExamCategory',
      required: true,
      index: true,
    },
  },
  { collection: 'exam_word_categories', timestamps: false }
);

examWordCategorySchema.index({ word_id: 1, category_id: 1 }, { unique: true });
examWordCategorySchema.index({ category_id: 1, word_id: 1 });

let ExamCategory;
let ExamWord;
let ExamWordCategory;

export function getExamCategoryModel() {
  if (!ExamCategory) {
    ExamCategory =
      mongoose.models.ExamCategory ||
      mongoose.model('ExamCategory', examCategorySchema);
  }
  return ExamCategory;
}

export function getExamWordModel() {
  if (!ExamWord) {
    ExamWord =
      mongoose.models.ExamWord || mongoose.model('ExamWord', examWordSchema);
  }
  return ExamWord;
}

export function getExamWordCategoryModel() {
  if (!ExamWordCategory) {
    ExamWordCategory =
      mongoose.models.ExamWordCategory ||
      mongoose.model('ExamWordCategory', examWordCategorySchema);
  }
  return ExamWordCategory;
}

export const DEFAULT_EXAM_CATEGORIES = [
  { slug: 'elem', name: '초등영어', sort_order: 10, is_active: true },
  { slug: 'middle', name: '중등영어', sort_order: 20, is_active: true },
  { slug: 'high', name: '고등영어', sort_order: 30, is_active: true },
  /* 확장용 — 단어 연결 전엔 탭에 안 보이게 비활성 */
  { slug: 'univ', name: '대학영어', sort_order: 40, is_active: false },
  { slug: 'suneung', name: '수능', sort_order: 50, is_active: false },
  { slug: 'etc', name: '기타', sort_order: 90, is_active: false },
];
