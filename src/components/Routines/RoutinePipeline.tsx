import React from 'react';

interface PipelineProps {
  skillName: string | null;
  pythonScript: boolean;
  steps: Array<{ url: string; instruction: string }>;
}

const boxStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '2px',
  fontSize: '9px',
  fontFamily: 'monospace',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
  border: '1px solid var(--border)',
};

const arrowStyle: React.CSSProperties = {
  color: 'var(--text-ghost)',
  fontSize: '10px',
  margin: '0 2px',
};

export const RoutinePipeline: React.FC<PipelineProps> = ({ skillName, pythonScript, steps }) => {
  const boxes: Array<{ label: string; sublabel?: string; color: string }> = [];

  // Step 1: Maestro always plans
  boxes.push({ label: 'Maestro', sublabel: 'planeja', color: 'var(--accent)' });

  if (skillName) {
    // Skill-based pipeline
    boxes.push({ label: 'Forge', sublabel: skillName, color: '#89e051' });
    boxes.push({ label: 'Python', sublabel: 'exec', color: '#3572A5' });
  } else if (pythonScript) {
    // Direct python script
    boxes.push({ label: 'Python', sublabel: 'exec', color: '#3572A5' });
  } else if (steps.length > 0) {
    // Browser automation pipeline
    for (const step of steps.slice(0, 3)) {
      const domain = (() => {
        try { return new URL(step.url).hostname.replace('www.', ''); } catch { return step.url; }
      })();
      boxes.push({ label: 'Worker', sublabel: domain, color: '#ff8c00' });
    }
    if (steps.length > 3) {
      boxes.push({ label: `+${steps.length - 3}`, sublabel: 'steps', color: 'var(--text-ghost)' });
    }
    boxes.push({ label: 'extract', sublabel: 'DOM', color: '#e38c00' });
  }

  // Final step: Worker synthesizes response
  boxes.push({ label: 'Worker', sublabel: 'sintetiza', color: 'var(--text-dim)' });

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px', marginTop: '8px' }} data-testid="routine-pipeline">
      {boxes.map((box, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={arrowStyle}>→</span>}
          <div style={{ ...boxStyle, borderColor: box.color, background: `${box.color}11` }}>
            <span style={{ color: box.color, fontWeight: 600 }}>{box.label}</span>
            {box.sublabel && (
              <span style={{ color: 'var(--text-dim)', marginLeft: '4px' }}>{box.sublabel}</span>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

