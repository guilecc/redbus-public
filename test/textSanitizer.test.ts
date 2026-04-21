import { describe, it, expect } from 'vitest';
import { stripToPlainText } from '../electron/services/graph/textSanitizer';

describe('textSanitizer — Spec 11 §4', () => {
  it('1. Passa texto puro sem alterar (detecta ausência de <>)', () => {
    const out = stripToPlainText('olá mundo, tudo bem?');
    expect(out).toBe('olá mundo, tudo bem?');
  });

  it('2. Remove <script>, <style>, <head>, <img>, <svg>, <iframe>, <table>', () => {
    const html = `
      <head><meta charset="utf-8"></head>
      <style>.x{color:red}</style>
      <script>alert(1)</script>
      <p>Olá</p>
      <img src="x.png" alt="x"/>
      <svg><circle/></svg>
      <iframe src="x"></iframe>
      <table><tr><td>lixo</td></tr></table>
      <p>Mundo</p>
    `;
    const out = stripToPlainText(html);
    expect(out).toContain('Olá');
    expect(out).toContain('Mundo');
    expect(out).not.toMatch(/alert|color:red|lixo|<|>/);
  });

  it('3. Remove blockquotes e containers de quote (gmail_quote / yahoo_quoted)', () => {
    const html = `
      <p>Resposta nova</p>
      <blockquote>citação antiga</blockquote>
      <div class="gmail_quote">texto do gmail antigo</div>
      <div class="yahoo_quoted">texto do yahoo antigo</div>
    `;
    const out = stripToPlainText(html);
    expect(out).toContain('Resposta nova');
    expect(out).not.toMatch(/citação antiga|gmail antigo|yahoo antigo/);
  });

  it('4. Corta thread após cabeçalhos "From:" / "De:" / "Enviado em:"', () => {
    const html = `
      <p>mensagem nova</p>
      <p>De: Fulano</p>
      <p>Para: Ciclano</p>
      <p>Mensagem original abaixo</p>
    `;
    const out = stripToPlainText(html);
    expect(out).toContain('mensagem nova');
    expect(out).not.toMatch(/Fulano|Ciclano|original abaixo/);
  });

  it('5. Trunca em assinatura (--, Atenciosamente, Best regards, Sent from my)', () => {
    const t = 'Corpo relevante.\n\n--\nFulano de Tal\nfulano@empresa.com';
    const out = stripToPlainText(t, { plainInput: true });
    expect(out).toContain('Corpo relevante');
    expect(out).not.toMatch(/Fulano|empresa\.com/);
  });

  it('6. Remove disclaimer padrão em EN e PT', () => {
    const en = 'Hello.\n\nThis email and any files transmitted are confidential and privileged. Any unauthorized use is prohibited for anyone other than the intended recipient.';
    const pt = 'Oi.\n\nEsta mensagem é confidencial e dirigida apenas ao destinatário.';
    expect(stripToPlainText(en, { plainInput: true })).not.toMatch(/confidential|privileged/);
    expect(stripToPlainText(pt, { plainInput: true })).not.toMatch(/Esta mensagem|confidencial/);
  });

  it('7. Preserva Teams @mentions: <at id="0">Nome</at> → @Nome', () => {
    const html = '<div><at id="0">Maria Silva</at> pode revisar?</div>';
    const out = stripToPlainText(html);
    expect(out).toMatch(/@Maria Silva/);
    expect(out).toContain('pode revisar');
  });

  it('8. Converte <br> em quebras e <li> em bullets', () => {
    const html = '<p>linha1<br>linha2</p><ul><li>um</li><li>dois</li></ul>';
    const out = stripToPlainText(html);
    expect(out).toContain('linha1');
    expect(out).toContain('linha2');
    expect(out).toMatch(/• um/);
    expect(out).toMatch(/• dois/);
  });

  it('9. Decodifica entidades HTML comuns (&nbsp; &amp; &lt;)', () => {
    const html = '<p>a&nbsp;&amp;&nbsp;b &lt;c&gt;</p>';
    const out = stripToPlainText(html);
    expect(out).toMatch(/a & b <c>/);
  });

  it('10. Colapsa whitespace e newlines triplos', () => {
    const t = 'a\n\n\n\nb    c\t\td';
    const out = stripToPlainText(t, { plainInput: true });
    expect(out).toBe('a\n\nb c d');
  });

  it('11. Aplica cap de maxChars com sentinela "[truncado]"', () => {
    const big = 'x'.repeat(10_000);
    const out = stripToPlainText(big, { plainInput: true, maxChars: 200 });
    expect(out.length).toBeLessThanOrEqual(240);
    expect(out).toContain('[truncado]');
  });

  it('12. Retorna string vazia quando input é vazio ou undefined', () => {
    expect(stripToPlainText('')).toBe('');
    expect(stripToPlainText(undefined as any)).toBe('');
  });

  it('13. Aceita disclaimerPatterns customizados', () => {
    const t = 'corpo\n\nAVISO LEGAL CUSTOM: não copiar.';
    const out = stripToPlainText(t, {
      plainInput: true,
      disclaimerPatterns: [/AVISO LEGAL CUSTOM[\s\S]*/i],
    });
    expect(out).toContain('corpo');
    expect(out).not.toMatch(/AVISO LEGAL/);
  });

  it('14. HTML malformado não lança — faz fallback strip-tags', () => {
    const broken = '<p>oi<div><span>mundo</p>';
    const out = stripToPlainText(broken);
    expect(out).toMatch(/oi/);
    expect(out).toMatch(/mundo/);
    expect(out).not.toContain('<');
  });
});

