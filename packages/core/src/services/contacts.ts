import { auditLog, contacts, conversations, type Database, whatsappConnections } from "@crm/db";
import { and, count, desc, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { parseCsv, toCsv } from "../csv.js";
import { normalizePhoneInput, phoneVariants } from "../whatsapp/evolution.js";
import { AppError } from "./errors.js";
import { notifyOrg } from "./events.js";

type ActorU = Actor & { userId: string };

function requireManage(actor: Actor) {
  if (!can(actor, "contacts.manage"))
    throw new AppError("forbidden", "Só administradores e gestores podem fazer isso com contatos.");
}

export type ContactRow = {
  id: string;
  name: string | null;
  pushName: string | null;
  email: string | null;
  phone: string | null;
  waVerified: boolean;
  createdAt: Date;
};

const cols = {
  id: contacts.id,
  name: contacts.name,
  pushName: contacts.pushName,
  email: contacts.email,
  phone: contacts.phone,
  waVerified: contacts.waVerified,
  createdAt: contacts.createdAt,
};

export async function listContacts(
  db: Database,
  _actor: ActorU,
  organizationId: string,
  opts: { q?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: ContactRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 10), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const conds: (SQL | undefined)[] = [eq(contacts.organizationId, organizationId)];
  const q = opts.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    conds.push(
      or(
        ilike(contacts.name, `%${q}%`),
        ilike(contacts.pushName, `%${q}%`),
        ilike(contacts.email, `%${q}%`),
        digits.length >= 3 ? ilike(contacts.phone, `%${digits}%`) : undefined,
      ),
    );
  }
  const where = and(...conds);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(contacts).where(where);
  const items = await db
    .select(cols)
    .from(contacts)
    .where(where)
    .orderBy(sql`lower(coalesce(${contacts.name}, ${contacts.pushName}, ${contacts.phone})) asc`)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total: Number(n), page, pageSize };
}

export async function getContact(db: Database, _actor: ActorU, organizationId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("not_found", "Contato não encontrado.");
  const [c] = await db
    .select(cols)
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.organizationId, organizationId)))
    .limit(1);
  if (!c) throw new AppError("not_found", "Contato não encontrado.");
  const convs = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      lastMessageAt: conversations.lastMessageAt,
      connectionName: whatsappConnections.name,
    })
    .from(conversations)
    .innerJoin(whatsappConnections, eq(whatsappConnections.id, conversations.connectionId))
    .where(eq(conversations.contactId, c.id))
    .orderBy(desc(conversations.lastMessageAt));
  return { ...c, conversations: convs };
}

const emailField = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "E-mail inválido.");

export const contactInput = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  email: emailField,
  phone: z.string().trim().min(8, "Informe o telefone com DDD."),
  landline: z.boolean().default(false),
});

async function findByPhone(db: Database, organizationId: string, phone: string) {
  const [c] = await db
    .select(cols)
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), inArray(contacts.phone, phoneVariants(phone))))
    .limit(1);
  return c ?? null;
}

export async function createContact(
  db: Database,
  actor: ActorU,
  organizationId: string,
  raw: z.input<typeof contactInput>,
) {
  const input = contactInput.parse(raw);
  const phone = normalizePhoneInput(input.phone, { landline: input.landline });
  if (!phone) throw new AppError("validation", "Telefone inválido. Use DDD + número.");
  const existing = await findByPhone(db, organizationId, phone);
  if (existing)
    throw new AppError(
      "conflict",
      `Já existe um contato com esse telefone (${existing.name ?? existing.pushName ?? phone}).`,
    );
  const [c] = await db
    .insert(contacts)
    .values({
      organizationId,
      waJid: `${phone}@s.whatsapp.net`,
      phone,
      name: input.name,
      email: input.email,
      waVerified: false,
    })
    .returning({ id: contacts.id });
  if (!c) throw new Error("Falha ao criar contato");
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "contact.created",
    entity: "contact",
    entityId: c.id,
  });
  return c.id;
}

export const contactUpdateInput = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  email: emailField,
});

/** Edita nome e e-mail. O telefone não muda (é a identidade no WhatsApp). */
export async function updateContact(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string,
  raw: z.input<typeof contactUpdateInput>,
) {
  const input = contactUpdateInput.parse(raw);
  await getContact(db, actor, organizationId, id);
  await db
    .update(contacts)
    .set({ name: input.name, email: input.email, updatedAt: new Date() })
    .where(eq(contacts.id, id));
  await notifyOrg(db, { o: organizationId, t: "conversation" });
}

/** Exclui o contato e todo o histórico de conversas dele. */
export async function deleteContact(db: Database, actor: ActorU, organizationId: string, id: string) {
  requireManage(actor);
  const c = await getContact(db, actor, organizationId, id);
  await db.delete(contacts).where(eq(contacts.id, id));
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "contact.deleted",
    entity: "contact",
    entityId: id,
    data: { name: c.name ?? c.pushName, phone: c.phone },
  });
  await notifyOrg(db, { o: organizationId, t: "conversation" });
}

/** Mesmo formato do sistema antigo: nome;email;telefone */
export async function exportContactsCsv(db: Database, actor: ActorU, organizationId: string) {
  requireManage(actor);
  const rows = await db
    .select(cols)
    .from(contacts)
    .where(eq(contacts.organizationId, organizationId))
    .orderBy(sql`lower(coalesce(${contacts.name}, ${contacts.pushName}, ${contacts.phone})) asc`);
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "contact.exported",
    data: { total: rows.length },
  });
  return toCsv([
    ["nome", "email", "telefone"],
    ...rows.map((r) => [r.name ?? r.pushName ?? "", r.email ?? "", r.phone ?? ""]),
  ]);
}

const HEADERS: Record<string, string[]> = {
  name: ["nome", "name", "nome completo"],
  phone: ["telefone", "phone", "celular", "whatsapp", "numero", "número"],
  email: ["email", "e-mail"],
  landline: ["fixo"],
  kind: ["tipo"],
};

function norm(h: string) {
  return h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export type ImportResult = {
  total: number;
  created: number;
  existing: number;
  invalid: { line: number; reason: string }[];
  /** Linhas com tipo criar_negociacao: só o contato foi importado (negociações chegam com o CRM). */
  dealRows: number;
};

export const MAX_IMPORT_ROWS = 20_000;

/**
 * Importa contatos de CSV (o export do sistema antigo ou o modelo de importação).
 * Telefone já existente não duplica: o contato é reaproveitado e só ganha o que faltava (nome, e-mail).
 */
export async function importContactsCsv(
  db: Database,
  actor: ActorU,
  organizationId: string,
  csv: string,
  opts: { brazil?: boolean } = {},
): Promise<ImportResult> {
  requireManage(actor);
  const rows = parseCsv(csv);
  const header = rows.shift()?.map(norm) ?? [];
  const idx = (k: string) => header.findIndex((h) => (HEADERS[k] ?? []).map(norm).includes(h));
  const iName = idx("name");
  const iPhone = idx("phone");
  const iEmail = idx("email");
  const iFixo = idx("landline");
  const iKind = idx("kind");
  if (iPhone < 0)
    throw new AppError("validation", 'Não achei a coluna de telefone (use o cabeçalho "telefone").');
  if (rows.length > MAX_IMPORT_ROWS)
    throw new AppError(
      "validation",
      `Arquivo grande demais: máximo ${MAX_IMPORT_ROWS.toLocaleString("pt-BR")} linhas por vez.`,
    );

  const result: ImportResult = { total: rows.length, created: 0, existing: 0, invalid: [], dealRows: 0 };
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    const rawPhone = (r[iPhone] ?? "").trim();
    const landline = iFixo >= 0 && /^(s|sim|x|1|true)$/i.test((r[iFixo] ?? "").trim());
    const digits = rawPhone.replace(/\D/g, "");
    // Número completo com 55 é guardado como veio (o WhatsApp usa muitos números sem o 9).
    const phone =
      opts.brazil !== false && digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
        ? digits
        : normalizePhoneInput(rawPhone, { brazil: opts.brazil, landline });
    if (!phone) {
      result.invalid.push({ line, reason: rawPhone ? `Telefone inválido: ${rawPhone}` : "Sem telefone" });
      continue;
    }
    if (iKind >= 0 && /negocia/i.test(r[iKind] ?? "")) result.dealRows++;
    const key = phoneVariants(phone).sort()[0] ?? phone;
    if (seen.has(key)) {
      result.existing++;
      continue;
    }
    seen.add(key);
    let name = iName >= 0 ? (r[iName] ?? "").trim().slice(0, 80) : "";
    if (name.replace(/\D/g, "") === digits && digits) name = ""; // nome igual ao número: sem nome
    const emailRaw = iEmail >= 0 ? (r[iEmail] ?? "").trim().toLowerCase() : "";
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw) ? emailRaw.slice(0, 120) : null;

    const found = await findByPhone(db, organizationId, phone);
    if (found) {
      result.existing++;
      if ((!found.name && name) || (!found.email && email)) {
        await db
          .update(contacts)
          .set({
            ...(!found.name && name ? { name } : {}),
            ...(!found.email && email ? { email } : {}),
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, found.id));
      }
      continue;
    }
    await db
      .insert(contacts)
      .values({
        organizationId,
        waJid: `${phone}@s.whatsapp.net`,
        phone,
        name: name || null,
        email,
        waVerified: false,
      })
      .onConflictDoNothing();
    result.created++;
  }
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "contact.imported",
    data: {
      total: result.total,
      created: result.created,
      existing: result.existing,
      invalid: result.invalid.length,
    },
  });
  return result;
}
