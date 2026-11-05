/**
 * 영단어 복습 퀴즈용 스키마 (onesentence 원본과 분리)
 */
import mongoose from 'mongoose';
import { QUIZ_POS } from '../lib/word-quiz-pos.js';

const MEANING_SOURCES = ['existing', 'gpt', 'manual'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];

export const wordQuizInfoSchema = new mongoose.Schema(
  {
    source_type: { type: String, required: true, index: true },
    source_id: { type: String, required: true },
    word: { type: String, required: true, index: true },
    pos: {
      type: String,
      enum: QUIZ_POS,
      required: true,
      index: true,
    },
    pos_source: { type: String, default: '' },
    quiz_meaning: { type: String, default: null, index: true },
    level: {
      type: String,
      enum: LEVELS,
      required: false,
      default: undefined,
      index: true,
    },
    example: { type: String, default: null },
    example_ko: { type: String, default: null },
    meaning_group: { type: String, default: null, index: true },
    meaning_checked: { type: Boolean, default: false, index: true },
    meaning_source: {
      type: String,
      enum: MEANING_SOURCES,
      required: false,
      default: undefined,
    },
    content_url: { type: String, default: null },
    enabled: { type: Boolean, default: true, index: true },
  },
  {
    collection: 'word_quiz_info',
    timestamps: true,
  }
);

wordQuizInfoSchema.index({ source_type: 1, source_id: 1 }, { unique: true });
wordQuizInfoSchema.index({
  enabled: 1,
  quiz_meaning: 1,
  pos: 1,
  level: 1,
  meaning_checked: 1,
});

const optionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    wordQuizInfoId: { type: mongoose.Schema.Types.ObjectId, required: true },
    word: { type: String, required: true },
    options: { type: [optionSchema], default: [] },
    correctKey: { type: String, required: true },
    correctMeaning: { type: String, default: '' },
    contentUrl: { type: String, default: '' },
    answered: { type: Boolean, default: false },
    chosenKey: { type: String, default: null },
    correct: { type: Boolean, default: null },
  },
  { _id: false }
);

export const wordMeaningQuizSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    level: { type: String, default: 'all', index: true },
    questionCount: { type: Number, default: 10 },
    questions: { type: [questionSchema], default: [] },
    excludeWordIds: [{ type: mongoose.Schema.Types.ObjectId }],
    expiresAt: { type: Date, required: true },
  },
  {
    collection: 'word_meaning_quiz_sessions',
    timestamps: { createdAt: true, updatedAt: true },
  }
);

/* TTL: expiresAt 시각에 문서 삭제 (index:true 와 중복 선언하지 말 것) */
wordMeaningQuizSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

let WordQuizInfo;
let WordMeaningQuizSession;

export function getWordQuizInfoModel() {
  if (WordQuizInfo) return WordQuizInfo;
  WordQuizInfo =
    mongoose.models.WordQuizInfo ||
    mongoose.model('WordQuizInfo', wordQuizInfoSchema);
  return WordQuizInfo;
}

export function getWordMeaningQuizSessionModel() {
  if (WordMeaningQuizSession) return WordMeaningQuizSession;
  WordMeaningQuizSession =
    mongoose.models.WordMeaningQuizSession ||
    mongoose.model('WordMeaningQuizSession', wordMeaningQuizSessionSchema);
  return WordMeaningQuizSession;
}

export { MEANING_SOURCES, LEVELS, QUIZ_POS };
