# InterVox multi-language companion layer

The InterVox browser app is the candidate-facing interface. This folder contains
small, dependency-free reference implementations for the core assessment signals
in the languages requested for the project:

- `python/resume_screening.py` — validates the resume file signal and extracts
  readable text from plain text and DOCX files.
- `java/InterviewScorer.java` — scores an answer for relevance, confidence,
  vocabulary, and communication using a transparent local rubric.
- `cpp/VoiceMetrics.cpp` — estimates pace, filler-word frequency, and a
  confidence signal from a transcript and duration.
- `sql/schema.sql` — SQLite schema for candidates, interview sessions, answers,
  and score breakdowns.

These are educational companion modules for the prototype, not a replacement
for production AI evaluation or a forensic resume-authenticity service.

## Quick starts

```bash
python3 python/resume_screening.py path/to/resume.pdf

javac java/InterviewScorer.java
java -cp java InterviewScorer 2 "I would clarify the requirement with the stakeholder and write down a plan."

g++ -std=c++17 -O2 cpp/VoiceMetrics.cpp -o /tmp/intervox-voice-metrics
/tmp/intervox-voice-metrics 42 "I would, um, clarify the requirement and communicate the plan."

sqlite3 /tmp/intervox.db < sql/schema.sql
```

The web app itself uses React and TypeScript because it runs in the browser and
needs direct access to camera, microphone, speech, and tab visibility APIs.