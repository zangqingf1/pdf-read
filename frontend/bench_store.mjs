/**
 * Micro-benchmark: measure Zustand store update + React reconciliation cost.
 *
 * This measures the pure JS/data side. React DOM commit + paint is measured
 * in-browser via the useLayoutEffect/useEffect instrumentation in WordExplainPanel.
 */

// Simulate the data sizes we observed from the API
const explanations_1 = [{
  word: "advancement",
  phonetic: "/ədˈvænsmənt/",
  context_sentence: "The rapid advancement of artificial intelligence has transformed industries across the globe.",
  context_sentence_zh: "人工智能的快速发展已经改变了全球各行各业。",
  pos: "n.",
  definition_en: "The process of making progress or moving forward in development.",
  definition_zh: "进步；发展；前进",
  phrases: [
    { en: "career advancement", zh: "职业发展" },
    { en: "technological advancement", zh: "技术进步" },
  ],
  examples: [
    { en: "She worked hard for career advancement.", zh: "她为职业发展而努力工作。" },
    { en: "The advancement of medicine has saved many lives.", zh: "医学的进步拯救了许多生命。" },
  ],
}];

// Generate similar data for 5 and 7 words
function makeExplanations(words) {
  return words.map(w => ({
    ...explanations_1,
    word: w,
    definition_zh: w + "的中文释义",
  }));
}

const words_1 = ["advancement"];
const words_5 = ["advancement", "artificial", "algorithms", "predictions", "ethical"];
const words_7 = ["advancement", "artificial", "algorithms", "predictions", "ethical", "privacy", "employment"];

function normalizeWord(w) {
  return w
    .replace(/^[^a-zA-Z0-9À-ɏ'’-]+/, '')
    .replace(/[^a-zA-Z0-9À-ɏ'’-]+$/, '')
    .toLowerCase();
}

// Simulate mergeExplanation logic
function mergeExplanation(selectedKeys, prevCache, words, explanations) {
  const newCache = { ...prevCache };
  for (let i = 0; i < explanations.length; i++) {
    const item = explanations[i];
    const wordText = item?.word || words[i] || '';
    const key = normalizeWord(wordText);
    if (key && (selectedKeys.includes(key) || words.some(w => normalizeWord(w) === key))) {
      newCache[key] = item;
    }
  }
  return newCache;
}

// Benchmark
function bench(label, selectedKeys, words, explanations, iterations = 100000) {
  const prevCache = {};
  // Warm-up
  for (let i = 0; i < 1000; i++) {
    mergeExplanation(selectedKeys, prevCache, words, explanations);
  }
  // Measure
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    mergeExplanation(selectedKeys, prevCache, words, explanations);
  }
  const end = performance.now();
  const avgUs = ((end - start) / iterations) * 1000; // microseconds
  console.log(`  ${label}: ${avgUs.toFixed(2)} μs avg (${iterations} iterations)`);
}

console.log("mergeExplanation() micro-benchmark (pure JS, no React):\n");

const keys_1 = words_1.map(normalizeWord);
const keys_5 = words_5.map(normalizeWord);
const keys_7 = words_7.map(normalizeWord);

bench("1 word ", keys_1, words_1, makeExplanations(words_1));
bench("5 words", keys_5, words_5, makeExplanations(words_5));
bench("7 words", keys_7, words_7, makeExplanations(words_7));

console.log("\nNote: This is pure data manipulation only.");
console.log("React reconciliation + DOM commit + browser paint typically add 3-10ms.");
console.log("See browser DevTools console for real measurements via useLayoutEffect/double-rAF hooks.");
