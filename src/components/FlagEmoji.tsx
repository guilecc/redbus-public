/**
 * FlagEmoji — renderiza bandeiras de países como imagens SVG da Twemoji CDN.
 *
 * Em Windows e Linux, os emojis de bandeira (Regional Indicator Symbols) não
 * são suportados pelas fontes do sistema (Segoe UI Emoji não tem bandeiras;
 * JetBrains Mono muito menos). A Twemoji resolve isso com SVGs.
 *
 * Uso: <FlagEmoji flag="🇧🇷" size={36} />
 */

import React from 'react';

interface FlagEmojiProps {
  /** Caractere(s) de bandeira Unicode, ex: "🇧🇷" ou "🇬🇧" */
  flag: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Converte um emoji de bandeira para o codepoint Twemoji.
 * Regional Indicator Symbols: cada letra é U+1F1E6..U+1F1FF
 * O código Twemoji é a concatenação dos dois codepoints em hex, separados por '-'.
 * Ex: 🇧🇷 = U+1F1E7 U+1F1F7 → "1f1e7-1f1f7"
 */
function flagToTwemojiCode(flag: string): string {
  const codePoints: string[] = [];
  for (const char of flag) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) {
      codePoints.push(cp.toString(16));
    }
  }
  return codePoints.join('-');
}

export const FlagEmoji: React.FC<FlagEmojiProps> = ({ flag, size = 36, className, style }) => {
  const code = flagToTwemojiCode(flag);
  // Twemoji CDN — Mozilla mirror (confiável, sem rate limit)
  const src = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${code}.svg`;

  return (
    <img
      src={src}
      alt={flag}
      width={size}
      height={size}
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))',
        ...style,
      }}
      draggable={false}
    />
  );
};
