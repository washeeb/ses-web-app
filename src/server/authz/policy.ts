import { AppError, forbidden } from "../lib/errors";
import { PERMISSIONS, type Domain, type Permission } from "./permissions";

export interface Grant {
  permissions: ReadonlySet<string>;
  organizationId: string;
  organizationType: Domain;
  departmentId: string | null;
}

export interface Actor {
  userId: string;
  name: string;
  email: string;
  organizationId: string;
  organizationType: Domain;
  sessionId: string | null;
  mfaVerified: boolean;
  grants: Grant[];
}

/** What is being acted on. Omit fields that do not apply. */
export interface ResourceScope {
  organizationId?: string | null;
  departmentId?: string | null;
}

function grantAllows(grant: Grant, perm: Permission, res: ResourceScope): boolean {
  if (!grant.permissions.has(perm)) return false;
  const def = PERMISSIONS[perm];
  // A permission only takes effect inside an organisation of its own domain.
  if (grant.organizationType !== def.domain) return false;
  // Partner and customer permissions never cross organisation boundaries.
  if (def.domain !== "operator" && res.organizationId !== undefined && res.organizationId !== grant.organizationId) {
    return false;
  }
  // Department-scoped grants only reach that department's records (or shared records with no department).
  if (grant.departmentId && res.departmentId && res.departmentId !== grant.departmentId) return false;
  return true;
}

export function can(actor: Actor, perm: Permission, res: ResourceScope = {}): boolean {
  if (PERMISSIONS[perm].privileged && !actor.mfaVerified) return false;
  return actor.grants.some((g) => grantAllows(g, perm, res));
}

export function authorize(actor: Actor, perm: Permission, res: ResourceScope = {}): void {
  if (can(actor, perm, res)) return;
  const held = actor.grants.some((g) => grantAllows(g, perm, res));
  if (held && PERMISSIONS[perm].privileged && !actor.mfaVerified) {
    throw new AppError("mfa_required", "This action requires multi-factor authentication.");
  }
  throw forbidden();
}

/** True if any held permission is privileged (MFA becomes mandatory). */
export function isPrivileged(grants: Grant[]): boolean {
  return grants.some((g) => [...g.permissions].some((p) => PERMISSIONS[p as Permission]?.privileged));
}

/** Department ids the actor is limited to for a permission; null means unrestricted. */
export function departmentFilter(actor: Actor, perm: Permission): string[] | null {
  const grants = actor.grants.filter((g) => grantAllows(g, perm, {}));
  if (grants.some((g) => g.departmentId === null)) return null;
  return grants.map((g) => g.departmentId).filter((d): d is string => d !== null);
}
