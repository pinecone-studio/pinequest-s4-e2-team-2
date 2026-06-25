# Backend Local Setup

## 1. Create a virtual environment

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, use the venv Python directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 2. Install core dependencies

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`requirements.txt` contains the packages needed to run the FastAPI API,
Firebase Auth verification, Firestore access, YouTube caption fetching, and
Gemini summary calls.

## 3. Optional local AI dependencies

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ai.txt
```

`requirements-ai.txt` contains heavier local processing packages:

- `faster-whisper`
- `pyannote.audio`
- `TTS`

On Windows, `TTS` can require Microsoft C++ Build Tools. The API can still run
without these packages while the local audio pipeline is being designed.

## 4. Environment variables

```powershell
copy .env.example .env
```

Fill the Firebase and AI keys in `.env`.

## 5. Run the API

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Health check:

```text
http://127.0.0.1:8000/health
```
