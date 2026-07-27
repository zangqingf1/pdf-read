import api from './api';

export interface PromptTemplate {
  name: string; // "translate" | "analyze_words" | "analyze_sentences"
  display_name: string; // Human-readable name in Chinese
  system_prompt: string;
  user_prompt: string;
  placeholders: string[];
  is_customized: boolean; // is_default=False → user custom override
  is_default: boolean;   // is_default=True  → admin-defined system default
  updated_at: string | null;
}

export interface PromptTemplateListResponse {
  templates: PromptTemplate[];
}

export interface PromptTemplateUpdateRequest {
  system_prompt: string;
  user_prompt: string;
  set_as_default?: boolean;
}

/** Fetch all three prompt templates with current values. */
export async function getPromptTemplates(): Promise<PromptTemplateListResponse> {
  const { data } = await api.get<PromptTemplateListResponse>('/prompts');
  return data;
}

/** Fetch a single prompt template by name. */
export async function getPromptTemplate(
  name: string
): Promise<PromptTemplate> {
  const { data } = await api.get<PromptTemplate>(`/prompts/${name}`);
  return data;
}

/** Save as a custom override (is_default=False). */
export async function updatePromptTemplate(
  name: string,
  body: PromptTemplateUpdateRequest
): Promise<PromptTemplate> {
  const { data } = await api.put<PromptTemplate>(`/prompts/${name}`, body);
  return data;
}

/** Save as the admin-defined system default (is_default=True). */
export async function updateDefaultPrompt(
  name: string,
  body: PromptTemplateUpdateRequest
): Promise<PromptTemplate> {
  const { data } = await api.put<PromptTemplate>(`/prompts/${name}/default`, body);
  return data;
}

/** Promote the current custom prompt to system default. */
export async function promoteToDefault(name: string): Promise<PromptTemplate> {
  const { data } = await api.post<PromptTemplate>(`/prompts/${name}/promote`);
  return data;
}

/** Reset a single template to factory defaults (deletes all DB rows). */
export async function resetPromptTemplate(
  name: string
): Promise<PromptTemplate> {
  const { data } = await api.post<PromptTemplate>(`/prompts/${name}/reset`);
  return data;
}

/** Get the hardcoded factory default prompt content (read-only reference). */
export async function getDefaultPrompt(name: string): Promise<PromptTemplate> {
  const { data } = await api.get<PromptTemplate>(`/prompts/${name}/default`);
  return data;
}

/** Reset all templates to factory defaults. */
export async function resetAllPromptTemplates(): Promise<PromptTemplateListResponse> {
  const { data } = await api.post<PromptTemplateListResponse>('/prompts/reset-all');
  return data;
}
