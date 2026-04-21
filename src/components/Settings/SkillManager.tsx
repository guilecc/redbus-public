import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, Save, FileText, Eye, Edit3 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

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

const monoTextarea: React.CSSProperties = {
  ...darkInput,
  fontFamily: 'monospace',
  fontSize: '11px',
  lineHeight: 1.5,
  resize: 'none' as const,
  minHeight: '420px',
  overflowY: 'auto',
};

export const SkillManager: React.FC = () => {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [selected, setSelected] = useState<SkillDetail | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editEnv, setEditEnv] = useState('');
  const [editBins, setEditBins] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selectSkill = useCallback(async (name: string) => {
    if (!window.redbusAPI) return;
    const res = await window.redbusAPI.getSkill(name);
    if (res.status === 'OK' && res.data) {
      setSelected(res.data);
      setEditDesc(res.data.description);
      setEditBody(res.data.body);
      setEditEnv((res.data.frontmatter.metadata?.requires?.env || []).join(', '));
      setEditBins((res.data.frontmatter.metadata?.requires?.bins || []).join(', '));
      setEditEmoji(res.data.frontmatter.metadata?.emoji || '');
      setPreview(false);
      setConfirmDelete(false);
    }
  }, []);

  const loadSkills = useCallback(async () => {
    if (!window.redbusAPI) return;
    const res = await window.redbusAPI.listSkills();
    if (res.status === 'OK' && res.data) {
      setSkills(res.data);
      if (res.data.length > 0 && !selected) void selectSkill(res.data[0].name);
    }
  }, [selected, selectSkill]);

  useEffect(() => { void loadSkills(); }, [loadSkills]);

  const handleSave = async () => {
    if (!selected || !window.redbusAPI) return;
    setSaving(true);
    const env = editEnv.split(',').map(s => s.trim()).filter(Boolean);
    const bins = editBins.split(',').map(s => s.trim()).filter(Boolean);
    const metadata: any = {};
    if (editEmoji) metadata.emoji = editEmoji;
    if (env.length || bins.length) {
      metadata.requires = { ...(env.length && { env }), ...(bins.length && { bins }) };
    }
    await window.redbusAPI.updateSkill({
      name: selected.name,
      description: editDesc,
      body: editBody,
      metadata: Object.keys(metadata).length ? metadata : undefined,
      homepage: selected.frontmatter.homepage,
    });
    await loadSkills();
    await selectSkill(selected.name);
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selected || !window.redbusAPI) return;
    await window.redbusAPI.deleteSkill(selected.name);
    setSelected(null);
    setConfirmDelete(false);
    await loadSkills();
  };

  return (
    <div className="view-layout">
      <aside className="view-sidebar">
        <div className="view-sidebar-header">
          <h2><FileText size={16} style={{ display: 'inline', verticalAlign: 'sub', marginRight: '6px' }} /> skills</h2>
        </div>
        <div className="view-sidebar-list" data-testid="skill-list">
          {skills.length === 0 && (
            <p className="view-empty" style={{ textAlign: 'center', marginTop: '20px' }}>
              nenhuma skill salva.<br />peça ao maestro para forjar uma.
            </p>
          )}
          {skills.map(s => (
            <div
              key={s.name}
              data-testid={`skill-item-${s.name}`}
              className={`view-sidebar-item${selected?.name === s.name ? ' active' : ''}`}
              onClick={() => void selectSkill(s.name)}
            >
              <div className="view-sidebar-item-title" style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>
                {s.emoji ? `${s.emoji} ` : ''}{s.name}
              </div>
              <div className="view-sidebar-item-meta" style={{ marginTop: '2px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {s.requires_env.length > 0 && <span style={{ color: 'var(--text-ghost)' }}>env: {s.requires_env.length}</span>}
                {s.requires_bins.length > 0 && <span style={{ color: 'var(--text-ghost)' }}>bins: {s.requires_bins.join(',')}</span>}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="view-detail">
        {!selected ? (
          <div className="view-detail-empty">
            <FileText size={32} strokeWidth={1} />
            <p>selecione uma skill para visualizar o playbook</p>
          </div>
        ) : (
          <SkillDetailView
            selected={selected}
            editDesc={editDesc} setEditDesc={setEditDesc}
            editBody={editBody} setEditBody={setEditBody}
            editEnv={editEnv} setEditEnv={setEditEnv}
            editBins={editBins} setEditBins={setEditBins}
            editEmoji={editEmoji} setEditEmoji={setEditEmoji}
            preview={preview} setPreview={setPreview}
            saving={saving} onSave={handleSave}
            confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
            onDelete={handleDelete}
          />
        )}
      </main>
    </div>
  );
};

interface DetailProps {
  selected: SkillDetail;
  editDesc: string; setEditDesc: (v: string) => void;
  editBody: string; setEditBody: (v: string) => void;
  editEnv: string; setEditEnv: (v: string) => void;
  editBins: string; setEditBins: (v: string) => void;
  editEmoji: string; setEditEmoji: (v: string) => void;
  preview: boolean; setPreview: (v: boolean) => void;
  saving: boolean; onSave: () => void;
  confirmDelete: boolean; setConfirmDelete: (v: boolean) => void;
  onDelete: () => void;
}

const SkillDetailView: React.FC<DetailProps> = (p) => {
  const { selected } = p;
  const auxFiles = [
    ...selected.scripts.map(s => ({ group: 'scripts', file: s })),
    ...selected.references.map(s => ({ group: 'references', file: s })),
    ...selected.assets.map(s => ({ group: 'assets', file: s })),
  ];

  return (
    <div className="view-detail-content">
      <header className="view-detail-header">
        <div className="view-detail-title-row">
          <h1>{selected.frontmatter.metadata?.emoji ? `${selected.frontmatter.metadata.emoji} ` : ''}{selected.name}</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="save-btn" onClick={() => p.setPreview(!p.preview)} title={p.preview ? 'editar' : 'preview'}>
              {p.preview ? <Edit3 size={11} /> : <Eye size={11} />} {p.preview ? 'editar' : 'preview'}
            </button>
            {!p.confirmDelete ? (
              <button className="view-delete-btn" onClick={() => p.setConfirmDelete(true)} title="Deletar skill">
                <Trash2 size={13} />
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#ef4444' }}>certeza?</span>
                <button className="save-btn" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={p.onDelete}>sim</button>
                <button className="save-btn" onClick={() => p.setConfirmDelete(false)}>não</button>
              </div>
            )}
            <button className="save-btn" onClick={p.onSave} disabled={p.saving} data-testid="skill-save-btn">
              <Save size={11} /> {p.saving ? 'salvando...' : 'salvar'}
            </button>
          </div>
        </div>
      </header>

      <div className="view-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: '0 0 70px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>emoji</label>
              <input value={p.editEmoji} onChange={e => p.setEditEmoji(e.target.value)} style={{ ...darkInput, textAlign: 'center' }} maxLength={4} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>descrição</label>
              <input value={p.editDesc} onChange={e => p.setEditDesc(e.target.value)} style={darkInput} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>
                requires.env (comma-separated, real names like JIRA_TOKEN)
              </label>
              <input value={p.editEnv} onChange={e => p.setEditEnv(e.target.value)} style={{ ...darkInput, fontFamily: 'monospace' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>
                requires.bins (comma-separated, e.g. curl,jq)
              </label>
              <input value={p.editBins} onChange={e => p.setEditBins(e.target.value)} style={{ ...darkInput, fontFamily: 'monospace' }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>SKILL.md (playbook body)</label>
            {p.preview ? (
              <div
                className="markdown-preview"
                style={{ ...darkInput, minHeight: '420px', padding: '12px 14px', overflowY: 'auto', fontSize: '12px', lineHeight: 1.55 }}
              >
                <ReactMarkdown>{p.editBody}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                value={p.editBody}
                onChange={e => p.setEditBody(e.target.value)}
                spellCheck={false}
                data-testid="skill-body-editor"
                style={monoTextarea}
              />
            )}
          </div>

          {auxFiles.length > 0 && (
            <div>
              <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>arquivos auxiliares (read-only)</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {auxFiles.map(f => (
                  <span key={`${f.group}/${f.file}`} style={{ ...darkInput, width: 'auto', fontFamily: 'monospace', fontSize: '10px', padding: '3px 8px' }}>
                    {f.group}/{f.file}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: '10px', color: 'var(--text-ghost)', paddingBottom: '20px' }}>
            dir: <code>{selected.dir}</code>
          </div>
        </div>
      </div>
    </div>
  );
};
