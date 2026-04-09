import React, { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { MessageBubble, Message } from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  assistantName?: string;
  userName?: string;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, assistantName, userName }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="message-list" ref={scrollRef}>
      {messages.length === 0 && (
        <div className="empty-chat">
          <h1><Terminal size={16} style={{ display: 'inline', verticalAlign: 'sub', marginRight: '6px' }} /> sistema redbus pronto.</h1>
          <p>aguardando instruções para automação local.</p>
          <div className="suggestions">
            <button className="suggestion-chip">verificar notícias</button>
            <button className="suggestion-chip">resumo do dia</button>
            <button className="suggestion-chip">status do sistema</button>
          </div>
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} assistantName={assistantName} userName={userName} />
      ))}
    </div>
  );
};
