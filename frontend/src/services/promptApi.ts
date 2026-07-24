import api from './api';

export interface PromptTemplate {
  name: string; // "translate" | "analyze_words" | "analyze_sentences"
  system_prompt: string;
  user_prompt: string;
  placeholders: string[];
  is_customized: boolean;
  updated_at: string | null;
}

export interface PromptTemplateListResponse {
  templates: PromptTemplate[];
}

export interface PromptTemplateUpdateRequest {
  system_prompt: string;
  user_prompt: string;
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

/** Create or update a prompt template. */
export async function updatePromptTemplate(
  name: string,
  body: PromptTemplateUpdateRequest
): Promise<PromptTemplate> {
  const { data } = await api.put<PromptTemplate>(`/prompts/${name}`, body);
  return data;
}

/** Reset a single template to built-in defaults. */
export async function resetPromptTemplate(
  name: string
): Promise<PromptTemplate> {
  const { data } = await api.post<PromptTemplate>(`/prompts/${name}/reset`);
  return data;
}

/** Reset all templates to built-in defaults. */
export async function resetAllPromptTemplates(): Promise<PromptTemplateListResponse> {
  const { data } = await api.post<PromptTemplateListResponse>('/prompts/reset-all');
  return data;
}
