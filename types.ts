
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

export enum InterviewStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED'
}

export interface InterviewConfig {
  topic: string;
  difficulty: 'Entry/ Undergraduate' | 'Senior' | 'Expert';
  companyName: string;
  jobDescription: string;
  rolesResponsibilities: string;
}

export interface TranscriptionItem {
  role: 'user' | 'assistant';
  text: string;
}
