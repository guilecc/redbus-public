import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface TaskStep {
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface AgentTaskProgressProps {
  goal: string;
  steps: TaskStep[];
  status: 'running' | 'completed' | 'failed';
}

export const AgentTaskProgress: React.FC<AgentTaskProgressProps> = ({ goal, steps, status }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`task-progress-card ${status}`}>
      <div className="task-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="task-info">
          {status === 'running' ? (
            <Loader2 className="spinner" size={18} />
          ) : status === 'completed' ? (
            <CheckCircle2 className="success-icon" size={18} />
          ) : (
            <AlertCircle className="error-icon" size={18} />
          )}
          <span className="task-goal">{goal}</span>
        </div>
        <div className="task-actions">
          <span className="task-status-text">
            {status === 'running' ? 'executando...' : status === 'completed' ? 'concluído' : 'falha'}
          </span>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {isExpanded && (
        <div className="task-steps">
          {steps.map((step, index) => (
            <div key={index} className={`step-item ${step.status}`}>
              <span className="step-label">{step.label}</span>
              {step.status === 'running' && <Loader2 className="spinner-small" size={10} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
