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

For local development, prefer one of these Firebase Admin options:

```env
FIREBASE_CREDENTIALS_PATH=H:\ajil\Coding\sightahead\backend\secrets\firebase-adminsdk.json
```

For Railway or any hosted environment, do not use a local Windows file path.
Set the full service account JSON as a secret instead:

```env
FIREBASE_CREDENTIALS_JSON={...full Firebase service account JSON...}
FIREBASE_CREDENTIALS_PATH=
```

If the host has trouble with raw JSON, base64-encode the same JSON and set:

```env
FIREBASE_CREDENTIALS_JSON_BASE64=...
FIREBASE_CREDENTIALS_PATH=
```

## 5. Run the API

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Health check:

```text
http://127.0.0.1:8000/health
```
