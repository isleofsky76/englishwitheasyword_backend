-- =====================================================================
-- 시사영단어 04 수험영어 : 단어 DB 스키마 (MySQL / MariaDB 기준)
-- PostgreSQL을 쓰면: AUTO_INCREMENT → GENERATED ALWAYS AS IDENTITY,
--                     RAND() → RANDOM(), ON UPDATE 구문은 트리거로 대체
-- =====================================================================

-- 1) 분류: 초등 / 중등 / 고등 / 대학 / 수능 / 토익 / 기타 …
--    행만 추가하면 페이지 탭이 자동으로 늘어납니다 (코드 수정 불필요)
CREATE TABLE exam_categories (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  slug        VARCHAR(30)  NOT NULL UNIQUE,      -- URL용: elem, middle, high, univ, suneung, toeic, etc
  name        VARCHAR(50)  NOT NULL,             -- 화면 표시: 초등영어
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1
);

-- 2) 단어
CREATE TABLE exam_words (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  word           VARCHAR(100) NOT NULL,
  meaning        VARCHAR(200) NOT NULL,          -- 4지선다에 쓰는 대표 뜻 (짧게)
  part_of_speech VARCHAR(20)  NULL,              -- n. v. adj. adv. …
  phonetic       VARCHAR(100) NULL,              -- /smaɪl/
  example_en     VARCHAR(500) NULL,
  example_ko     VARCHAR(500) NULL,
  cefr           VARCHAR(5)   NULL,              -- A1 ~ C2 (선택)
  source         VARCHAR(100) NULL,              -- 2022 개정 기본어휘, 직접 작성 등
  is_active      TINYINT(1)   NOT NULL DEFAULT 1, -- 0이면 출제 안 함 (삭제 대신 숨김)
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_word_meaning (word, meaning)
);

-- 3) 단어 ↔ 분류 (다대다: 한 단어가 '고등'과 '수능'에 동시에 들어갈 수 있음)
CREATE TABLE exam_word_categories (
  word_id      INT NOT NULL,
  category_id  INT NOT NULL,
  PRIMARY KEY (word_id, category_id),
  KEY idx_cat (category_id),
  FOREIGN KEY (word_id)     REFERENCES exam_words(id)      ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES exam_categories(id) ON DELETE CASCADE
);

-- 기본 분류
INSERT INTO exam_categories (slug, name, sort_order) VALUES
  ('elem',    '초등영어', 10),
  ('middle',  '중등영어', 20),
  ('high',    '고등영어', 30),
  ('univ',    '대학영어', 40),
  ('suneung', '수능',     50),
  ('etc',     '기타',     90);

-- =====================================================================
-- API가 실행할 쿼리
-- =====================================================================

-- GET /api/exam/categories
-- SELECT slug, name FROM exam_categories WHERE is_active = 1 ORDER BY sort_order;

-- GET /api/exam/words?cat=middle&limit=40   (랜덤)
-- SELECT w.id, w.word, w.meaning, w.phonetic
--   FROM exam_words w
--   JOIN exam_word_categories wc ON wc.word_id = w.id
--   JOIN exam_categories c       ON c.id = wc.category_id
--  WHERE c.slug = ? AND c.is_active = 1 AND w.is_active = 1
--  ORDER BY RAND()
--  LIMIT ?;          -- limit은 서버에서 최대 100으로 제한
-- (분류당 수만 개 이하라면 ORDER BY RAND()로 충분합니다)

-- =====================================================================
-- 단어 업데이트 예시
-- =====================================================================
-- 뜻 수정:   UPDATE exam_words SET meaning = '미소 짓다, 웃다' WHERE word = 'smile';
-- 출제 제외: UPDATE exam_words SET is_active = 0 WHERE word = 'beer';
-- 분류 추가: INSERT INTO exam_word_categories (word_id, category_id)
--            SELECT w.id, c.id FROM exam_words w, exam_categories c
--             WHERE w.word = 'abandon' AND c.slug = 'suneung';
-- CSV 일괄 등록: exam_words_seed.csv (word,meaning,category) → 임시 테이블에 LOAD 후 INSERT … SELECT
