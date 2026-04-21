import React, { useEffect, useState } from 'react';

type LevelsResponse = { supported: string[]; default: string; providerId: string | null };

const LEVEL_LABELS: Record<string, string> = {
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  adaptive: 'adaptive',
};

interface Props {
  model: string;
  /** Current thinking level for this role. */
  value?: string;
  /** Called when the user picks a new level. */
  onChange: (next: string) => void;
  /** Optional label override (default: "nível de raciocínio"). */
  label?: string;
}

/**
 * Dropdown that lets the user pick the canonical `ThinkLevel` for a given
 * model. Resolves the supported set from the provider plugin (Spec 01) and
 * is a controlled component — caller owns the persisted value (per-role,
 * Spec 06).
 */
export function ThinkingLevelPicker({ model, value, onChange, label = 'nível de raciocínio' }: Props) {
  const [levels, setLevels] = useState<LevelsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const lvlRes = await window.redbusAPI.listThinkingLevels(model);
        if (cancelled) return;
        if (lvlRes.status === 'OK' && lvlRes.data) {
          setLevels(lvlRes.data);
        }
      } catch {
        // non-fatal
      }
    }
    load();
    return () => { cancelled = true; };
  }, [model]);

  if (!levels || levels.supported.length <= 1) return null;

  const selected = value && levels.supported.includes(value) ? value : levels.default;

  return (
    <div className="form-group">
      <label>{label}</label>
      <select value={selected} onChange={(e) => onChange(e.target.value)}>
        {levels.supported.map((lvl) => (
          <option key={lvl} value={lvl}>{LEVEL_LABELS[lvl] || lvl}</option>
        ))}
      </select>
    </div>
  );
}

export default ThinkingLevelPicker;

