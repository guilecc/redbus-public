import React, { useState, useEffect, useCallback } from 'react';
import { Archive, Trash2, FileText } from 'lucide-react';

interface ArchiveFile {
  filename: string;
  label: string;
  sizeBytes: number;
}

export const HistoryView: React.FC = () => {
  const [archives, setArchives] = useState<ArchiveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);

  const fetchArchives = useCallback(async () => {
    try {
      if (window.redbusAPI) {
        const res = await window.redbusAPI.getArchives();
        if (res.status === 'OK' && res.data) {
          setArchives(res.data as ArchiveFile[]);
        }
      }
    } catch (e) {
      console.error('[History] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArchives();
  }, [fetchArchives]);

  const handleDeleteArchive = async (filename: string) => {
    if (!window.redbusAPI) return;
    await window.redbusAPI.deleteArchive(filename);
    setArchives(prev => prev.filter(a => a.filename !== filename));
    if (selectedFilename === filename) {
      setSelectedFilename(null);
    }
  };

  const selectedArchive = archives.find(a => a.filename === selectedFilename) || null;

  return (
    <div className="view-layout">
      {/* Sidebar */}
      <aside className="view-sidebar">
        <div className="view-sidebar-header">
          <h2><Archive size={16} style={{ display: 'inline', verticalAlign: 'sub', marginRight: '6px' }} /> histórico</h2>
        </div>
        <div className="view-sidebar-list">
          {loading ? (
            <p className="view-empty">carregando...</p>
          ) : archives.length === 0 ? (
            <p className="view-empty">nenhum arquivo salvo</p>
          ) : (
            archives.map(a => (
              <div 
                key={a.filename} 
                className={`view-sidebar-item${selectedFilename === a.filename ? ' active' : ''}`}
                onClick={() => setSelectedFilename(a.filename)}
              >
                <div className="view-sidebar-item-title">{a.label}</div>
                <div className="view-sidebar-item-meta">
                  <span>{(a.sizeBytes / 1024).toFixed(1)} KB</span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Detail Area */}
      <main className="view-detail">
        {!selectedArchive ? (
          <div className="view-detail-empty">
            <Archive size={32} strokeWidth={1} />
            <p>selecione um arquivo para visualizar</p>
          </div>
        ) : (
          <div className="view-detail-content">
            <header className="view-detail-header">
              <div className="view-detail-title-row">
                <h1>{selectedArchive.label}</h1>
                <button className="view-delete-btn" onClick={() => handleDeleteArchive(selectedArchive.filename)} title="Excluir arquivo">
                  <Trash2 size={13} />
                </button>
              </div>
            </header>
            <div className="view-body">
              <div style={{ background: 'var(--bg-surface)', padding: '24px', borderRadius: '6px', border: '1px solid var(--border)', textAlign: 'center' }}>
                <FileText size={48} style={{ color: 'var(--text-dim)', marginBottom: '16px' }} />
                <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-primary)' }}>{selectedArchive.filename}</h3>
                <p style={{ margin: '0', fontSize: '12px', color: 'var(--text-ghost)' }}>Tamanho: {(selectedArchive.sizeBytes / 1024).toFixed(1)} KB</p>
                <p style={{ marginTop: '16px', fontSize: '11px', color: 'var(--text-dim)' }}>Arquivos JSON de memória são logados pelo sistema.<br/>O Maestro pode usá-los para consultas de histórico remoto.</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
