import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Trash2, Star, List, Plus } from 'lucide-react';
import type { CommsFilterPreset } from '../../types/ipc';

export interface FilterState {
  blacklist: string[];
  whitelist: string[];
  sources: { outlook: boolean; teams: boolean };
  unreadOnly: boolean;
  sameDomainOnly: boolean;
  searchQuery: string;
}

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
  presets: CommsFilterPreset[];
  onSavePreset: (p: CommsFilterPreset) => void;
  onDeletePreset: (id: string) => void;
  onApplyPreset: (p: CommsFilterPreset) => void;
  userDomain?: string;
}

const MAX_VISIBLE_CHIPS = 3;

const ChipsModal: React.FC<{
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  onClose: () => void;
}> = ({ label, values, onChange, placeholder, onClose }) => {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const t = draft.trim().toLowerCase();
    if (!t) return;
    if (values.includes(t)) { setDraft(''); return; }
    onChange([...values, t]);
    setDraft('');
    inputRef.current?.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="comms-chips-modal-overlay" onClick={onClose}>
      <div className="comms-chips-modal" onClick={(e) => e.stopPropagation()}>
        <div className="comms-chips-modal-header">
          <span className="comms-filter-label">
            {label}
            {values.length > 0 && <span className="comms-chips-count" style={{ marginLeft: '6px' }}>{values.length}</span>}
          </span>
          <button type="button" className="comms-chips-modal-close" onClick={onClose} aria-label="fechar"><X size={14} /></button>
        </div>

        {/* Add input always at top */}
        <div className="comms-chips-modal-addinput">
          <input
            ref={inputRef}
            type="text"
            className="comms-chip-input comms-chip-input--modal"
            value={draft}
            placeholder={placeholder || 'novo item + Enter'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            autoFocus
          />
          <button
            type="button"
            className="comms-chips-modal-addbtn"
            onClick={add}
            disabled={!draft.trim()}
            aria-label="adicionar"
          >
            <Plus size={13} />
          </button>
        </div>

        <div className="comms-chips-modal-body">
          {values.length === 0 && <p className="comms-chips-modal-empty">nenhum item ainda. Adicione acima.</p>}
          {values.map(v => (
            <span key={v} className="comms-chip comms-chip--modal">
              {v}
              <button type="button" className="comms-chip-x" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`remover ${v}`}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const ChipsInput: React.FC<{
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}> = ({ label, values, onChange, placeholder }) => {
  const [open, setOpen] = useState(false);
  const visible = values.slice(0, MAX_VISIBLE_CHIPS);
  const overflow = Math.max(0, values.length - MAX_VISIBLE_CHIPS);

  return (
    <div className="comms-filter-field">
      <div className="comms-chips-header">
        <label className="comms-filter-label">{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {values.length > 0 && <span className="comms-chips-count">{values.length}</span>}
          <button
            type="button"
            className="comms-chips-manage-btn"
            onClick={() => setOpen(true)}
            title={`gerenciar ${label}`}
            aria-label={`gerenciar ${label}`}
          >
            <List size={12} />
          </button>
        </div>
      </div>

      {/* Inline preview chips */}
      <div className="comms-chips-row comms-chips-row--clamped">
        {visible.map(v => (
          <span key={v} className="comms-chip">
            {v}
            <button type="button" className="comms-chip-x" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`remover ${v}`}>
              <X size={10} />
            </button>
          </span>
        ))}
        {overflow > 0 && (
          <button type="button" className="comms-chip comms-chip-more" onClick={() => setOpen(true)} title={`ver todos (${values.length})`}>
            +{overflow} mais
          </button>
        )}
        {values.length === 0 && (
          <button type="button" className="comms-chips-empty-hint" onClick={() => setOpen(true)}>
            <Plus size={11} /> adicionar
          </button>
        )}
      </div>

      {open && (
        <ChipsModal
          label={label}
          values={values}
          onChange={onChange}
          placeholder={placeholder}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};

export const FilterPanel: React.FC<Props> = ({ value, onChange, presets, onSavePreset, onDeletePreset, onApplyPreset, userDomain }) => {
  const [searchLocal, setSearchLocal] = useState(value.searchQuery);
  const debRef = useRef<number | null>(null);
  useEffect(() => { setSearchLocal(value.searchQuery); }, [value.searchQuery]);
  useEffect(() => {
    if (debRef.current) window.clearTimeout(debRef.current);
    debRef.current = window.setTimeout(() => {
      if (searchLocal !== value.searchQuery) onChange({ ...value, searchQuery: searchLocal });
    }, 120);
    return () => { if (debRef.current) window.clearTimeout(debRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLocal]);

  const [savingName, setSavingName] = useState<string | null>(null);
  const handleSave = () => {
    const name = (savingName || '').trim();
    if (!name) { setSavingName(''); return; }
    const preset: CommsFilterPreset = {
      id: `preset-${Date.now()}`,
      name,
      blacklist: value.blacklist,
      whitelist: value.whitelist,
      sources: value.sources,
      unreadOnly: value.unreadOnly,
      sameDomainOnly: value.sameDomainOnly,
    };
    onSavePreset(preset);
    setSavingName(null);
  };

  return (
    <div className="comms-filter-panel">
      <div className="comms-filter-field">
        <label className="comms-filter-label">busca</label>
        <input
          type="text"
          className="comms-filter-search"
          value={searchLocal}
          placeholder="filtrar por termo…"
          onChange={(e) => setSearchLocal(e.target.value)}
        />
      </div>

      <ChipsInput label="blacklist" values={value.blacklist} onChange={(bl) => onChange({ ...value, blacklist: bl })} placeholder="ex: jira, newsletter" />
      <ChipsInput label="whitelist" values={value.whitelist} onChange={(wl) => onChange({ ...value, whitelist: wl })} placeholder="ex: projeto X" />

      <div className="comms-filter-field">
        <div className="comms-toggle-row">
          <label className="comms-toggle"><input type="checkbox" checked={value.unreadOnly} onChange={(e) => onChange({ ...value, unreadOnly: e.target.checked })} /> apenas não lidos</label>
          <label className="comms-toggle" title={userDomain ? `apenas emails @${userDomain} (não afeta Teams)` : 'domínio do usuário indisponível'}>
            <input type="checkbox" checked={value.sameDomainOnly} disabled={!userDomain} onChange={(e) => onChange({ ...value, sameDomainOnly: e.target.checked })} />
            email: mesmo domínio{userDomain ? ` (@${userDomain})` : ''}
          </label>
        </div>
      </div>

      <div className="comms-filter-field">
        <label className="comms-filter-label">presets</label>
        <div className="comms-presets">
          {presets.map(p => (
            <div key={p.id} className="comms-preset-row">
              <button
                type="button"
                className={`comms-preset-star${p.isDefault ? ' active' : ''}`}
                onClick={() => onSavePreset({ ...p, isDefault: !p.isDefault })}
                title={p.isDefault ? 'remover como padrão' : 'definir como padrão (aplica ao abrir)'}
                aria-label={p.isDefault ? 'preset padrão' : 'definir como padrão'}
              >
                <Star size={11} fill={p.isDefault ? 'currentColor' : 'none'} />
              </button>
              <button type="button" className="comms-preset-apply" onClick={() => onApplyPreset(p)} title={`aplicar ${p.name}`}>{p.name}</button>
              <button type="button" className="comms-preset-del" onClick={() => onDeletePreset(p.id)} title="remover"><Trash2 size={10} /></button>
            </div>
          ))}
          {savingName === null && (
            <button type="button" className="comms-preset-save" onClick={() => setSavingName('')}><Save size={11} /> salvar preset</button>
          )}
          {savingName !== null && (
            <div className="comms-preset-save-row">
              <input autoFocus type="text" value={savingName} onChange={(e) => setSavingName(e.target.value)} placeholder="nome do preset" onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setSavingName(null); }} />
              <button type="button" onClick={handleSave}>ok</button>
              <button type="button" onClick={() => setSavingName(null)}>x</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
