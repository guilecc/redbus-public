import React, { useState, useEffect } from 'react';
import { Download, CheckCircle2, PlayCircle, Loader2, HardDrive } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface Props {
  ollamaUrl: string;
  setOllamaUrl: (url: string) => void;
  onModelSet: (role: 'workerModel' | 'maestroModel', value: string) => void;
  onInstalledChange?: (models: string[]) => void;
}

export function OllamaSettings({ ollamaUrl, setOllamaUrl, onModelSet, onInstalledChange }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<Record<string, { status: string; pct: number }>>({});

  useEffect(() => {
    if (onInstalledChange) onInstalledChange(installed);
  }, [installed, onInstalledChange]);

  const LLM_CATALOG = [
    // GLM 5.1
    { id: 'glm4:2b', label: 'GLM 5.1 (2B)', family: 'GLM', req: '4GB', role: 'maestro', isWeak: true },
    { id: 'glm4:9b', label: 'GLM 5.1 (9B)', family: 'GLM', req: '10GB', role: 'worker' },
    { id: 'glm4:24b', label: 'GLM 5.1 (24B)', family: 'GLM', req: '18GB', role: 'worker' },
    // Nemotron
    { id: 'nemotron-cascade-2:30b', label: 'Nemotron Cascade 2 (30B)', family: 'Nvidia', req: '24GB', role: 'worker' },
    // Qwen 3.5
    { id: 'qwen3.5:0.8b', label: 'Qwen 3.5 (0.8B)', family: 'Qwen', req: '1GB', role: 'maestro', isWeak: true },
    { id: 'qwen3.5:2b', label: 'Qwen 3.5 (2B)', family: 'Qwen', req: '2.7GB', role: 'maestro', isWeak: true },
    { id: 'qwen3.5:4b', label: 'Qwen 3.5 (4B)', family: 'Qwen', req: '3.4GB', role: 'maestro' },
    { id: 'qwen3.5:9b', label: 'Qwen 3.5 (9B)', family: 'Qwen', req: '6.6GB', role: 'worker' },
    { id: 'qwen3.5:27b', label: 'Qwen 3.5 (27B)', family: 'Qwen', req: '17GB', role: 'worker' },
    { id: 'qwen3.5:35b', label: 'Qwen 3.5 (35B)', family: 'Qwen', req: '24GB', role: 'worker' },
    { id: 'qwen3.5:122b', label: 'Qwen 3.5 (122B)', family: 'Qwen', req: '81GB', role: 'worker' },
    // Gemma 4
    { id: 'gemma4:e2b', label: 'Gemma 4 (E2B)', family: 'Google', req: '7.2GB', role: 'maestro', isWeak: true },
    { id: 'gemma4:e4b', label: 'Gemma 4 (E4B)', family: 'Google', req: '9.6GB', role: 'maestro' },
    { id: 'gemma4:26b', label: 'Gemma 4 (26B)', family: 'Google', req: '18GB', role: 'worker' },
    { id: 'gemma4:31b', label: 'Gemma 4 (31B)', family: 'Google', req: '20GB', role: 'worker' },
    { id: 'gemma4:31b-cloud', label: 'Gemma 4 (31B Cloud)', family: 'Google', req: 'API', role: 'worker' },
  ];

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);

    if (window.redbusAPI?.onOllamaPullProgress) {
      window.redbusAPI.onOllamaPullProgress((data) => {
        setDownloads(prev => {
          const next = { ...prev };
          if (data.error) {
            next[data.model] = { status: 'error', pct: 0 };
          } else if (data.status === 'success') {
            delete next[data.model];
            checkStatus();
          } else {
            const pct = data.total ? Math.round((data.completed || 0) / data.total * 100) : 0;
            next[data.model] = { status: data.status, pct };
          }
          return next;
        });
      });
    }

    return () => clearInterval(interval);
  }, [ollamaUrl]);

  const checkStatus = async () => {
    if (!window.redbusAPI?.getOllamaStatus) return;
    try {
      const isOk = await window.redbusAPI.getOllamaStatus(ollamaUrl);
      setStatus(isOk.data || false);
      if (isOk.data) {
        const list = await window.redbusAPI.listOllamaModels(ollamaUrl);
        if (list.status === 'OK' && list.data) {
          setInstalled(list.data.map(m => m.name));
        }
      } else {
        setInstalled([]);
      }
    } catch {
      setStatus(false);
      setInstalled([]);
    }
  };

  const handlePullUrl = (url: string) => {
    setOllamaUrl(url);
  };

  const handleDownload = async (modelId: string) => {
    if (!status) return;
    setDownloads(prev => ({ ...prev, [modelId]: { status: 'starting...', pct: 0 } }));
    await window.redbusAPI.pullOllamaModel(modelId, ollamaUrl);
  };

  return (
    <section className="settings-section">
      <div className="section-head">
        <h3>{t.settings.ollama.title}</h3>
        <p>{t.settings.ollama.subtitle}</p>
      </div>

      <div className="form-group" style={{ marginBottom: '16px' }}>
        <label>{t.settings.ollama.url}</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={ollamaUrl}
            onChange={(e) => handlePullUrl(e.target.value)}
            style={{ flex: 1 }}
          />
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '12px', fontWeight: 600,
            color: status === true ? '#10b981' : status === false ? '#ef4444' : '#888'
          }}>
            <HardDrive size={14} />
            {status === true ? t.settings.ollama.online : status === false ? t.settings.ollama.offline : t.settings.ollama.checking}
          </div>
        </div>
      </div>

      <div className="ollama-list-container" style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '8px',
        maxHeight: '340px',
        overflowY: 'auto'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#111', borderBottom: '1px solid rgba(255,255,255,0.1)', zIndex: 10 }}>
            <tr>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '1px' }}>MODEL</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-ghost)', textTransform: 'uppercase' }}>FAMILY</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--text-ghost)', textTransform: 'uppercase' }}>REQ</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--text-ghost)', textTransform: 'uppercase' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {LLM_CATALOG.map(model => {
              const isInstalled = installed.some(name => name.startsWith(model.id));
              const dl = downloads[model.id];

              return (
                <tr key={model.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.2s' }} className="table-row-hover">
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: isInstalled ? 'var(--text)' : 'var(--text-dim)' }}>{model.label}</span>
                      {isInstalled && <CheckCircle2 size={12} color="var(--accent)" />}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-ghost)' }}>{model.family}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-ghost)' }}>{model.req}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {dl ? (
                      <div style={{ fontSize: '10px', color: 'var(--accent)', fontWeight: 600 }}>{dl.status} {dl.pct}%</div>
                    ) : isInstalled ? (
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                        <button
                          className="save-btn"
                          style={{ fontSize: '9px', padding: '2px 8px', height: '22px' }}
                          onClick={() => onModelSet('maestroModel', `ollama/${model.id}`)}
                        >
                          MAE
                        </button>
                        <button
                          className="save-btn"
                          style={{ fontSize: '9px', padding: '2px 8px', height: '22px' }}
                          onClick={() => onModelSet('workerModel', `ollama/${model.id}`)}
                        >
                          WRK
                        </button>
                      </div>
                    ) : (
                      <button
                        className="save-btn"
                        style={{ fontSize: '9px', padding: '2px 10px', color: 'var(--accent)', height: '22px' }}
                        onClick={() => handleDownload(model.id)}
                        disabled={!status}
                      >
                        DOWNLOAD
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
