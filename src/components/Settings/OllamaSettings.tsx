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
    // 1. Llama 4 (Meta)
    { id: 'llama4:8b', label: 'Llama 4 (8B)', family: 'Meta', req: '4.9GB', role: 'worker' },
    { id: 'llama4:70b', label: 'Llama 4 (70B)', family: 'Meta', req: '42GB', role: 'worker' },
    // 2. DeepSeek-V3.2 (DeepSeek)
    { id: 'deepseek-v3.2:7b', label: 'DeepSeek-V3.2 (7B)', family: 'DeepSeek', req: '4.2GB', role: 'maestro' },
    { id: 'deepseek-v3.2:70b', label: 'DeepSeek-V3.2 (70B)', family: 'DeepSeek', req: '43GB', role: 'worker' },
    { id: 'deepseek-v3.2:671b', label: 'DeepSeek-V3.2 (671B)', family: 'DeepSeek', req: '390GB', role: 'worker' },
    // 3. Qwen 3.5 (Alibaba)
    { id: 'qwen3.5:0.8b', label: 'Qwen 3.5 (0.8B)', family: 'Alibaba', req: '550MB', role: 'maestro', isWeak: true },
    { id: 'qwen3.5:4b', label: 'Qwen 3.5 (4B)', family: 'Alibaba', req: '2.6GB', role: 'maestro' },
    { id: 'qwen3.5:9b', label: 'Qwen 3.5 (9B)', family: 'Alibaba', req: '5.5GB', role: 'worker' },
    { id: 'qwen3.5:35b', label: 'Qwen 3.5 (35B)', family: 'Alibaba', req: '22GB', role: 'worker' },
    // 4. Gemma 4 (Google)
    { id: 'gemma4:e2b', label: 'Gemma 4 (E2B)', family: 'Google', req: '1.6GB', role: 'maestro', isWeak: true },
    { id: 'gemma4:e4b', label: 'Gemma 4 (E4B)', family: 'Google', req: '3.1GB', role: 'maestro' },
    { id: 'gemma4:26b', label: 'Gemma 4 (26B)', family: 'Google', req: '18GB', role: 'worker' },
    { id: 'gemma4:31b', label: 'Gemma 4 (31B)', family: 'Google', req: '20GB', role: 'worker' },
    // 5. Phi-4 (Microsoft)
    { id: 'phi4-mini:3.8b', label: 'Phi-4 Mini (3.8B)', family: 'Microsoft', req: '2.3GB', role: 'maestro' },
    { id: 'phi4:14b', label: 'Phi-4 (14B)', family: 'Microsoft', req: '9.1GB', role: 'worker' },
    // 6. Mistral / Ministral
    { id: 'ministral-3:3b', label: 'Ministral 3 (3B)', family: 'Mistral', req: '2.1GB', role: 'maestro' },
    { id: 'ministral-3:8b', label: 'Ministral 3 (8B)', family: 'Mistral', req: '5.2GB', role: 'worker' },
    { id: 'mistral-large-3:123b', label: 'Mistral Large 3 (123B)', family: 'Mistral', req: '78GB', role: 'worker' },
    // 7. Nemotron Cascade 2 (NVIDIA)
    { id: 'nemotron-cascade-2:30b', label: 'Nemotron Cascade 2 (30B)', family: 'Nvidia', req: '19GB', role: 'worker' },
    // 8. Command R+ v2 (Cohere)
    { id: 'command-r-v2:35b', label: 'Command R+ v2 (35B)', family: 'Cohere', req: '21GB', role: 'worker' },
    { id: 'command-r-v2:104b', label: 'Command R+ v2 (104B)', family: 'Cohere', req: '65GB', role: 'worker' },
    // 9. Qwen3-Coder-Next
    { id: 'qwen3-coder-next:7b', label: 'Qwen3 Coder Next (7B)', family: 'Alibaba', req: '4.5GB', role: 'worker' },
    { id: 'qwen3-coder-next:32b', label: 'Qwen3 Coder Next (32B)', family: 'Alibaba', req: '19GB', role: 'worker' },
    // 10. LFM-2.5-Thinking
    { id: 'lfm2.5-thinking:1.2b', label: 'LFM-2.5-Thinking (1.2B)', family: 'Liquid', req: '850MB', role: 'maestro', isWeak: true },
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
