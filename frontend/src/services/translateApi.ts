import api from './api';

export interface TranslateResponse {
  translations: string[];
}

export interface WordExample {
  en: string;
  zh: string;
}

export interface WordExplanationItem {
  word: string;
  phonetic: string;
  context_sentence: string;
  context_sentence_zh: string;
  pos: string;
  definition_en: string;
  definition_zh: string;
  examples: WordExample[];
}

export interface ExplainWordResponse {
  words: string[];
  explanations: WordExplanationItem[];
}

export async function explainWords(
  words: string[],
  context: string,
  apiKey?: string
): Promise<ExplainWordResponse> {
  const t0 = performance.now();
  const { data } = await api.post<ExplainWordResponse>(
    '/translate/explain-word',
    { words, context, api_key: apiKey || undefined },
    { timeout: 120000 }  // 120s — multi-word parsing can take 40s+
  );
  const t1 = performance.now();
  console.log(
    `[TIMING] explainWords API call: ${(t1 - t0).toFixed(0)}ms ` +
    `for ${words.length} word(s): [${words.join(', ')}]`
  );
  return data;
}

const BATCH_SIZE = 5;

/**
 * Parse many words by splitting into concurrent batches.
 * Total time ≈ time of one batch (~15s), regardless of word count.
 * Each batch's results are merged as soon as that batch completes.
 */
export async function explainWordsInBatches(
  words: string[],
  context: string,
  apiKey: string,
  onBatchDone: (result: ExplainWordResponse) => void
): Promise<void> {
  // Split into batches
  const batches: string[][] = [];
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    batches.push(words.slice(i, i + BATCH_SIZE));
  }

  const t0 = performance.now();
  let completedCount = 0;

  // Fire all batches concurrently; merge each batch as it completes
  await Promise.all(
    batches.map((batch, idx) =>
      explainWords(batch, context, apiKey).then((result) => {
        const tArrive = performance.now();
        console.log(
          `[TIMING] Batch #${idx} arrived: +${(tArrive - t0).toFixed(0)}ms from start, ` +
          `${batch.length} words`
        );
        const tCbStart = performance.now();
        onBatchDone(result);
        const tCbEnd = performance.now();
        completedCount++;
        console.log(
          `[TIMING] Batch #${idx} onBatchDone callback: ${(tCbEnd - tCbStart).toFixed(1)}ms ` +
          `(${completedCount}/${batches.length} batches done)`
        );
      })
    )
  );

  const tEnd = performance.now();
  console.log(
    `[TIMING] explainWordsInBatches ALL done: ${(tEnd - t0).toFixed(0)}ms total, ` +
    `${words.length} words in ${batches.length} batch(es)`
  );
}

export async function translateParagraphs(
  paragraphs: string[],
  apiKey?: string,
  documentId?: string
): Promise<TranslateResponse> {
  const { data } = await api.post<TranslateResponse>('/translate/translate', {
    paragraphs,
    api_key: apiKey || undefined,
    document_id: documentId || undefined,
  });
  return data;
}

// ── Sentence Analysis ──

export interface AnalyzeSentenceResponse {
  sentence: string;
  analysis: {
    sentence_structure: string;
    grammar_explanation: string;
    key_vocabulary: Array<{ word: string; pos: string; meaning: string }>;
    translation: string;
  };
}

export async function analyzeSentence(
  sentence: string,
  context: string,
  apiKey?: string
): Promise<AnalyzeSentenceResponse> {
  const { data } = await api.post<AnalyzeSentenceResponse>(
    '/translate/analyze-sentence',
    {
      sentence,
      context,
      api_key: apiKey || undefined,
    }
  );
  return data;
}
