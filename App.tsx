
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Settings } from './components/Settings';
import { Visualizer } from './components/Visualizer';
import { DEFAULT_CONFIG, SYSTEM_INSTRUCTION } from './constants';
import { InterviewConfig, InterviewStatus, TranscriptionItem } from './types';
import { createBlob, decode, decodeAudioData } from './utils/audioUtils';

// Audio Contexts - must be initialized on user interaction
let inputAudioContext: AudioContext | null = null;
let outputAudioContext: AudioContext | null = null;
let nextStartTime = 0;
const sources = new Set<AudioBufferSourceNode>();

const STORAGE_KEY = 'mecheng_interview_config';

const App: React.FC = () => {
  const [status, setStatus] = useState<InterviewStatus>(InterviewStatus.IDLE);
  const [config, setConfig] = useState<InterviewConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return DEFAULT_CONFIG;
      }
    }
    return DEFAULT_CONFIG;
  });
  const [transcription, setTranscription] = useState<TranscriptionItem[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isUserTalking, setIsUserTalking] = useState(false);
  
  const sessionRef = useRef<any>(null);
  const transcriptionBuffer = useRef({ user: '', assistant: '' });
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // Persist config changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const cleanupAudio = useCallback(() => {
    sources.forEach(s => s.stop());
    sources.clear();
    nextStartTime = 0;
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
  }, []);

  const stopInterview = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    cleanupAudio();
    setStatus(InterviewStatus.IDLE);
    setIsSpeaking(false);
    setIsUserTalking(false);
  }, [cleanupAudio]);

  const startInterview = async () => {
    try {
      setStatus(InterviewStatus.CONNECTING);
      
      if (!inputAudioContext) inputAudioContext = new AudioContext({ sampleRate: 16000 });
      if (!outputAudioContext) outputAudioContext = new AudioContext({ sampleRate: 24000 });
      
      await inputAudioContext.resume();
      await outputAudioContext.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const dynamicInstruction = `${SYSTEM_INSTRUCTION}
      
      --- CONTEXT FOR THIS SESSION ---
      TARGET COMPANY: ${config.companyName || "the engineering firm"}
      INTERVIEW TOPIC: ${config.topic}
      CANDIDATE LEVEL: ${config.difficulty}
      
      FULL JOB DESCRIPTION:
      ${config.jobDescription || "Standard mechanical engineering role."}
      
      SPECIFIC ROLES & RESPONSIBILITIES:
      ${config.rolesResponsibilities || "General engineering responsibilities."}
      --- END CONTEXT ---
      `;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            console.log('Session Opened');
            setStatus(InterviewStatus.ACTIVE);
            
            const source = inputAudioContext!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContext!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (event) => {
              const inputData = event.inputBuffer.getChannelData(0);
              const volume = inputData.reduce((a, b) => Math.max(a, Math.abs(b)), 0);
              setIsUserTalking(volume > 0.05);

              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContext!.destination);

            // Initial trigger to make AI start with the requested flow
            sessionPromise.then(session => {
              session.sendRealtimeInput({
                text: "The interview has started. Please look at the provided Job Description for context, identify the company name, and initiate the conversation with one of the three required icebreaker variations (Motivation, Introduction, or Alignment)."
              });
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              setIsSpeaking(true);
              nextStartTime = Math.max(nextStartTime, outputAudioContext!.currentTime);
              const buffer = await decodeAudioData(decode(audioData), outputAudioContext!, 24000, 1);
              const source = outputAudioContext!.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAudioContext!.destination);
              source.onended = () => {
                sources.delete(source);
                if (sources.size === 0) setIsSpeaking(false);
              };
              source.start(nextStartTime);
              nextStartTime += buffer.duration;
              sources.add(source);
            }

            if (message.serverContent?.outputTranscription) {
              transcriptionBuffer.current.assistant += message.serverContent.outputTranscription.text;
            } else if (message.serverContent?.inputTranscription) {
              transcriptionBuffer.current.user += message.serverContent.inputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userText = transcriptionBuffer.current.user.trim();
              const assistantText = transcriptionBuffer.current.assistant.trim();
              
              if (userText || assistantText) {
                setTranscription(prev => [
                  ...prev,
                  ...(userText ? [{ role: 'user' as const, text: userText }] : []),
                  ...(assistantText ? [{ role: 'assistant' as const, text: assistantText }] : [])
                ]);
              }
              transcriptionBuffer.current = { user: '', assistant: '' };
            }

            if (message.serverContent?.interrupted) {
              sources.forEach(s => s.stop());
              sources.clear();
              nextStartTime = 0;
              setIsSpeaking(false);
            }
          },
          onerror: (err) => {
            console.error('Session error:', err);
            stopInterview();
          },
          onclose: () => {
            console.log('Session closed');
            stopInterview();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: dynamicInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } }
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        }
      });

      sessionRef.current = await sessionPromise;
      
    } catch (err) {
      console.error('Failed to start interview:', err);
      setStatus(InterviewStatus.IDLE);
      alert('Could not start interview. Please ensure microphone access is granted.');
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcription]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">MechEng AI</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Professional Simulation</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              status === InterviewStatus.ACTIVE ? 'bg-green-100 text-green-800' :
              status === InterviewStatus.CONNECTING ? 'bg-amber-100 text-amber-800' :
              'bg-slate-100 text-slate-800'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                status === InterviewStatus.ACTIVE ? 'bg-green-500 animate-pulse' :
                status === InterviewStatus.CONNECTING ? 'bg-amber-500 animate-pulse' :
                'bg-slate-400'
              }`}></span>
              {status}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-4 md:p-6 space-y-6">
        <Settings 
          config={config} 
          onChange={setConfig} 
          disabled={status !== InterviewStatus.IDLE} 
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[550px]">
            <div className="flex-1 flex flex-col">
              <Visualizer 
                isActive={status === InterviewStatus.ACTIVE} 
                isSpeaking={isSpeaking}
                isUserTalking={isUserTalking}
              />
            </div>
            
            <div className="p-6 border-t border-slate-100 bg-slate-50/50">
              {status === InterviewStatus.IDLE ? (
                <button
                  onClick={startInterview}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-lg shadow-xl shadow-blue-600/20 transition-all flex items-center justify-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m8 0h-3m4 0a9 9 0 11-18 0" />
                  </svg>
                  <span>Start Live Interview</span>
                </button>
              ) : (
                <button
                  onClick={stopInterview}
                  className="w-full py-4 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-bold text-lg shadow-xl shadow-red-500/20 transition-all flex items-center justify-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1c1 0 2 0 3 0a1 1 0 011 1v4a1 1 0 01-1 1c-1 0-2 0-3 0a1 1 0 01-1-1v-4z" />
                  </svg>
                  <span>End Session</span>
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col h-[550px]">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                Interview Transcript
              </h2>
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded tracking-tighter uppercase">Dynamic Context</span>
            </div>
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
            >
              {transcription.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center px-8">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m8 0h-3m4 0a9 9 0 11-18 0" />
                    </svg>
                  </div>
                  <p>Awaiting connection. The interviewer will start with a custom opening based on your JD.</p>
                </div>
              ) : (
                transcription.map((item, idx) => (
                  <div key={idx} className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      item.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200'
                    }`}>
                      {item.text}
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-wider">
                      {item.role === 'user' ? 'Candidate' : 'Interviewer'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 p-6 mt-auto">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center text-slate-500 text-sm gap-4">
          <div className="flex items-center space-x-4">
            <span className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></div>
              Gemini Live v2.5
            </span>
          </div>
          <p>© 2024 MechEng Interview AI. Context-aware behavioral simulation.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
