
import React from 'react';
import { TOPICS } from '../constants';
import { InterviewConfig } from '../types';

interface SettingsProps {
  config: InterviewConfig;
  onChange: (config: InterviewConfig) => void;
  disabled: boolean;
}

export const Settings: React.FC<SettingsProps> = ({ config, onChange, disabled }) => {
  return (
    <div className="space-y-6 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Target Company</label>
          <input 
            type="text"
            disabled={disabled}
            value={config.companyName}
            onChange={(e) => onChange({ ...config, companyName: e.target.value })}
            className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
            placeholder="e.g. SpaceX, Tesla"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Focus Area</label>
          <select 
            disabled={disabled}
            value={config.topic}
            onChange={(e) => onChange({ ...config, topic: e.target.value })}
            className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
          >
            {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Level</label>
          <select 
            disabled={disabled}
            value={config.difficulty}
            onChange={(e) => onChange({ ...config, difficulty: e.target.value as any })}
            className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
          >
            <option value="Entry/ Undergraduate">Entry/ Undergraduate</option>
            <option value="Senior">Senior</option>
            <option value="Expert">Expert</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Job Description (JD)
          </label>
          <textarea
            disabled={disabled}
            value={config.jobDescription}
            onChange={(e) => onChange({ ...config, jobDescription: e.target.value })}
            rows={4}
            className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 text-sm"
            placeholder="Paste the full job description here..."
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Roles & Responsibilities
          </label>
          <textarea
            disabled={disabled}
            value={config.rolesResponsibilities}
            onChange={(e) => onChange({ ...config, rolesResponsibilities: e.target.value })}
            rows={4}
            className="w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 text-sm"
            placeholder="Paste specific roles and responsibilities..."
          />
        </div>
      </div>
      
      {!config.jobDescription || !config.rolesResponsibilities ? (
        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-start space-x-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-amber-800">
            For the best experience, paste the <strong>Job Description</strong> and <strong>Roles & Responsibilities</strong>. The AI will tailor every question to this specific position.
          </p>
        </div>
      ) : null}
    </div>
  );
};
