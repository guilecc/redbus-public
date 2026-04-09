import React, { useState, useEffect } from 'react';
import { Download, CheckCircle2, PlayCircle, Loader2, HardDrive } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface Props {
  ollamaUrl: string;
  setOllamaUrl: (url: string) => void;
  onModelSet: (role: 'workerModel' | 'maestroModel', value: string) => void;
}

export function OllamaSettings({ ollamaUrl, setOllamaUrl, onModelSet }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<Record<string, { status: string; pct: number }>>({});

  const isPT = t.settings.title === 'configurações'; // Simple check to localize data if not fully parameterized

  const GEMMA_MODELS = [
    {
      id: 'gemma:2b',
      label: 'Gemma 4 E2B (2.3B)',
      req: isPT ? '4-5 GB RAM (CPU/GPU Integrada)' : '4-5 GB RAM (CPU/Integrated GPU)',
      desc: isPT ? 'Versão mais leve. Ideal como Maestro conversacional.' : 'Lightest version. Ideal as conversational Maestro.',
      role: 'maestro',
      isWeak: true
    },
    {
      id: 'gemma:7b',
      label: 'Gemma 4 E4B (4.5B)',
      req: isPT ? '5-6 GB RAM (GPUs Entrada)' : '5-6 GB RAM (Entry-level GPUs)',
      desc: isPT ? 'Rápido em PCs modernos. Ótimo como Maestro diário.' : 'Fast on modern PCs. Great as daily Maestro.',
      role: 'maestro',
      isWeak: true
    },
    {
      id: 'gemma:27b',
      label: 'Gemma 4 26B A4B (MoE)',
      req: isPT ? '16-18 GB VRAM (M-Series / RTX 3090+)' : '16-18 GB VRAM (M-Series / RTX 3090+)',
      desc: isPT ? 'Exige hardware robusto. Ideal como Worker executor.' : 'Requires robust hardware. Ideal as executor Worker.',
      role: 'worker'
    },
    {
      id: 'gemma:70b',
      label: 'Gemma 4 31B (Dense)',
      req: isPT ? '17-20 GB VRAM (Workstations)' : '17-20 GB VRAM (Workstations)',
      desc: isPT ? 'Capacidade lógica máxima. Worker de elite local.' : 'Max logical capacity. Elite local Worker.',
      role: 'worker'
    }
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
            checkStatus(); // Refetch list
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
        {status === false && (
          <p style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
            {t.settings.ollama.hint}
          </p>
        )}
      </div>

      <div className="ollama-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '12px' }}>
        {GEMMA_MODELS.map(model => {
          const isInstalled = installed.some(name => name.startsWith(model.id));
          const dl = downloads[model.id];

          return (
            <div key={model.id} style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${isInstalled ? 'rgba(255,107,43,0.3)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {model.label}
                  {isInstalled && <CheckCircle2 size={14} color="#ff6b2b" />}
                </strong>
                <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                  {model.role === 'worker' ? t.settings.ollama.worker : t.settings.ollama.maestro}
                </span>
              </div>
              <p style={{ fontSize: '11px', color: '#aaa', margin: 0 }}>
                <strong>{t.settings.ollama.reqLabel}</strong> {model.req}
              </p>
              <p style={{ fontSize: '12px', color: '#ccc', margin: 0 }}>{model.desc}</p>
              
              <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
                {dl ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#ff6b2b' }}>
                      <span>{dl.status}</span>
                      <span>{dl.pct}%</span>
                    </div>
                    <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${dl.pct}%`, background: '#ff6b2b', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                ) : isInstalled ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button 
                      className="save-btn" 
                      style={{ flex: 1, background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.3)', color: '#ff6b2b', fontSize: '11px', padding: '4px 0' }}
                      onClick={() => onModelSet('maestroModel', `ollama/${model.id}`)}
                    >
                      {t.settings.ollama.setMaestro}
                    </button>
                    <button 
                      className="save-btn" 
                      style={{ flex: 1, background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.3)', color: '#ff6b2b', fontSize: '11px', padding: '4px 0' }}
                      onClick={() => onModelSet('workerModel', `ollama/${model.id}`)}
                    >
                      {t.settings.ollama.setWorker}
                    </button>
                  </div>
                ) : (
                  <button 
                    className="save-btn" 
                    style={{ width: '100%', display: 'flex', gap: '6px', justifyContent: 'center' }}
                    onClick={() => handleDownload(model.id)}
                    disabled={!status}
                  >
                    <Download size={14} /> {t.settings.ollama.download}
                  </button>
                )}
                {isInstalled && (model as any).isWeak && (
                  <p style={{ fontSize: '10px', color: '#ff4b2b', marginTop: '8px', fontStyle: 'italic', opacity: 0.8 }}>
                    {t.settings.ollama.workerWarning}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
