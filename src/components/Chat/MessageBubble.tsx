import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AgentTaskProgress } from './AgentTaskProgress';

export interface ToolIndicator {
  toolName: string;
  label: string;
  icon: string;
  status: 'running' | 'done';
  durationMs?: number;
}

export interface StreamingData {
  isThinking: boolean;
  thinkingText: string;
  tools: ToolIndicator[];
  isStreaming: boolean;
  streamedText: string;
  workerActive: boolean;
  workerLabel: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'spec';
  specData?: {
    goal: string;
    status: 'running' | 'completed' | 'failed';
    steps: Array<{ label: string; status: 'pending' | 'running' | 'completed' | 'failed' }>;
    data?: any;
    error?: string;
  };
  /** Live streaming state — present only on the temporary in-flight message */
  streaming?: StreamingData;
}

interface MessageBubbleProps {
  message: Message;
  assistantName?: string;
  userName?: string;
}

/** Inline thinking indicator (collapsible) */
const ThinkingInline: React.FC<{ active: boolean; text: string }> = ({ active, text }) => {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  if (!active && !text) return null;
  
  const isOpen = userToggled !== null ? userToggled : true;

  return (
    <div className="msg-thinking-container" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
      <div 
        className="msg-thinking" 
        style={{ cursor: 'pointer', width: 'fit-content' }}
        onClick={() => setUserToggled(!isOpen)}
      >
        <span className={`msg-thinking-dot${active ? ' active' : ''}`} />
        <span className="msg-thinking-label">{active ? 'pensando...' : 'raciocínio'}</span>
        {text && <span className="msg-thinking-chevron">{isOpen ? '▾' : '▸'}</span>}
      </div>
      {isOpen && text && (
        <div className="msg-thinking-body" style={{ whiteSpace: 'pre-wrap', borderLeft: '2px solid var(--border)', paddingLeft: '8px', width: '100%' }}>
          {text}
        </div>
      )}
    </div>
  );
};

/** Inline tool pill */
const ToolPill: React.FC<{ tool: ToolIndicator }> = ({ tool }) => (
  <span className={`msg-tool-pill${tool.status === 'done' ? ' done' : ''}`}>
    <span className="msg-tool-icon">{tool.status === 'done' ? '✓' : tool.icon}</span>
    {tool.label}
    {tool.status === 'running' && <span className="msg-tool-spin" />}
    {tool.status === 'done' && tool.durationMs != null && (
      <span className="msg-tool-dur">{(tool.durationMs / 1000).toFixed(1)}s</span>
    )}
  </span>
);

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, assistantName, userName }) => {
  const isUser = message.role === 'user';
  const s = message.streaming;

  return (
    <div className={`message-row ${isUser ? 'user-row' : 'assistant-row'}`}>
      <div className="message-avatar">
        {isUser ? (userName || 'USR') : (assistantName || 'SYS')}
      </div>
      <div className="message-content-wrapper">
        {message.type === 'spec' && message.specData ? (
          <div className="spec-bubble-container">
            <AgentTaskProgress
              goal={message.specData.goal}
              steps={message.specData.steps}
              status={message.specData.status}
            />
            {message.specData.error && (
              <div className="message-bubble mt-2 error-data">
                <p><strong>erro de extração:</strong></p>
                <ReactMarkdown>{message.specData.error}</ReactMarkdown>
              </div>
            )}
          </div>
        ) : s ? (
          /* ── Streaming in-flight message ── */
          <div className="message-bubble msg-streaming-bubble">
            <ThinkingInline active={s.isThinking} text={s.thinkingText} />
            {s.tools.length > 0 && (
              <div className="msg-tools-row">
                {s.tools.map((t, i) => <ToolPill key={`${t.toolName}-${i}`} tool={t} />)}
              </div>
            )}
            {s.workerActive && (
              <div className="msg-worker-row">
                <span className="msg-tool-spin" />
                <span>{s.workerLabel}</span>
              </div>
            )}
            {s.streamedText ? (
              <div className="msg-streamed-text">
                {s.streamedText}
                {s.isStreaming && <span className="msg-cursor">▊</span>}
              </div>
            ) : !s.isThinking && s.tools.length === 0 && !s.workerActive ? (
              <div className="msg-waiting-dots"><span /><span /><span /></div>
            ) : null}
          </div>
        ) : (
          <div className="message-bubble">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};
