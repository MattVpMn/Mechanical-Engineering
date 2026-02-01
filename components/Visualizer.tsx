
import React from 'react';

interface VisualizerProps {
  isActive: boolean;
  isSpeaking: boolean;
  isUserTalking: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isActive, isSpeaking, isUserTalking }) => {
  return (
    <div className="flex flex-col items-center justify-center space-y-8 p-12">
      <div className="relative w-48 h-48 flex items-center justify-center">
        {/* Outer rings */}
        <div className={`absolute w-full h-full rounded-full border-4 border-blue-500/20 ${isActive ? 'animate-pulse' : ''}`}></div>
        <div className={`absolute w-[80%] h-[80%] rounded-full border-4 border-blue-500/40 ${isSpeaking ? 'scale-110 transition-transform duration-200' : 'scale-100'}`}></div>
        
        {/* Core status dot */}
        <div className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${
          isSpeaking ? 'bg-blue-600 shadow-lg shadow-blue-500/50' : 
          isUserTalking ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : 
          isActive ? 'bg-slate-400' : 'bg-slate-200'
        }`}>
          {isSpeaking && (
             <div className="flex space-x-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="w-1.5 h-6 bg-white rounded-full animate-bounce" style={{ animationDelay: `${i * 0.1}s` }}></div>
                ))}
             </div>
          )}
          {isUserTalking && !isSpeaking && (
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
          )}
          {!isSpeaking && !isUserTalking && (
             <div className="w-4 h-4 bg-white rounded-full"></div>
          )}
        </div>
        
        {/* Ripple effect when active */}
        {isActive && !isSpeaking && !isUserTalking && (
           <div className="absolute w-24 h-24 rounded-full bg-blue-500/20 animate-pulse-ring"></div>
        )}
      </div>
      
      <div className="text-center">
        <p className="text-xl font-semibold text-slate-800">
          {isSpeaking ? "Interviewer is speaking..." : isUserTalking ? "Listening to you..." : isActive ? "Waiting for response..." : "Disconnected"}
        </p>
        <p className="text-slate-500 text-sm mt-1">
          {isActive ? "Speak clearly into your microphone" : "Click 'Start Interview' to begin"}
        </p>
      </div>
    </div>
  );
};
