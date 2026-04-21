/**
 * Renderer-side mirror of the role types defined in
 * `electron/services/roles.ts`. Kept as a plain type module so both compile
 * targets (Vite / Electron main) can share the same shape without importing
 * across the process boundary.
 */

export type RoleName = 'planner' | 'executor' | 'synthesizer' | 'utility' | 'digest';

export const ROLE_NAMES: RoleName[] = ['planner', 'executor', 'synthesizer', 'utility', 'digest'];

/** Roles required for onboarding completion (digest is optional — see electron/services/roles.ts). */
export const REQUIRED_ROLE_NAMES: RoleName[] = ['planner', 'executor', 'synthesizer', 'utility'];

export type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive';

export interface RoleBinding {
  model: string;
  thinkingLevel?: ThinkLevel;
  temperature?: number;
}

/**
 * Roles are partial by design — onboarding leaves them empty until the user
 * picks a model for each one. Renderer components must handle the empty
 * case and surface the onboarding shell.
 */
export type RolesMap = Partial<Record<RoleName, RoleBinding>>;

/** Empty default — the backend enforces setup completion before any call. */
export const DEFAULT_ROLES: RolesMap = {};

