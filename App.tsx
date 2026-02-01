
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { InterviewStatus, InterviewConfig, TranscriptionItem } from './types';
import { DEFAULT_CONFIG, SYSTEM_INSTRUCTION } from './constants';
import { Visualizer } from './components/Visualizer';
import { Settings } from './components/Settings';
import { decode, createBlob, decodeAudioData } from './utils/audioUtils';

let inputAudioContext: AudioContext | null = null;
let outputAudioContext: AudioContext | null = null;
let nextStartTime = 0;
const sources = new Set<AudioBufferSourceNode>();

const App: React.FC = () => {
  const [status, setStatus] = useState<InterviewStatus>(InterviewStatus.IDLE);
  const [config, setConfig] = useState<InterviewConfig>(DEFAULT_CONFIG);
  const [transcription, setTranscription] = useState<TranscriptionItem[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isUserTalking, setIsUserTalking] = useState(false);
  
  const sessionRef = useRef<any>(null);
  const transcriptionBuffer = useRef({ user: '', assistant: '' });
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

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

  const processTextWithFeedback = (text: string): TranscriptionItem[] => {
    const feedbackRegex = /\[FEEDBACK\]([\s\S]*?)\[\/FEEDBACK\]/g;
    const items: TranscriptionItem[] = [];
    let lastIndex = 0;
    let match;

    while ((match = feedbackRegex.exec(text)) !== null) {
      const beforeFeedback = text.substring(lastIndex, match.index).trim();
      if (beforeFeedback) {
        items.push({ role: 'assistant', text: beforeFeedback, type: 'dialogue' });
      }
      items.push({ role: 'assistant', text: match[1].trim(), type: 'feedback' });
      lastIndex = match.index + match[0].length;
    }

    const remaining = text.substring(lastIndex).trim();
    if (remaining) {
      items.push({ role: 'assistant', text: remaining, type: 'dialogue' });
    }

    return items;
  };

  const startInterview = async (isResuming = false) => {
    try {
      setStatus(InterviewStatus.CONNECTING);
      
      if (!inputAudioContext) inputAudioContext = new AudioContext({ sampleRate: 16000 });
      if (!outputAudioContext) outputAudioContext = new AudioContext({ sampleRate: 24000 });
      
      await inputAudioContext.resume();
      await outputAudioContext.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // If resuming, provide the existing transcription as context
      const resumeContext = isResuming 
        ? `\nRESUME CONTEXT: Here is what has been discussed so far. Pick up exactly where we left off:\n${transcription.map(t => `${t.role}: ${t.text}`).join('\n')}`
        : "";

      const dynamicInstruction = `${SYSTEM_INSTRUCTION}
      
      CURRENT CONTEXT:
      Company: ${config.companyName}
      Focus: ${config.topic}
      Level: ${config.difficulty}
      JD: ${config.jobDescription || "Not provided."}
      ROLES: ${config.rolesResponsibilities || "Not provided."}
      ${resumeContext}
      `;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
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

            // If resuming, send a small nudge to the AI to continue
            if (isResuming) {
              sessionPromise.then(s => s.sendRealtimeInput({ text: "I'm ready to continue our interview from where we stopped." }));
            }
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
              
              if (userText) {
                setTranscription(prev => [...prev, { role: 'user', text: userText, type: 'dialogue' }]);
              }
              if (assistantText) {
                const processedItems = processTextWithFeedback(assistantText);
                setTranscription(prev => [...prev, ...processedItems]);
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
            // Don't stop immediately to allow visual feedback, but set status
            setStatus(InterviewStatus.PAUSED);
          },
          onclose: () => {
             if (status === InterviewStatus.ACTIVE) {
                setStatus(InterviewStatus.PAUSED);
             } else {
                stopInterview();
             }
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

  const handleReset = () => {
    setTranscription([]);
    stopInterview();
  };

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
              <h1 className="text-xl font-bold text-slate-900 leading-tight">MechEng AI Coach</h1>
              <p className="text-xs text-slate-500 font-medium tracking-widest uppercase">35-Minute Training Session</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              status === InterviewStatus.ACTIVE ? 'bg-green-100 text-green-800' :
              status === InterviewStatus.CONNECTING ? 'bg-amber-100 text-amber-800' :
              status === InterviewStatus.PAUSED ? 'bg-red-100 text-red-800' :
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
        <Settings config={config} onChange={setConfig} disabled={status !== InterviewStatus.IDLE} />

        {status === InterviewStatus.PAUSED && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-2xl flex items-center justify-between shadow-sm">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-red-900">Connection Interrupted</h3>
                <p className="text-sm text-red-700">Don't worry, you can resume right where you left off.</p>
              </div>
            </div>
            <button 
              onClick={() => startInterview(true)}
              className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
            >
              Resume Interview
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[600px]">
            <div className="flex-1 flex flex-col">
              <Visualizer isActive={status === InterviewStatus.ACTIVE} isSpeaking={isSpeaking} isUserTalking={isUserTalking} />
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex flex-col space-y-3">
              {status === InterviewStatus.IDLE ? (
                <>
                  <button onClick={() => startInterview(false)} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-lg shadow-xl shadow-blue-600/20 transition-all flex items-center justify-center space-x-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m8 0h-3m4 0a9 9 0 11-18 0" />
                    </svg>
                    <span>Start New Training Session</span>
                  </button>
                  {transcription.length > 0 && (
                    <button onClick={() => startInterview(true)} className="w-full py-3 bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 rounded-2xl font-bold transition-all flex items-center justify-center space-x-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>Resume From Last Point</span>
                    </button>
                  )}
                </>
              ) : (
                <button onClick={handleReset} className="w-full py-4 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl font-bold text-lg shadow-xl shadow-slate-800/20 transition-all flex items-center justify-center space-x-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>End Training Session</span>
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col h-[600px]">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                Session Feedback & Training
              </h2>
              {transcription.length > 0 && (
                <button onClick={handleReset} className="text-xs text-slate-400 hover:text-red-500 font-medium uppercase tracking-wider">Clear History</button>
              )}
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth bg-slate-50/30">
              {transcription.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center px-8">
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path d="M12 14l9-5-9-5-9 5 9 5z" />
                      <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium">Training feedback and interview dialogue will appear here.</p>
                  <p className="text-xs mt-2">Sessions last up to 35 minutes.</p>
                </div>
              ) : (
                transcription.map((item, idx) => (
                  <div key={idx} className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${
                      item.type === 'feedback' 
                        ? 'bg-amber-50 border-2 border-amber-200 text-amber-900 font-medium shadow-sm' 
                        : item.role === 'user' 
                          ? 'bg-blue-600 text-white rounded-tr-none shadow-md' 
                          : 'bg-white text-slate-800 rounded-tl-none border border-slate-200 shadow-sm'
                    }`}>
                      {item.type === 'feedback' && (
                        <div className="flex items-center mb-1 text-amber-700 text-[10px] font-bold uppercase tracking-widest">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          Coaching Tip
                        </div>
                      )}
                      {item.text}
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-wider px-1">
                      {item.type === 'feedback' ? 'AI Coach' : item.role === 'user' ? 'Candidate' : 'Interviewer'}
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
          <div className="flex items-center space-x-6">
            <span className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-blue-500 mr-2"></div>
              STAR Method Training
            </span>
            <span className="flex items-center">
              <div className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></div>
              Live Technical Vetting
            </span>
          </div>
          <p>© 2024 MechEng Interview Coach. Focus: Phototronics Professional Excellence.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
