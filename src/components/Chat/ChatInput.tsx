import React, { useState, useRef, useEffect } from 'react';
import { SendHorizontal, Paperclip, X } from 'lucide-react';
import { useTranslation } from '../../i18n/index.js';

interface ChatInputProps {
  onSend: (message: string, filePaths?: string[]) => void;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled }) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<{name: string, path: string}[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if ((text.trim() || attachedFiles.length > 0) && !disabled) {
      const filePaths = attachedFiles.map(f => f.path);
      onSend(text.trim(), filePaths.length > 0 ? filePaths : undefined);
      setText('');
      setAttachedFiles([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAttachClick = async () => {
    if (window.redbusAPI && window.redbusAPI.selectFiles) {
      const res = await window.redbusAPI.selectFiles();
      if (res.status === 'OK' && res.data) {
        const newFiles = res.data.map((path: string) => ({
          name: path.split('/').pop() || path.split('\\').pop() || 'Arquivo',
          path
        }));
        setAttachedFiles(prev => {
          const existingPaths = new Set(prev.map(f => f.path));
          const uniqueNew = newFiles.filter((f: any) => !existingPaths.has(f.path));
          return [...prev, ...uniqueNew];
        });
      }
    }
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'inherit';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 160)}px`;
    }
  }, [text]);

  return (
    <div className="chat-input-container">
      {attachedFiles.length > 0 && (
        <div className="file-previews">
          {attachedFiles.map((f, i) => (
            <div key={i} className="file-tag">
              <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}
              </span>
              <button 
                onClick={() => removeFile(i)} 
                className="file-tag-remove"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-input-inner">
        <button
          className="attach-button"
          onClick={handleAttachClick}
          disabled={disabled}
          title="Anexar arquivo (PDF, XLSX, DOCX, Imagens, etc.)"
        >
          <Paperclip size={16} />
        </button>
        <span className="chat-input-prefix">{'>'}</span>
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          placeholder={t.chat.inputPlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />
        <button 
          className={`send-button ${!(text.trim() || attachedFiles.length > 0) || disabled ? 'disabled' : ''}`}
          onClick={handleSend}
          disabled={!(text.trim() || attachedFiles.length > 0) || disabled}
        >
          <SendHorizontal size={14} />
        </button>
      </div>
    </div>
  );
};
