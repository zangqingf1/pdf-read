import api from './api';

export interface DailyQuote {
  date: string;
  en: string;
  zh: string;
  author: string;
}

export async function getDailyQuote(): Promise<DailyQuote> {
  const { data } = await api.get<DailyQuote>('/quote');
  return data;
}
