Aalto AI at Work project.

## Quick Start Guide (Windows, macOS/Linux)

This project includes a backend (Python/FastAPI) and a frontend (Vite + React). Run them in two terminals.

### Prerequisites
- Python 3.10+
- Node.js (version specified in `front/.nvmrc`)
- Package managers: `pip`, `npm`

### Environment Setup (required)
Create two `.env` files before starting:

1) Project root `.env` (same folder as `requirements.txt`):

```
OPENAI_API_KEY= 'your openai api key'
GEMINI_API_KEY= 'your gemini api key'
```

2) Frontend `.env` (inside `front/`):

```
VITE_API_URL=http://localhost:8000
```

### Backend: Start FastAPI (run in project root)
Per team convention, always activate `.venv` before installing anything.

- Windows PowerShell:

```powershell
cd <your-project-path>  # e.g. C:\path\to\AI-Assistant-for-MARITIME-PILOT
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- macOS/Linux (bash/zsh):

```bash
cd <your-project-path>  # e.g. ~/dev/AI-Assistant-for-MARITIME-PILOT
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open API docs: `http://localhost:8000/docs`

### Frontend: Start Vite Dev Server (run in front/)

```bash
cd <your-project-path>/front
npm ci
npm run dev
```

Open the app: `http://localhost:5173`

### Project Structure

Frontend (`front/`)
- `src/components/MaritimePilotReport.tsx`: Main UI for the report and chat flow.
- `src/components/VoiceControls.tsx`: Voice record/send controls.
- `src/components/ui/*`: Reusable UI primitives (button, input, select, etc.).
- `src/config/api.ts`: API endpoints and `getApiUrl` helper (reads `VITE_API_URL`).
- `src/services/voiceService.ts`: Frontend voice utilities.
- `src/App.tsx` / `src/main.tsx`: App composition and bootstrapping.

Backend (`app/`)
- `main.py`: FastAPI app factory, CORS, and router registration.
- `routers/chat.py`: `POST /chat` endpoint; routes chat to OpenAI/Gemini and returns updates.
- `routers/voice.py`: Voice-related routes (STT/TTS orchestration entrypoints).
- `services/openai_service.py`: OpenAI client, chat completion, function-calling schema.
- `services/gemini_service.py`: Gemini client and chat completion.
- `services/voice_service.py`: Chained voice pipeline (STT -> Chat -> TTS).
- `models/schemas.py`: Pydantic request/response models.
- `core/prompts.py`: System prompts by AI roles.
- `Dockerfile` (in `app/`): Backend container build (optional for local dev).
