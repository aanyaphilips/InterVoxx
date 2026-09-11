-- SQLite schema for persistent InterVox interview sessions.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  pursuing TEXT NOT NULL,
  company TEXT NOT NULL,
  field TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  resume_filename TEXT NOT NULL,
  resume_screening_status TEXT NOT NULL CHECK (
    resume_screening_status IN ('pending', 'accepted', 'rejected')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  status TEXT NOT NULL CHECK (
    status IN ('started', 'completed', 'terminated')
  ),
  qualification_score INTEGER CHECK (
    qualification_score BETWEEN 0 AND 100
  ),
  decision TEXT CHECK (
    decision IN ('qualified', 'not_qualified', 'incomplete')
  ),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id),
  question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 4),
  question_text TEXT NOT NULL,
  transcript TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, question_number)
);

CREATE TABLE IF NOT EXISTS answer_scores (
  answer_id INTEGER PRIMARY KEY REFERENCES answers(id),
  correctness INTEGER NOT NULL CHECK (correctness BETWEEN 0 AND 100),
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  vocabulary INTEGER NOT NULL CHECK (vocabulary BETWEEN 0 AND 100),
  communication INTEGER NOT NULL CHECK (communication BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_sessions_candidate
  ON interview_sessions(candidate_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_answers_session
  ON answers(session_id, question_number);