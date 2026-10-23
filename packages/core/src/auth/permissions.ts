import type { Role } from "@crm/db/schema";

/**
 * Matriz de permissões proposta (docs/permissoes.md). O Master da plataforma não aparece aqui:
 * ele tem acesso total a qualquer empresa e ao painel /master.
 */
export const PERMISSIONS = {
  "org.manage": ["admin"],
  "members.manage": ["admin"],
  "members.view": ["admin", "manager"],
  "departments.manage": ["admin"],
  "connections.manage": ["admin"],
  "settings.manage": ["admin", "manager"],
  "reports.view": ["admin", "manager"],
  "deals.view_all": ["admin", "manager"],
  "deals.reassign": ["admin", "manager"],
  "deals.view_values": ["admin", "manager", "seller"],
  "conversations.view_all": ["admin", "manager"],
  "conversations.take": ["admin", "manager", "seller", "agent"],
  /** Excluir, importar e exportar contatos. Ver, criar e editar: todos. */
  "contacts.manage": ["admin", "manager"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export type Actor = { isMaster: boolean; role: Role | null };

export function can(actor: Actor, permission: Permission): boolean {
  if (actor.isMaster) return true;
  if (!actor.role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(actor.role);
}

/** Quem pode convidar quem: admin convida qualquer papel; gestor convida vendedor e atendente. */
export function canInviteRole(actor: Actor, target: Role): boolean {
  if (actor.isMaster || actor.role === "admin") return true;
  if (actor.role === "manager") return target === "seller" || target === "agent";
  return false;
}
