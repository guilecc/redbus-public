import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, Save, Code2 } from 'lucide-react';

interface Snippet {
  name: string;
  description: string;
  python_code: string;
  language?: string;
  parameters_schema: string;
  required_vault_keys: string;
  version?: number;
  tags?: string[];
}

const LANG_COLORS: Record<string, string> = {
  python: '#3572A5',
  bash: '#89e051',
  typescript: '#3178c6',
  javascript: '#f1e05a',
  sql: '#e38c00',
};

/* ── Shared dark input style ────────────────────── */
const darkInput: React.CSSProperties = {
  background: 'var(--bg-input, #08080d)',
  color: 'var(--text, #ffcfbd)',
  border: '1px solid var(--border, #2a150d)',
  borderRadius: '2px',
  padding: '6px 8px',
  fontSize: '12px',
  fontFamily: 'var(--font)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box' as const,
};

const darkTextarea: React.CSSProperties = {
  ...darkInput,
  fontSize: '10px',
  fontFamily: 'monospace',
  resize: 'vertical' as const,
  height: '60px',
};

/* ── Lightweight syntax highlighting ──────────────── */
const HIGHLIGHT_RULES: Record<string, Array<{ regex: RegExp; className: string }>> = {
  python: [
    { regex: /(#[^\n]*)/g, className: 'sh-comment' },
    { regex: /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, className: 'sh-string' },
    { regex: /\b(import|from|def|class|return|if|elif|else|for|while|try|except|finally|with|as|raise|yield|pass|break|continue|and|or|not|in|is|None|True|False|lambda|global|nonlocal|assert|del|async|await)\b/g, className: 'sh-keyword' },
    { regex: /\b([A-Z_][A-Z_0-9]{2,})\b/g, className: 'sh-const' },
    { regex: /\b(\d+\.?\d*)\b/g, className: 'sh-number' },
  ],
  javascript: [
    { regex: /(\/\/[^\n]*)/g, className: 'sh-comment' },
    { regex: /(`[\s\S]*?`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, className: 'sh-string' },
    { regex: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|null|undefined|true|false|typeof|instanceof)\b/g, className: 'sh-keyword' },
    { regex: /\b(\d+\.?\d*)\b/g, className: 'sh-number' },
  ],
  typescript: [], // filled below
  bash: [
    { regex: /(#[^\n]*)/g, className: 'sh-comment' },
    { regex: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, className: 'sh-string' },
    { regex: /\b(if|then|else|elif|fi|for|do|done|while|case|esac|function|return|exit|export|source|local)\b/g, className: 'sh-keyword' },
    { regex: /(\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]+\})/g, className: 'sh-const' },
  ],
  sql: [
    { regex: /(--[^\n]*)/g, className: 'sh-comment' },
    { regex: /('(?:[^'\\]|\\.)*')/g, className: 'sh-string' },
    { regex: /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INTO|VALUES|SET|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|NULL|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|DISTINCT|UNION|EXISTS|IN|LIKE|BETWEEN|CASE|WHEN|THEN|ELSE|END|COUNT|SUM|AVG|MAX|MIN)\b/gi, className: 'sh-keyword' },
    { regex: /\b(\d+\.?\d*)\b/g, className: 'sh-number' },
  ],
};
HIGHLIGHT_RULES.typescript = HIGHLIGHT_RULES.javascript;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCode(code: string, language: string): string {
  const rules = HIGHLIGHT_RULES[language] || HIGHLIGHT_RULES.python;
  const escaped = escapeHtml(code);

  // Tokenize: apply rules in priority order, protect already-matched spans
  let result = escaped;
  const placeholder: string[] = [];
  for (const rule of rules) {
    result = result.replace(rule.regex, (match) => {
      const idx = placeholder.length;
      placeholder.push(`<span class="${rule.className}">${match}</span>`);
      return `\x00${idx}\x00`;
    });
  }
  // Restore placeholders
  result = result.replace(/\x00(\d+)\x00/g, (_, idx) => placeholder[Number(idx)]);
  return result;
}

export const SkillManager: React.FC = () => {
  const [skills, setSkills] = useState<Snippet[]>([]);
  const [selected, setSelected] = useState<Snippet | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editSchema, setEditSchema] = useState('');
  const [editVaultKeys, setEditVaultKeys] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    if (!window.redbusAPI) return;
    const res = await window.redbusAPI.listSkills();
    if (res.status === 'OK' && res.data) {
      setSkills(res.data);
      if (res.data.length > 0 && !selected) selectSkill(res.data[0]);
    }
  };

  const selectSkill = (skill: Snippet) => {
    setSelected(skill);
    setEditCode(skill.python_code);
    setEditDesc(skill.description);
    setEditSchema(skill.parameters_schema || '{}');
    setEditVaultKeys(skill.required_vault_keys || '[]');
    setConfirmDelete(false);
  };

  const handleSave = async () => {
    if (!selected || !window.redbusAPI) return;
    setSaving(true);
    let vaultKeys: string[] = [];
    try { vaultKeys = JSON.parse(editVaultKeys); } catch { /* ignore */ }
    await window.redbusAPI.updateSkill({
      name: selected.name,
      description: editDesc,
      python_code: editCode,
      language: selected.language || 'python',
      parameters_schema: editSchema,
      required_vault_keys: vaultKeys,
    });
    await loadSkills();
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selected || !window.redbusAPI) return;
    await window.redbusAPI.deleteSkill(selected.name);
    setSelected(null);
    setConfirmDelete(false);
    await loadSkills();
  };

  /* ── Sync highlighted pre with textarea scroll ── */
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const handleCodeScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const lang = selected?.language || 'python';

  return (
    <div className="view-layout">
      {/* Sidebar */}
      <aside className="view-sidebar">
        <div className="view-sidebar-header">
          <h2><Code2 size={16} style={{ display: 'inline', verticalAlign: 'sub', marginRight: '6px' }} /> forge manager</h2>
        </div>
        
        <div className="view-sidebar-list" data-testid="skill-list">
          {skills.length === 0 && (
            <p className="view-empty" style={{ textAlign: 'center', marginTop: '20px' }}>
              nenhum snippet forjado.<br />peça ao maestro para criar um.
            </p>
          )}
          {skills.map(s => (
            <div
              key={s.name}
              data-testid={`skill-item-${s.name}`}
              className={`view-sidebar-item${selected?.name === s.name ? ' active' : ''}`}
              onClick={() => selectSkill(s)}
            >
              <div className="view-sidebar-item-title" style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{s.name}</div>
              <div className="view-sidebar-item-meta" style={{ marginTop: '2px' }}>
                <span style={{ color: LANG_COLORS[s.language || 'python'] || 'var(--text-ghost)' }}>● {s.language || 'python'}</span>
                <span>v{s.version}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Detail Area */}
      <main className="view-detail">
        {!selected ? (
          <div className="view-detail-empty">
            <Code2 size={32} strokeWidth={1} />
            <p>selecione um snippet para visualizar o código</p>
          </div>
        ) : (
          <div className="view-detail-content">
            <header className="view-detail-header">
              <div className="view-detail-title-row">
                <h1>{selected.name}</h1>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {!confirmDelete ? (
                    <button className="view-delete-btn" onClick={() => setConfirmDelete(true)} title="Deletar Snippet">
                      <Trash2 size={13} />
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: '#ef4444' }}>certeza?</span>
                      <button className="save-btn" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={handleDelete}>sim</button>
                      <button className="save-btn" onClick={() => setConfirmDelete(false)}>não</button>
                    </div>
                  )}
                  <button className="save-btn" onClick={handleSave} disabled={saving} data-testid="skill-save-btn">
                    <Save size={11} /> {saving ? 'salvando...' : 'salvar'}
                  </button>
                </div>
              </div>
            </header>
            
            <div className="view-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>linguagem</label>
                    <input value={selected.language || 'python'} disabled style={{ ...darkInput, fontFamily: 'monospace', opacity: 0.6, color: LANG_COLORS[selected.language || 'python'] || 'var(--text-dim)' }} />
                  </div>
                  <div style={{ flex: 2 }}>
                    <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>descrição</label>
                    <input value={editDesc} onChange={e => setEditDesc(e.target.value)} style={darkInput} />
                  </div>
                </div>

                {/* ── Code editor with syntax highlighting ── */}
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: '300px' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>código ({lang})</label>
                  <div className="forge-code-wrap" style={{ position: 'relative', flex: 1 }}>
                    <pre
                      ref={preRef}
                      className="forge-code-highlight"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: highlightCode(editCode, lang) + '\n' }}
                    />
                    <textarea
                      ref={textareaRef}
                      value={editCode}
                      onChange={e => setEditCode(e.target.value)}
                      onScroll={handleCodeScroll}
                      data-testid="skill-code-editor"
                      spellCheck={false}
                      className="forge-code-textarea"
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', paddingBottom: '20px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>parameters_schema (JSON)</label>
                    <textarea value={editSchema} onChange={e => setEditSchema(e.target.value)} spellCheck={false} style={darkTextarea} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>vault_keys (JSON array)</label>
                    <textarea value={editVaultKeys} onChange={e => setEditVaultKeys(e.target.value)} spellCheck={false} style={darkTextarea} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

