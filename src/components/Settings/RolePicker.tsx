import React, { useEffect, useState } from 'react';
import { ThinkingLevelPicker } from './ThinkingLevelPicker';
import type { RoleBinding, RoleName, ThinkLevel } from '../../types/roles';

interface ModelOpt { id: string; name: string }

interface Props {
  role: RoleName;
  title: string;
  description?: string;
  binding: RoleBinding;
  availableModels: Record<string, ModelOpt[]>;
  ollamaModels: string[];
  onChange: (patch: Partial<RoleBinding>) => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  ollama: 'Ollama',
  'ollama-cloud': 'OllamaCloud',
};

/**
 * One row in the Roles section of Settings: model select + thinking level
 * + resolved provider tag (Spec 06 — UI de Settings).
 */
export function RolePicker({ role, title, description, binding, availableModels, ollamaModels, onChange }: Props) {
  const [providerId, setProviderId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await window.redbusAPI.listThinkingLevels(binding.model);
        if (cancelled) return;
        if (res.status === 'OK' && res.data) setProviderId(res.data.providerId);
      } catch { /* non-fatal */ }
    }
    load();
    return () => { cancelled = true; };
  }, [binding.model]);

  const providerLabel = providerId ? (PROVIDER_LABELS[providerId] ?? providerId) : '—';

  return (
    <div
      className="form-group"
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr 140px 100px',
        gap: '10px',
        alignItems: 'end',
        padding: '8px 0',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
      data-role={role}
    >
      <div>
        <label style={{ textTransform: 'capitalize' }} title={description}>{title}</label>
        {description && (
          <div style={{ fontSize: '10px', color: 'var(--text-ghost)', marginTop: '2px' }}>{description}</div>
        )}
      </div>

      <div>
        <select
          value={binding.model}
          onChange={(e) => onChange({ model: e.target.value })}
        >
          <optgroup label="Anthropic">
            {availableModels.anthropic?.length > 0
              ? availableModels.anthropic.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
              : <option value="none" disabled>—</option>}
          </optgroup>
          <optgroup label="OpenAI">
            {availableModels.openai?.length > 0
              ? availableModels.openai.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
              : <option value="none" disabled>—</option>}
          </optgroup>
          <optgroup label="Google">
            {availableModels.google?.length > 0
              ? availableModels.google.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
              : <option value="none" disabled>—</option>}
          </optgroup>
          <optgroup label="Ollama Cloud">
            {availableModels.ollamaCloud?.length > 0
              ? availableModels.ollamaCloud.map(m => <option key={m.id} value={`ollama-cloud/${m.id}`}>{m.name}</option>)
              : <option value="none" disabled>—</option>}
          </optgroup>
          <optgroup label="atual">
            <option value={binding.model} disabled>{binding.model}</option>
          </optgroup>
          <optgroup label="Ollama (Local)">
            {ollamaModels.map(m => (
              <option key={m} value={`ollama/${m}`}>{m}</option>
            ))}
            {ollamaModels.length === 0 && <option value="" disabled>Nenhum modelo baixado</option>}
          </optgroup>
        </select>
      </div>

      <ThinkingLevelPicker
        model={binding.model}
        value={binding.thinkingLevel}
        onChange={(lvl) => onChange({ thinkingLevel: lvl as ThinkLevel })}
        label="thinking"
      />

      <div style={{
        fontSize: '10px',
        color: 'var(--accent)',
        fontWeight: 600,
        textAlign: 'right',
        paddingBottom: '8px',
      }}>
        {providerLabel}
      </div>
    </div>
  );
}

export default RolePicker;

