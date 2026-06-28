# Монгол F5-TTS — voice cloning сургалт

Зорилго: F5-TTS-ийг Монгол хэлээр fine-tune хийж, оригинал илтгэгчийн
хоолойгоор монголоор ярих (cloning) болгох.

## Урсгал (overview)

```
1. Common Voice (mn) татах        ← ЧИ (гараар)
2. F5 формат руу хөрвүүлэх         ← prepare_commonvoice.py (бэлэн)
3. F5 arrow dataset болгох         ← F5-ийн prepare_csv_wavs.py
4. GPU дээр fine-tune              ← ЧИ (Colab/cloud)
5. Апп-ийн pipeline-д интеграц     ← дараа нь
```

---

## Алхам 1 — Common Voice (mn) татах  [ЧИ]

1. https://commonvoice.mozilla.org/en/datasets нээ
2. **Language: Mongolian** сонго
3. Email оруулж, нөхцөл зөвшөөрөөд **Download** дар (`.tar.gz`, том файл)
4. Задлах → дотор нь иймэрхүү бүтэц гарна:
   ```
   cv-corpus-XX.0-YYYY-MM-DD/mn/
     clips/            (олон .mp3)
     validated.tsv     (баталгаажсан: path + sentence)
     train.tsv / dev.tsv / test.tsv / other.tsv
   ```

## Алхам 2 — F5 формат руу хөрвүүлэх  [скрипт бэлэн]

Шаардлага: **ffmpeg** + `pip install pandas tqdm`

```bash
python mn-tts/prepare_commonvoice.py \
  --cv-dir "<задалсан зам>/cv-corpus-XX.0-.../mn" \
  --out    "<гаралт>/mn_f5" \
  --tsv    validated.tsv
```

Туршихаар эхлээд бага хэмжээгээр:  `--limit 200`

Гаралт:
```
mn_f5/
  wavs/<id>.wav      (24kHz mono)
  metadata.csv       ("wavs/<id>.wav|монгол текст")
```

Скрипт нь: mp3→wav (24kHz mono), 1-15 сек шүүлт, Кирилл бус давамгай
текст хаях, Монгол текст нормчлох зэргийг хийнэ.

## Алхам 3 — F5 arrow dataset болгох  [F5 repo дотор]

```bash
git clone https://github.com/SWivid/F5-TTS
cd F5-TTS && pip install -e .

# Бэлдсэн dataset-аа F5-ийн custom формат руу
python src/f5_tts/train/datasets/prepare_csv_wavs.py \
  <гаралт>/mn_f5  data/mn_custom
```

## Алхам 4 — Fine-tune  [ЧИ, GPU]

Хамгийн хялбар нь Gradio finetune UI:
```bash
f5-tts_finetune-gradio
```
Эсвэл Colab дээр GPU-тай. (Тохиргоо, notebook-ийг дараагийн алхамд бэлдэнэ.)

Зөвлөмж: base model дээрээс **fine-tune** (scratch-аас биш). Эхэндээ
цөөн алхам (~few k steps) ажиллуулж дуу гарч байгааг шалга.

## Алхам 5 — Интеграц  [дараа нь]

Сургасан загвараар: pyannote → оригинал хоолойн вектор → F5 монгол TTS
→ дубляж. Backend `tts_service`-д адаптер нэмнэ.

---

## Дата чанарын зөвлөмж (best result)

- Цэвэр, чимээ багатай клип > их хэмжээний шуугиантай
- Олон илтгэгч = cloning сайжирна
- 24kHz, mono, 1-15 сек
- Хэмжээ: эхлэлд хэдэн цаг, чанарт 10-100+ цаг
- Дараа нь YouTube + Whisper-ээр хэмжээ нэмж болно (augment)
