# 04 수험영어 (exam words)

초·중·고 기본 어휘 4지선다. DB는 **MongoDB** (`exam_categories`, `exam_words`, `exam_word_categories`).

## API

- `GET /api/exam/categories` → `{ categories: [{ slug, name }] }`
- `GET /api/exam/words?cat=elem&limit=40` → `{ words: [{ id, word, meaning, ... }] }`
- 잘못된/비활성 `cat` → `404 { "error": "category_not_found" }`

프런트: `exam-words.html` (API 실패 시 예비 단어로 동작)

## 분류 추가

```js
// mongosh 또는 스크립트
db.exam_categories.insertOne({
  slug: 'suneung',
  name: '수능',
  sort_order: 50,
  is_active: true
});
// 단어 연결 후 탭이 자동으로 생김 (코드 수정 없음)
```

비활성(`is_active: false`)이면 탭에 안 나옵니다. `univ` / `suneung` / `etc`는 기본 비활성입니다.

## 단어 수정

```js
db.exam_words.updateOne(
  { word: 'smile' },
  { $set: { meaning: '미소 짓다, 웃다' } }
);
// 출제 제외
db.exam_words.updateOne({ word: 'a' }, { $set: { is_active: false } });
```

다음 API 요청부터 반영됩니다.

## CSV 가져오기

형식: `word,meaning,category[,phonetic,example_en,example_ko]`  
(또는 seed CSV의 `is_active` 열 포함)

```bash
cd backend
node scripts/import_words.js --file=db/seeds/basic_vocab_2022_3000.csv
node scripts/import_words.js --file=path/to/words.csv --dry-run
```

- `(word, meaning)` 같으면 갱신
- 분류 연결은 upsert (중복 무시)
- 출처 기본값: `2022 개정 기본어휘`

## 시드 기대값

| 분류 | 연결 수 |
|------|---------|
| 초등영어 | 800 |
| 중등영어 | 1200 |
| 고등영어 | 1000 |

기능어 등은 `is_active: false`로 들어가 출제에서 제외됩니다.
