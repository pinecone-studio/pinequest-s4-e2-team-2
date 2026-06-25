import { createHash } from "crypto";
import type { TranscriptSegment, YouTubeTranscript } from "@/lib/youtube-transcript";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.4-nano";
const PROMPT_VERSION = "mn-dub-v1";
const MAX_BATCH_SEGMENTS = 30;
const MAX_BATCH_CHARS = 3_000;
const MAX_RETRY_BATCH_SEGMENTS = 8;

const translationCache = new Map<string, YouTubeTranscriptTranslation>();

export type TranslatedTranscriptSegment = {
  index: number;
  start: number;
  duration: number;
  end: number;
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
};

export type YouTubeTranscriptTranslation = {
  videoId: string;
  sourceLanguage: string;
  targetLanguage: string;
  model: string;
  promptVersion: string;
  transcriptHash: string;
  cached: boolean;
  segments: TranslatedTranscriptSegment[];
};

type TranslationBatchItem = {
  index: number;
  text: string;
};

type OpenAIResponsePayload = {
  output_text?: unknown;
  output?: unknown;
  error?: {
    message?: unknown;
  };
};

function getOpenAIModel() {
  return process.env.OPENAI_TRANSLATION_MODEL?.trim() || DEFAULT_MODEL;
}

function getTranscriptHash(transcript: YouTubeTranscript) {
  const stablePayload = transcript.segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text,
  }));

  return createHash("sha256").update(JSON.stringify(stablePayload)).digest("hex").slice(0, 24);
}

function getCacheKey(
  transcript: YouTubeTranscript,
  targetLanguage: string,
  model: string,
  transcriptHash: string,
) {
  return [
    transcript.videoId,
    transcript.language,
    targetLanguage,
    model,
    PROMPT_VERSION,
    transcriptHash,
  ].join(":");
}

function getBatches(segments: TranscriptSegment[]) {
  const batches: TranslationBatchItem[][] = [];
  let current: TranslationBatchItem[] = [];
  let currentChars = 0;

  segments.forEach((segment, index) => {
    const item = { index, text: segment.text };
    const itemChars = segment.text.length;
    const shouldFlush =
      current.length > 0 &&
      (current.length >= MAX_BATCH_SEGMENTS || currentChars + itemChars > MAX_BATCH_CHARS);

    if (shouldFlush) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(item);
    currentChars += itemChars;
  });

  if (current.length > 0) batches.push(current);
  return batches;
}

function chunkBatchItems(items: TranslationBatchItem[], size: number) {
  const chunks: TranslationBatchItem[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getOpenAIOutputText(payload: OpenAIResponsePayload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";

  return payload.output
    .flatMap((outputItem) => {
      if (!outputItem || typeof outputItem !== "object") return [];

      const content = (outputItem as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];

      return content.flatMap((contentItem) => {
        if (!contentItem || typeof contentItem !== "object") return [];

        const text = (contentItem as { text?: unknown }).text;
        return typeof text === "string" ? [text] : [];
      });
    })
    .join("\n")
    .trim();
}

function extractJsonText(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

function parseTranslationJson(value: string) {
  const parsed = JSON.parse(extractJsonText(value)) as unknown;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI translation response was not a JSON object.");
  }

  const segments = (parsed as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) {
    throw new Error("OpenAI translation response did not include a segments array.");
  }

  return segments;
}

function getTranslatedTextMap(responseText: string, batch: TranslationBatchItem[]) {
  const parsedSegments = parseTranslationJson(responseText);
  const translated = new Map<number, string>();

  parsedSegments.forEach((item) => {
    if (!item || typeof item !== "object") return;

    const index = (item as { index?: unknown }).index;
    const text = (item as { text?: unknown }).text;

    if (typeof index === "number" && typeof text === "string") {
      translated.set(index, text.trim());
    }
  });

  return translated;
}

function getMissingItems(batch: TranslationBatchItem[], translated: Map<number, string>) {
  return batch.filter((item) => !translated.get(item.index)?.trim());
}

async function translateBatch(
  batch: TranslationBatchItem[],
  sourceLanguage: string,
  targetLanguage: string,
  model: string,
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: [
        "Translate transcript segments into natural Mongolian Cyrillic for voice dubbing.",
        "Keep the same segment indexes and order. Do not merge, split, add, or remove segments.",
        "Preserve names, numbers, technical terms, and meaning. Make the Mongolian sound spoken, concise, and clear.",
        'Return only JSON with this exact shape: {"segments":[{"index":0,"text":"..."}]}.',
      ].join(" "),
      input: JSON.stringify({
        sourceLanguage,
        targetLanguage,
        segments: batch,
      }),
    }),
  });

  const payload = (await response.json()) as OpenAIResponsePayload;

  if (!response.ok) {
    const message =
      typeof payload.error?.message === "string"
        ? payload.error.message
        : `OpenAI translation failed with ${response.status}.`;
    throw new Error(message);
  }

  const outputText = getOpenAIOutputText(payload);
  if (!outputText) throw new Error("OpenAI translation returned an empty response.");

  return getTranslatedTextMap(outputText, batch);
}

async function translateBatchWithRecovery(
  batch: TranslationBatchItem[],
  sourceLanguage: string,
  targetLanguage: string,
  model: string,
) {
  const translated = await translateBatch(batch, sourceLanguage, targetLanguage, model);
  let missing = getMissingItems(batch, translated);

  if (missing.length === 0) return translated;

  console.warn("[youtube transcript translation retry]", {
    missingIndexes: missing.map((item) => item.index),
  });

  for (const retryBatch of chunkBatchItems(missing, MAX_RETRY_BATCH_SEGMENTS)) {
    const retryTranslation = await translateBatch(
      retryBatch,
      sourceLanguage,
      targetLanguage,
      model,
    );
    retryTranslation.forEach((text, index) => translated.set(index, text));
  }

  missing = getMissingItems(batch, translated);
  if (missing.length === 0) return translated;

  for (const item of missing) {
    try {
      const retryTranslation = await translateBatch([item], sourceLanguage, targetLanguage, model);
      retryTranslation.forEach((text, index) => translated.set(index, text));
    } catch {
      // Fall back below so one stubborn segment does not fail the whole video.
    }
  }

  missing = getMissingItems(batch, translated);
  if (missing.length > 0) {
    console.warn("[youtube transcript translation fallback]", {
      missingIndexes: missing.map((item) => item.index),
    });

    missing.forEach((item) => translated.set(item.index, item.text));
  }

  return translated;
}

export async function translateTranscriptToMongolian(
  transcript: YouTubeTranscript,
  targetLanguage = "mn",
): Promise<YouTubeTranscriptTranslation> {
  const model = getOpenAIModel();
  const transcriptHash = getTranscriptHash(transcript);
  const cacheKey = getCacheKey(transcript, targetLanguage, model, transcriptHash);
  const cached = translationCache.get(cacheKey);

  if (cached) return { ...cached, cached: true };

  const translatedTexts = new Map<number, string>();
  const batches = getBatches(transcript.segments);

  for (const batch of batches) {
    const translatedBatch = await translateBatchWithRecovery(
      batch,
      transcript.language,
      targetLanguage,
      model,
    );
    translatedBatch.forEach((text, index) => translatedTexts.set(index, text));
  }

  const translation: YouTubeTranscriptTranslation = {
    videoId: transcript.videoId,
    sourceLanguage: transcript.language,
    targetLanguage,
    model,
    promptVersion: PROMPT_VERSION,
    transcriptHash,
    cached: false,
    segments: transcript.segments.map((segment, index) => ({
      index,
      start: segment.start,
      duration: segment.duration,
      end: segment.end,
      sourceText: segment.text,
      translatedText: translatedTexts.get(index) ?? segment.text,
      sourceLanguage: segment.language,
      targetLanguage,
    })),
  };

  translationCache.set(cacheKey, translation);
  return translation;
}
