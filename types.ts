export enum AppView {
  READER = 'READER', // TTS
  TRANSCRIBE = 'TRANSCRIBE', // Audio to Text
  ANALYZE = 'ANALYZE', // Image Analysis
  GENERATE = 'GENERATE', // Image Generation
  LIVE = 'LIVE' // Conversational
}

export interface VoiceOption {
  id: string;
  name: string;
  description: string;
  geminiVoiceName: string;
}

export interface ProcessingState {
  isLoading: boolean;
  status: string;
  error?: string;
}

export interface ExtractedDocument {
  text: string;
  language: 'es' | 'en' | string;
}

export enum ImageSize {
  SIZE_1K = '1K',
  SIZE_2K = '2K',
  SIZE_4K = '4K'
}

export interface Bookmark {
  id: string;
  time: number;
  label: string;
}

export interface HistoryItem {
  id: string;
  fileName: string;
  uploadDate: number;
  text: string;
  language: string;
  bookmarks: Bookmark[];
  lastPosition: number;
}
