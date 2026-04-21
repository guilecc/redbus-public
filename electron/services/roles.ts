/**
 * Named roles for LLM call sites (Spec 06).
 *
 * Each call site resolves a semantic role ('planner' | 'executor' |
 * 'synthesizer' | 'utility') to a concrete `RoleBinding` (model + optional
 * thinking level + temperature) via `resolveRole`. `chatWithRole` is the
 * one-shot convenience wrapper that dispatches to the matching
 * `ProviderPlugin` from the Spec 01 registry.
 */
import { getProviderForModel } from '../plugins';
import type { ChatOptions, ChatResult } from '../plugins/types';
import { normalizeThinkLevel, type ThinkLevel } from './thinking';

export type RoleName = 'planner' | 'executor' | 'synthesizer' | 'utility' | 'digest';

export const ROLE_NAMES: RoleName[] = ['planner', 'executor', 'synthesizer', 'utility', 'digest'];

/**
 * Subset of roles whose configuration is required to consider onboarding
 * complete. `digest` is optional — it's a specialized long-context role that
 * falls back to `utility` → `executor` at call sites when unbound, so
 * existing installs keep working without re-running the wizard.
 */
export const REQUIRED_ROLE_NAMES: RoleName[] = ['planner', 'executor', 'synthesizer', 'utility'];

export interface RoleBinding {
  model: string;
  thinkingLevel?: ThinkLevel;
  temperature?: number;
}

/**
 * Roles are partial by design — onboarding leaves them empty until the user
 * picks a model for each one. Runtime call sites must resolve through
 * `resolveRole`, which throws `SetupRequiredError` when a role is unbound.
 */
export type RolesMap = Partial<Record<RoleName, RoleBinding>>;

/** Empty default — forces the user through onboarding before any LLM call. */
export const DEFAULT_ROLES: RolesMap = {};

/** JSON string used as the SQL column default. Empty object = setup required. */
export const DEFAULT_ROLES_JSON = '{}';

/**
 * Thrown when a semantic role is resolved before the user has completed
 * onboarding (or after a `setup:reset`). The UI layer surfaces this as a
 * prompt to open the onboarding shell.
 */
export class SetupRequiredError extends Error {
  readonly code = 'SETUP_REQUIRED';
  readonly missingRole?: RoleName;
  constructor(missingRole?: RoleName) {
    super(missingRole ? `Role '${missingRole}' is not configured` : 'Setup required');
    this.name = 'SetupRequiredError';
    this.missingRole = missingRole;
  }
}

/**
 * Parse the `roles` JSON column from a ProviderConfigs row. Returns a
 * possibly-partial map — roles the user has not yet configured are simply
 * absent (no silent fallback to a built-in model).
 */
export function parseRolesJson(raw: unknown): RolesMap {
  const out: RolesMap = {};
  let parsed: any = null;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  } else if (raw && typeof raw === 'object') {
    parsed = raw;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  for (const name of ROLE_NAMES) {
    const entry = parsed[name];
    if (!entry || typeof entry !== 'object') continue;
    const model = typeof entry.model === 'string' && entry.model.trim() ? entry.model : '';
    if (!model) continue;
    const binding: RoleBinding = { model };
    if (entry.thinkingLevel !== undefined) {
      binding.thinkingLevel = normalizeThinkLevel(entry.thinkingLevel, 'medium');
    }
    if (typeof entry.temperature === 'number') binding.temperature = entry.temperature;
    out[name] = binding;
  }
  return out;
}

/** Serialize a RolesMap for persistence. */
export function serializeRolesJson(roles: RolesMap): string {
  return JSON.stringify(roles);
}

function loadRolesFromDb(db: any): RolesMap {
  try {
    const row = db.prepare('SELECT roles FROM ProviderConfigs WHERE id = 1').get() as any;
    return parseRolesJson(row?.roles);
  } catch {
    return {};
  }
}

/**
 * Resolve a semantic role to its concrete binding. Throws
 * `SetupRequiredError` when the role is not configured so the UI can surface
 * the onboarding screen instead of silently calling a phantom model.
 */
export function resolveRole(db: any, role: RoleName): RoleBinding {
  const roles = loadRolesFromDb(db);
  const binding = roles[role];
  if (!binding || !binding.model) throw new SetupRequiredError(role);
  return binding;
}

/**
 * Resolve the thinking level for a role, clamped to levels the provider
 * actually supports. Returns `undefined` when the provider has no thinking
 * capability — matches the `resolveThinkLevel` helper it replaces.
 */
export function resolveThinkLevelForRole(db: any, role: RoleName): ThinkLevel | undefined {
  const binding = resolveRole(db, role);
  try {
    const provider = getProviderForModel(binding.model);
    const capability = provider.capabilities?.thinking;
    if (!capability) return undefined;
    const level = normalizeThinkLevel(binding.thinkingLevel, capability.default);
    return capability.supported.includes(level) ? level : undefined;
  } catch {
    return undefined;
  }
}

/** Load the full configs row from the DB (keys + roles). */
export function loadProviderConfigs(db: any): any {
  const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
  if (!configs) throw new Error('Provider configs not found');
  return configs;
}

/**
 * One-shot chat by role. Resolves the binding, dispatches to the matching
 * provider plugin, and returns the provider-agnostic `ChatResult`. Callers
 * MAY override `thinkingLevel` when they need faster turns than the user's
 * default (e.g. training loops that only need tool routing).
 */
export async function chatWithRole(
  db: any,
  role: RoleName,
  opts: Omit<ChatOptions, 'model' | 'configs'> & { configs?: Record<string, any> },
): Promise<ChatResult> {
  const binding = resolveRole(db, role);
  const configs = opts.configs ?? loadProviderConfigs(db);
  const resolvedThinking = resolveThinkLevelForRole(db, role);
  const { configs: _omitted, thinkingLevel: overrideThinking, ...rest } = opts;
  void _omitted;
  const provider = getProviderForModel(binding.model);
  const chatOpts: ChatOptions = {
    ...rest,
    model: binding.model,
    configs,
    thinkingLevel: overrideThinking ?? resolvedThinking,
  };
  if (binding.temperature !== undefined && chatOpts.temperature === undefined) {
    chatOpts.temperature = binding.temperature;
  }
  return provider.chat(chatOpts);
}

