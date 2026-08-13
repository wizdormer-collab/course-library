# AGENTS.md

## User instructions file
- When the user says **"check instructions file"** (or similar), read
  `C:\Users\WISDOM\Downloads\opencode instructions.txt` for the latest
  prompt/instruction/credential before acting.
- The user cannot reliably paste into this terminal; that file is their way
  to give me instructions, API keys, etc.

## Project
- Zero-dependency Node.js (built-ins only; no npm). Static frontend in `public/`.
- Data + uploads in `data.json` / `uploads/` (auto-seeded from `seed-data.json`
  if missing; `DATA_DIR` env overrides location).
- Test suite: `node test.js` (spawns its own server on port 3999; writes
  `test-results.txt`). Shell is slow — always redirect server output to files.
- Render deploy: `Dockerfile` + `render.yaml` (blueprint). Public URL should be
  `https://course-library.onrender.com`.
