# SightAhead / HELEX — Deploy тохиргоо

Frontend → **Vercel**, Backend → **Render**, DB/Auth → **Firebase**.

| Зүйл | Утга |
|------|------|
| Frontend URL | https://helex-sigma.vercel.app |
| Backend URL | https://helex-backend.onrender.com |
| Firebase project | `helex-95cfc` |
| Storage bucket | `helex-95cfc.firebasestorage.app` |

---

## 1. Vercel (frontend — `web/`)

**Settings → General**
- Framework Preset: **Next.js**
- Root Directory: **`web`**
- Build Command: **`next build --webpack`**
  - ⚠️ Default `next build` нь Turbopack ашигладаг → `yt-search` багц багцлагдахгүй болж YouTube search 502 алдаа өгдөг. Заавал `--webpack`.
  - (Эсвэл Build Command override-ийг унтрааж `npm run build` ашиглуул — package.json дотор аль хэдийн `next build --webpack` болгосон.)

**Settings → Environment Variables**
```
NEXT_PUBLIC_API_BASE_URL=https://helex-backend.onrender.com
NEXT_PUBLIC_FIREBASE_API_KEY=<firebase web api key>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=helex-95cfc.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=helex-95cfc
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=helex-95cfc.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<sender id>
NEXT_PUBLIC_FIREBASE_APP_ID=<app id>
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=<measurement id>
```
> Локал `.env.local` Vercel-д автоматаар очдоггүй — эдгээрийг dashboard дээр гараар нэмнэ.

main-д merge хийхэд Vercel автоматаар redeploy хийдэг. Болоогүй бол: **Deployments → ⋯ → Redeploy**.

---

## 2. Render (backend — `backend/`)

**Settings**
- Root Directory: **`backend`**
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

**Environment**
```
ENVIRONMENT=production
CORS_ORIGINS=https://helex-sigma.vercel.app,https://helex-flax.vercel.app,http://localhost:3000
FIREBASE_PROJECT_ID=helex-95cfc
FIREBASE_STORAGE_BUCKET=helex-95cfc.firebasestorage.app
FIREBASE_CREDENTIALS_JSON=<firebase service account JSON-ийг НЭГ МӨР болгож>
GEMINI_API_KEY=<gemini key>
HF_TOKEN=<huggingface token, байгаа бол>
```
> ⚠️ Render дээр `FIREBASE_CREDENTIALS_PATH` ажиллахгүй (JSON файл git-д ороогүй). Заавал `FIREBASE_CREDENTIALS_JSON`-д агуулгыг нь нэг мөр болгож тавина.

---

## 3. Firebase Console (`helex-95cfc`)

**Authentication → Sign-in method**
- ✅ Email/Password — Enable
- ✅ Google — Enable

**Authentication → Settings → Authorized domains**
- `helex-sigma.vercel.app` нэмэх (Google login-д заавал)

**Demo хэрэглэгч** (заавал биш): Authentication → Users → Add user
- `demo@moncast.app` / `demo1234` (эсвэл `web/.env.local`-д `NEXT_PUBLIC_DEMO_EMAIL/PASSWORD`)

---

## Шалгах (deploy дууссаны дараа)

```bash
# Backend амьд эсэх
curl https://helex-backend.onrender.com/health

# YouTube search ажиллаж байгаа эсэх (502 биш, results ирэх ёстой)
curl "https://helex-sigma.vercel.app/api/youtube/search?q=test"
```
