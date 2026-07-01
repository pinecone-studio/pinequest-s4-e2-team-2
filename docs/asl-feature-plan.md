# ASL дохионы хэл (Sign Language Avatar) feature — хэрэгжүүлэх төлөвлөгөө

## Context (яагаад, юу хийх гэж байгаа вэ)

Helex апп дүлий хэрэглэгчдэд зориулж, монгол subtitle-тэй **нэгэн зэрэг** дэлгэцийн баруун доод буланд ASL (дохионы хэл) gesture үзүүлэх feature нэмнэ. Энэ нь одоо байгаа subtitle/dub синхрон системтэй яг адил зарчмаар (segment.start, segment.duration) ажиллана — зөвхөн audio/text оронд **видео клип** тоглуулна.

WLASL (Word-level American Sign Language) dataset нь үг тус бүрийн дохионы видео клипийн **эх сурвалж**. Энэ dataset нь зөвхөн metadata (YouTube эх видео + frame range) өгдөг тул бодит клипийг урьдчилан гаргаж аваад хадгалах ёстой — энэ бол **нэг удаагийн, offline бэлтгэл ажил**, Railway/Render backend дотор хийгдэхгүй (CLAUDE.md-ийн 512MB дүрэм + `yt-dlp` хориотой жагсаалттай мөргөлдөнө).

---

## Ажлын 3 том шат

### Шат 1 — Dataset бэлтгэл (Offline, нэг удаа, deploy-д ОРОХГҮЙ)

**Хэн хийх вэ:** Backend-тэй хүн (эсвэл dataset/ML даалгавар авсан хүн), өөрийн **локал компьютер** дээр ажиллуулна. Railway/Render-д энэ алхам ХЭЗЭЭ Ч deploy хийгдэхгүй.

**Юу хийх вэ:**
1. WLASL metadata (JSON) татах — https://github.com/dxli94/WLASL дотроос `WLASL_v0.3.json` гэх мэт файл. Энэ нь `{gloss: "hello", instances: [{video_id, url, frame_start, frame_end, ...}]}` хэлбэртэй.
2. **Эхний шатанд бүх ~2000 үгийг биш, хамгийн элбэг хэрэглэгддэг ~150-300 үгийг сонгож эхлэх** (жишээ: hello, thank you, yes, no, please, help, video, watch, гэх мэт нийтлэг үгс). Энэ нь scope-ийг удирдахуйц хэмжээнд барина.
3. Үг тус бүрийн эх видеог татаж, `frame_start`-`frame_end` мужаар таслаж богино клип (`.mp4`) болгоно.
4. Гарсан клип бүрийг **Firebase Storage**-д upload хийнэ (`asl_clips/{word}.mp4` зам, public URL).
5. Firestore-д шинэ `asl_clips` коллекц үүсгэж, `{word, public_url, duration_seconds, source: "wlasl"}` бичнэ.

**Reuse хийх зүйл:** `backend/app/services/firebase_service.py:get_storage_bucket()` — энэ бол одоо байгаа Firebase Storage upload механизм (`storage_service.py:store_audio()`-тэй ижил pattern). Шинэ зүйл зохиох шаардлагагүй, зөвхөн video файл upload хийхэд адилхан ашиглана.

**Script байрлах газар:** `scripts/wlasl_prepare.py` (шинэ фолдер, `backend/` дотор биш — учир нь энэ нь Railway deploy-ийн нэг хэсэг биш, нэг удаа ажиллуулдаг туслах script).

---

### Шат 2 — Backend: үг → клип хайх lookup service

**Хэн хийх вэ:** Backend.

**Юу хийх вэ:**
1. `backend/app/services/asl_service.py` (шинэ файл) — Firestore `asl_clips` коллекцоос үг хайх функц: `get_clip_for_word(word: str) -> dict | None`.
2. Caption segment-ийн текстийг үг болгон задлах: энгийн `text.lower().split()` + цэг таслал арилгах (regex) — **NLTK/spaCy шиг хүнд library хэрэггүй**, энгийн regex хангалттай.
3. `backend/app/routers/pipeline.py`-д (эсвэл шинэ `backend/app/routers/asl.py`) нэг endpoint нэмнэ: segment-уудыг хүлээж аваад, segment тус бүрийн үгсийг ASL клиптэй тааруулж, `{segment_index, words: [{word, clip_url, duration_seconds}]}` массив буцаана.
4. **Үг тус бүрийн цаг тооцоолол**: segment дотор олон үг таарвал, `segment.duration`-г тэдгээр үгийн тоонд жигд хуваана (энгийн heuristic) — жишээ: 3 секундын segment-д 3 үг таарвал, тус бүр 1 секунд авна.
5. Cache: ижил видеог дахин боловсруулахдаа дахин tokenize/lookup хийхгүй байхын тулд `cache_service.py`-ийн `get_cached_video`/`cache_video`-той адил зарчмаар (эсвэл шууд мөн функцийг) ашиглаж болно.

**Reuse хийх зүйл:**
- `backend/app/services/cache_service.py:get_cached_video/cache_video` — кэш хадгалах загвар
- `backend/app/services/firebase_service.py:get_firestore_client()` — Firestore хандалт

---

### Шат 3 — Frontend: PiP avatar харуулах

**Хэн хийх вэ:** Frontend.

**Юу хийх вэ:**
1. `web/src/_comps/dashboard/useASLAvatar.ts` (шинэ hook) — `useDubAudio.ts`-тэй яг ижил зарчмаар:
   - `videoId`, `currentTime` (player.time), `aslSegments`-г parameter авна
   - Идэвхтэй segment олох: `segments.find(s => currentTime >= s.start && currentTime < s.start + s.duration)` (яг `SubtitlePane.tsx:18`, `useDubAudio.ts:159` дээрх логиктой адил)
   - Тухайн segment доторх идэвхтэй үгийг (тооцоолсон цагийн дагуу) олж, харгалзах `clip_url`-г буцаана
2. `web/src/_comps/dashboard/ASLAvatar.tsx` (шинэ компонент) — жижиг `<video>` элемент, идэвхтэй clip URL өөрчлөгдөх бүрд `src` шинэчилж autoplay хийнэ.
3. `web/src/_comps/dashboard/VideoFrame.tsx`-д `ASLAvatar`-г sibling болгож нэмнэ (`.dashboard-youtube-container`-тэй зэрэгцээ), CSS:
   ```css
   .dashboard-asl-avatar {
     position: absolute;
     bottom: 16px;
     right: 16px;
     width: 180px;
     height: 240px;
     z-index: 5;
   }
   ```
   (`.dashboard-process-overlay` (dashboard.css:461-475) яг ижил `position: absolute; inset` загварыг баруун доод буланд тааруулж ашиглана.)
4. `DashboardView.tsx`-д `useASLAvatar`-г дуудаж, `player.time`-г `SubtitlePane`-д дамжуулдагтай ижил байдлаар дамжуулна.

**Reuse хийх зүйл:**
- `web/src/_comps/dashboard/useDubAudio.ts` — segment-by-time lookup логик
- `web/src/_comps/dashboard/SubtitlePane.tsx:17-24` — `useMemo` + `find()` загвар
- `.dashboard-process-overlay` CSS pattern (dashboard.css:461-475) — absolute positioning загвар

---

## Дараалал (team-д зориулсан товч алхам)

```
1. [Offline, 1 хүн] WLASL metadata татах → ~150-300 элбэг үг сонгох
2. [Offline] Үг тус бүрийн клип таслаж Firebase Storage-д upload
3. [Offline] Firestore "asl_clips" коллекц бичих (word → public_url)
   ── эндээс хойш Railway/Render deploy-той холбоотой ──
4. [Backend] asl_service.py — Firestore lookup функц бичих
5. [Backend] Caption segment → үг задлах + клиптэй тааруулах endpoint
6. [Frontend] useASLAvatar hook (useDubAudio-тэй ижил загвар)
7. [Frontend] ASLAvatar.tsx PiP компонент + VideoFrame-д залгах
8. [Тест] Нэг видео дээр subtitle + dub + ASL avatar нэгэн зэрэг ажиллаж байгааг шалгах
```

---

## Verification (хэрхэн шалгах)

1. **Backend единл тест**: `asl_service.get_clip_for_word("hello")` локал дээр дуудаж, Firestore-оос зөв URL буцааж байгааг шалгах
2. **Backend integration**: жишээ caption segment-ийг endpoint-д явуулж, үг бүрд clip_url зөв таарч байгааг шалгах (зарим үг WLASL-д байхгүй бол `null`/skip хийдэг эсэхийг шалгах)
3. **Frontend**: dashboard дээр видео сонгож, subtitle харагдаж байх үед баруун доод буланд ASL клип тоглож байгааг нүдээр шалгах, цагийн синхрон зөв эсэхийг шалгах (segment солигдох үед клип ч мөн солигдох ёстой)
4. **Edge case**: WLASL-д байхгүй үг тохиолдоход (доголдол) avatar юу үзүүлэх вэ (хоосон/skip эсвэл "no sign" indicator) — багийн хооронд тохиролцох шаардлагатай

---

## Нээлттэй шийдвэрлэх асуудлууд (баг дотроо ярилцах)

- WLASL дотор байхгүй үгийг яаж зохицуулах вэ (algoritmaar synonim хайх уу, эсвэл зүгээр алгасах уу)?
- Эхний MVP-д хэдэн үг (150 vs 300 vs илүү) хамруулах вэ?
- Dataset бэлтгэх ажлыг хэн хариуцах вэ (offline, цаг хугацаа шаардсан ажил)?
