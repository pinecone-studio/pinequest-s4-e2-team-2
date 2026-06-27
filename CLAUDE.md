@backend/AGENTS.md
@web/AGENTS.md

## Commit Rules
- Never commit or push on behalf of another team member
- Never add Co-Authored-By lines to commits
- All commits must be authored by the person doing the work

## Railway 512MB — Dependency анхааруулга
`backend/requirements.txt`-д package нэмэхдээ эхлээд шалга:
- `azure-cognitiveservices-speech` — **нэмэхгүй**. `tts_service.py` Azure-г зөвхөн `httpx` REST-ээр дууддаг. SDK хэрэггүй, ч ~200MB зай эзэлнэ.
- `pydub` — **нэмэхгүй**. Audio duration-д `mutagen` ашигладаг. `pydub` ашиглагддаггүй.
- `faster-whisper`, `yt-dlp`, `pyannote` — **огт нэмэхгүй**. Railway 512MB-д багтахгүй.
- ML/AI нэмэхийн өмнө суух хэмжээг нь шалгаж, team-тэй зөвлөлд.
