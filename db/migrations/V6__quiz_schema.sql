-- V6: owner-only English-passage quiz schema in PiePad.

CREATE TABLE quiz_passages (
  id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      VARCHAR2(500) NOT NULL,
  body       CLOB          NOT NULL,
  keywords   CLOB,
  created_at TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE quiz_daily (
  day           DATE   PRIMARY KEY,
  correct_count NUMBER NOT NULL
);

CREATE TABLE quiz_config (
  id         NUMBER PRIMARY KEY CHECK (id = 1),
  blank_pct  NUMBER NOT NULL CHECK (blank_pct BETWEEN 0 AND 100),
  first_pct  NUMBER DEFAULT 50 NOT NULL CHECK (first_pct BETWEEN 0 AND 100),
  recite_pct NUMBER DEFAULT 0 NOT NULL CHECK (recite_pct BETWEEN 0 AND 100),
  CONSTRAINT quiz_config_pct_sum CHECK (blank_pct + first_pct + recite_pct = 100)
);

INSERT INTO quiz_config (id, blank_pct, first_pct, recite_pct) VALUES (1, 50, 50, 0);
