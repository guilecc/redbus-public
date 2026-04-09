export interface ModelOption {
  id: string;
  name: string;
}

export async function fetchAvailableModels(provider: 'openai' | 'anthropic' | 'google', apiKey: string): Promise<ModelOption[]> {
  if (!apiKey) throw new Error('API Key is required to fetch models');

  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    if (!response.ok) throw new Error(`OpenAI API Error: ${await response.text()}`);
    const data = await response.json();
    
    return data.data
      .filter((m: any) => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('o3'))
      .map((m: any) => ({
        id: m.id,
        name: m.id
      }))
      .sort((a: ModelOption, b: ModelOption) => b.id.localeCompare(a.id));
  }

  if (provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Chave de API inválida ou sem permissão');
      throw new Error(`Anthropic API Error: ${await response.text()}`);
    }
    const data = await response.json();
    
    return data.data
      .filter((m: any) => m.type === 'model' && m.id.includes('claude'))
      .map((m: any) => ({
        id: m.id,
        name: m.display_name || m.id
      }));
  }

  if (provider === 'google') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 400 || response.status === 403) throw new Error('Chave de API inválida ou sem permissão');
      throw new Error(`Google API Error: ${await response.text()}`);
    }
    const data = await response.json();
    
    return data.models
      .filter((m: any) => m.name.includes('gemini'))
      .map((m: any) => ({
        id: m.name.replace('models/', ''),
        name: m.displayName || m.name.replace('models/', '')
      }))
      .sort((a: ModelOption, b: ModelOption) => b.id.localeCompare(a.id));
  }

  throw new Error(`Unknown provider: ${provider}`);
}
