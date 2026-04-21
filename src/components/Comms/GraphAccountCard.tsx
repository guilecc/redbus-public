import React, { useState } from 'react';
import { Wifi, WifiOff, Loader2, RefreshCw, LogOut, Copy, ExternalLink } from 'lucide-react';
import type { CommsAuthStatus } from '../../types/ipc';

interface Props {
  status: CommsAuthStatus | null;
  onConnect: () => Promise<void> | void;
  onDisconnect: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  refreshing: boolean;
  // Device code state (while user is authenticating)
  deviceCode?: { userCode: string; verificationUri: string } | null;
}

export const GraphAccountCard: React.FC<Props> = ({ status, onConnect, onDisconnect, onRefresh, refreshing, deviceCode }) => {
  const [connecting, setConnecting] = useState(false);
  const connected = !!status?.connected;

  const handleConnect = async () => {
    setConnecting(true);
    try { await onConnect(); } finally { setConnecting(false); }
  };

  const copyCode = () => {
    if (deviceCode?.userCode) navigator.clipboard.writeText(deviceCode.userCode).catch(() => { });
  };

  const cls = `inbox-ch-card ${connected ? 'connected' : deviceCode ? 'authenticating' : 'disconnected'}`;

  return (
    <div className="comms-account-card">
      <div className={cls}>
        <span className="inbox-ch-icon">
          {connected ? <Wifi size={12} /> : deviceCode ? <Loader2 size={12} className="spin" /> : <WifiOff size={12} />}
        </span>
        <span className="inbox-ch-label">
          {connected ? (status?.displayName || status?.upn || 'Microsoft 365') : deviceCode ? 'aguardando login...' : 'Microsoft 365 (desconectado)'}
        </span>
        <span className="inbox-ch-status">
          {connected ? 'ON' : deviceCode ? 'AUTH' : 'OFF'}
        </span>
      </div>

      {deviceCode && !connected && (
        <div className="comms-device-code">
          <div className="comms-device-code-hint">
            acesse <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer">{deviceCode.verificationUri}</a> e digite:
          </div>
          <div className="comms-device-code-value">
            <code>{deviceCode.userCode}</code>
            <button type="button" onClick={copyCode} title="copiar código"><Copy size={11} /></button>
            <button type="button" onClick={() => window.open(deviceCode.verificationUri, '_blank')} title="abrir navegador"><ExternalLink size={11} /></button>
          </div>
        </div>
      )}

      <div className="comms-account-actions">
        {!connected && !deviceCode && (
          <button type="button" className="comms-account-btn primary" onClick={handleConnect} disabled={connecting}>
            {connecting ? <Loader2 size={11} className="spin" /> : <Wifi size={11} />}
            conectar Microsoft 365
          </button>
        )}
        {connected && (
          <>
            <button type="button" className="comms-account-btn" onClick={onRefresh} disabled={refreshing} title="sincronizar agora">
              {refreshing ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
              sincronizar
            </button>
            <button type="button" className="comms-account-btn danger" onClick={onDisconnect} title="desconectar">
              <LogOut size={11} /> sair
            </button>
          </>
        )}
      </div>
    </div>
  );
};

