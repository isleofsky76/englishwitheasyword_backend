import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerRankingApi } from '../ranking-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
await mongoose.connect(uri);

const oneSentenceCommentSchema = new mongoose.Schema(
  { wordKey: String, word: String, body: String, date: Date },
  { collection: 'onesentencecomments' }
);
const boardCommentSchema = new mongoose.Schema(
  { board: String, body: String, date: Date },
  { collection: 'boardcomments' }
);
const OneSentenceComment =
  mongoose.models.OneSentenceComment ||
  mongoose.model('OneSentenceComment', oneSentenceCommentSchema);
const BoardComment =
  mongoose.models.BoardComment || mongoose.model('BoardComment', boardCommentSchema);

const api = registerRankingApi({ get: () => {}, post: () => {} }, {});
const n = await api.backfillFromComments({ OneSentenceComment, BoardComment });
console.log({ backfilled: n });
await mongoose.disconnect();
