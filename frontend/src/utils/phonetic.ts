/** 音标拆分：把 "BrE /.../  NAmE /.../" 拆成英音/美音两段（AI 生成格式不稳定，需容错）。 */

export interface PhoneticParts {
  br: string | null;
  am: string | null;
}

export function splitPhonetic(phonetic: string | undefined | null): PhoneticParts {
  if (!phonetic) return { br: null, am: null };
  const br = phonetic.match(/BrE\s*(\S+)/)?.[1] ?? null;
  const am = phonetic.match(/NAmE\s*(\S+)/)?.[1] ?? null;
  return { br, am };
}
