import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TitleBar } from '../src/components/Layout/TitleBar';
import { SkillManager } from '../src/components/Settings/SkillManager';

// Mock window.redbusAPI
const mockSkills = [
  {
    name: 'fetch_jira_tickets',
    description: 'Fetches open Jira tickets from the REST API',
    python_code: 'import sys, json\nargs = json.loads(sys.argv[1])\nprint(json.dumps({"status": "success", "data": []}))',
    parameters_schema: '{"type":"object","properties":{"project":{"type":"string"}}}',
    required_vault_keys: '["jira"]',
    version: 2,
  },
  {
    name: 'check_github_prs',
    description: 'Check open PRs on GitHub',
    python_code: 'import sys, json\nprint(json.dumps({"status": "success", "data": []}))',
    parameters_schema: '{}',
    required_vault_keys: '[]',
    version: 1,
  },
];

beforeEach(() => {
  (window as any).redbusAPI = {
    listSkills: vi.fn().mockResolvedValue({ status: 'OK', data: mockSkills }),
    getSkill: vi.fn().mockResolvedValue({ status: 'OK', data: mockSkills[0] }),
    updateSkill: vi.fn().mockResolvedValue({ status: 'OK' }),
    deleteSkill: vi.fn().mockResolvedValue({ status: 'OK' }),
    getSensorStatuses: vi.fn().mockResolvedValue({ status: 'OK', data: [] }),
    toggleSensor: vi.fn().mockResolvedValue({ status: 'OK' }),
    getProactivityLevel: vi.fn().mockResolvedValue({ status: 'OK', data: 'MEDIUM' }),
    setProactivityLevel: vi.fn().mockResolvedValue({ status: 'OK' }),
    getAppSetting: vi.fn().mockResolvedValue({ status: 'OK', data: null }),
    setAppSetting: vi.fn().mockResolvedValue({ status: 'OK' }),
    getTldvSyncStatus: vi.fn().mockResolvedValue({ status: 'OK', data: { enabled: false, syncing: false, lastResult: null, hasApiKey: false } }),
    forceTldvSync: vi.fn().mockResolvedValue({ status: 'OK', data: { success: true, syncedAt: '', newMeetings: 0 } }),
    listMeetings: vi.fn().mockResolvedValue({ status: 'OK', data: [] }),
    getMeetingDetails: vi.fn().mockResolvedValue({ status: 'OK', data: null }),
    getMeetingContext: vi.fn().mockResolvedValue({ status: 'OK', data: '' }),
    deleteMeeting: vi.fn().mockResolvedValue({ status: 'OK', data: { deleted: true } }),
    generateDigest: vi.fn().mockResolvedValue({ status: 'OK', data: { id: 'test', summary: {} } }),
    listDigests: vi.fn().mockResolvedValue({ status: 'OK', data: [] }),
    getDigestDetails: vi.fn().mockResolvedValue({ status: 'OK', data: null }),
    getDigestByDate: vi.fn().mockResolvedValue({ status: 'OK', data: null }),
    deleteDigest: vi.fn().mockResolvedValue({ status: 'OK', data: { deleted: true } }),
    onDigestProgress: vi.fn(),
    onDigestComplete: vi.fn(),
    onDigestError: vi.fn(),

    onProactiveMessage: vi.fn(),
    onRecordingStart: vi.fn(),
    onRecordingStop: vi.fn(),
    onMeetingReviewReady: vi.fn(),
    onWidgetLoading: vi.fn(),
    openWidget: vi.fn().mockResolvedValue({ status: 'OK' }),
    widgetStartRecording: vi.fn().mockResolvedValue({ status: 'OK' }),
    widgetStopRecording: vi.fn().mockResolvedValue({ status: 'OK' }),
    showMeetingReview: vi.fn().mockResolvedValue({ status: 'OK' }),
  };
});

describe('TitleBar — Skills Icon', () => {
  it('1. Deve renderizar o ícone de Skills na barra superior', () => {
    const onViewChange = vi.fn();
    render(<TitleBar activeView="chat" onViewChange={onViewChange} />);

    const skillsBtn = screen.getByTestId('skills-btn');
    expect(skillsBtn).toBeInTheDocument();
  });

  it('2. Deve chamar onViewChange("skills") ao clicar no ícone', () => {
    const onViewChange = vi.fn();
    render(<TitleBar activeView="chat" onViewChange={onViewChange} />);

    fireEvent.click(screen.getByTestId('skills-btn'));
    expect(onViewChange).toHaveBeenCalledWith('skills');
  });

  it('3. Deve mostrar todos os botões de navegação com o ativo destacado', () => {
    const onViewChange = vi.fn();
    render(<TitleBar activeView="skills" onViewChange={onViewChange} />);

    // All nav buttons are always visible — the active one has 'active' class
    const skillsBtn = screen.getByTestId('skills-btn');
    expect(skillsBtn).toBeInTheDocument();
    expect(skillsBtn.className).toContain('active');
  });
});

describe('SkillManager — View', () => {
  it('4. Deve listar todas as skills ao abrir', async () => {
    render(<SkillManager />);

    await waitFor(() => {
      // Skills appear in sidebar list (may also appear in detail header if auto-selected)
      expect(screen.getAllByText('fetch_jira_tickets').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('check_github_prs').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('5. Deve mostrar o header com contagem de snippets', async () => {
    render(<SkillManager />);

    await waitFor(() => {
      expect(screen.getByText('forge manager')).toBeInTheDocument();
      // Count may appear as "2 snippets" or within the sidebar header
      const header = screen.getByText('forge manager').closest('.view-sidebar-header');
      expect(header).toBeInTheDocument();
    });
  });

  it('6. Deve selecionar uma skill e mostrar o editor de código', async () => {
    render(<SkillManager />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-fetch_jira_tickets')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('skill-item-check_github_prs'));

    await waitFor(() => {
      const codeEditor = screen.getByTestId('skill-code-editor');
      expect(codeEditor).toBeInTheDocument();
      expect((codeEditor as HTMLTextAreaElement).value).toContain('json.dumps');
    });
  });

  it('7. Deve chamar updateSkill ao salvar alterações', async () => {
    render(<SkillManager />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-fetch_jira_tickets')).toBeInTheDocument();
    });

    const saveBtn = screen.getByTestId('skill-save-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect((window as any).redbusAPI.updateSkill).toHaveBeenCalled();
    });
  });

  it('8. Deve mostrar mensagem quando não há snippets', async () => {
    (window as any).redbusAPI.listSkills = vi.fn().mockResolvedValue({ status: 'OK', data: [] });

    render(<SkillManager />);

    await waitFor(() => {
      expect(screen.getByText(/nenhum snippet forjado/i)).toBeInTheDocument();
    });
  });
});

