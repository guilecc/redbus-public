import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TitleBar } from '../src/components/Layout/TitleBar';
import { SkillManager } from '../src/components/Settings/SkillManager';

// Mock window.redbusAPI — OC-style Markdown playbooks
const mockSkills = [
  {
    name: 'fetch_jira_tickets',
    description: 'Fetches open Jira tickets from the REST API',
    dir: '/tmp/skills/fetch_jira_tickets',
    emoji: '🎫',
    requires_env: ['JIRA_TOKEN'],
    requires_bins: ['curl', 'jq'],
    homepage: null,
    mtimeMs: 1_700_000_000_000,
  },
  {
    name: 'check_github_prs',
    description: 'Check open PRs on GitHub',
    dir: '/tmp/skills/check_github_prs',
    emoji: null,
    requires_env: ['GITHUB_TOKEN'],
    requires_bins: [],
    homepage: null,
    mtimeMs: 1_700_000_000_000,
  },
];

const mockSkillDetail = (name: string) => ({
  name,
  description: 'Fetches open Jira tickets from the REST API',
  body: `# ${name}\n\n## Steps\n1. curl the API.\n`,
  dir: `/tmp/skills/${name}`,
  bodyPath: `/tmp/skills/${name}/SKILL.md`,
  frontmatter: {
    name,
    description: 'Fetches open Jira tickets from the REST API',
    metadata: { emoji: '🎫', requires: { env: ['JIRA_TOKEN'], bins: ['curl', 'jq'] } },
  },
  scripts: [],
  references: [],
  assets: [],
});

beforeEach(() => {
  (window as any).redbusAPI = {
    listSkills: vi.fn().mockResolvedValue({ status: 'OK', data: mockSkills }),
    getSkill: vi.fn((name: string) => Promise.resolve({ status: 'OK', data: mockSkillDetail(name) })),
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
    getWindowPlatform: vi.fn().mockResolvedValue({ status: 'OK', data: 'darwin' }),
    isWindowMaximized: vi.fn().mockResolvedValue({ status: 'OK', data: false }),
    minimizeWindow: vi.fn().mockResolvedValue({ status: 'OK' }),
    maximizeWindow: vi.fn().mockResolvedValue({ status: 'OK' }),
    closeWindow: vi.fn().mockResolvedValue({ status: 'OK' }),
    closeWidget: vi.fn().mockResolvedValue({ status: 'OK' }),
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
      expect(screen.getByTestId('skill-item-fetch_jira_tickets')).toBeInTheDocument();
      expect(screen.getByTestId('skill-item-check_github_prs')).toBeInTheDocument();
    });
  });

  it('5. Deve mostrar o header "skills" na sidebar', async () => {
    render(<SkillManager />);

    await waitFor(() => {
      const h2 = screen.getByRole('heading', { level: 2, name: /skills/i });
      expect(h2).toBeInTheDocument();
      expect(h2.closest('.view-sidebar-header')).toBeInTheDocument();
    });
  });

  it('6. Deve selecionar uma skill e mostrar o editor de playbook (SKILL.md)', async () => {
    render(<SkillManager />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-fetch_jira_tickets')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('skill-item-check_github_prs'));

    await waitFor(() => {
      const bodyEditor = screen.getByTestId('skill-body-editor');
      expect(bodyEditor).toBeInTheDocument();
      expect((bodyEditor as HTMLTextAreaElement).value).toContain('## Steps');
      expect((bodyEditor as HTMLTextAreaElement).value).toContain('check_github_prs');
    });
  });

  it('7. Deve chamar updateSkill ao salvar alterações', async () => {
    render(<SkillManager />);

    await waitFor(() => {
      expect(screen.getByTestId('skill-item-fetch_jira_tickets')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('skill-save-btn')).toBeInTheDocument();
    });

    const saveBtn = screen.getByTestId('skill-save-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect((window as any).redbusAPI.updateSkill).toHaveBeenCalled();
    });

    const call = (window as any).redbusAPI.updateSkill.mock.calls[0][0];
    expect(call).toMatchObject({
      name: 'fetch_jira_tickets',
      description: expect.any(String),
      body: expect.any(String),
    });
  });

  it('8. Deve mostrar mensagem quando não há skills', async () => {
    (window as any).redbusAPI.listSkills = vi.fn().mockResolvedValue({ status: 'OK', data: [] });

    render(<SkillManager />);

    await waitFor(() => {
      expect(screen.getByText(/nenhuma skill salva/i)).toBeInTheDocument();
    });
  });
});

