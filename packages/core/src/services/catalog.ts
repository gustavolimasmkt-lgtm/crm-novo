import { auditLog, type Database, productPhotos, products } from "@crm/db";
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can } from "../auth/permissions.js";
import { parseCsv } from "../csv.js";
import { formatCents, parseMoneyToCents } from "../money.js";
import { AppError } from "./errors.js";

type ActorU = Actor & { userId: string };
const uuidRe = /^[0-9a-f-]{36}$/i;
export const MAX_PHOTOS = 8;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function requireSettings(actor: Actor) {
  if (!can(actor, "settings.manage"))
    throw new AppError("forbidden", "Só administradores e gestores mexem no catálogo.");
}

export type ProductRow = {
  id: string;
  title: string;
  description: string | null;
  priceCents: number | null;
  priceLabel: string | null;
  active: boolean;
  photoIds: string[];
  updatedAt: Date;
};

const photoIdsSql = sql<
  string[]
>`coalesce((select array_agg(pp.id order by pp.position, pp.created_at) from ${productPhotos} pp where pp.product_id = "products"."id"), '{}')`;

export async function listProducts(
  db: Database,
  organizationId: string,
  opts: { q?: string; onlyActive?: boolean } = {},
) {
  const conds: (SQL | undefined)[] = [eq(products.organizationId, organizationId)];
  if (opts.onlyActive) conds.push(eq(products.active, true));
  const q = opts.q?.trim();
  if (q) conds.push(or(ilike(products.title, `%${q}%`), ilike(products.description, `%${q}%`)));
  const rows = await db
    .select({
      id: products.id,
      title: products.title,
      description: products.description,
      priceCents: products.priceCents,
      priceLabel: products.priceLabel,
      active: products.active,
      photoIds: photoIdsSql,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(and(...conds))
    .orderBy(desc(products.active), asc(products.title));
  return rows as ProductRow[];
}

export function priceText(p: { priceCents: number | null; priceLabel: string | null }) {
  if (p.priceLabel?.trim())
    return /^\d/.test(p.priceLabel.trim()) ? `R$ ${p.priceLabel.trim()}` : p.priceLabel.trim();
  return p.priceCents != null ? formatCents(p.priceCents) : "sob consulta";
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Busca para o agente: tolerante a hífen, acento e ordem das palavras ("hrv", "HR-V", "honda hr v 2020").
 * Pontua por palavras encontradas no título (peso 3) e na descrição (peso 1).
 */
export async function searchCatalog(db: Database, organizationId: string, term: string, limit = 5) {
  const all = await listProducts(db, organizationId, { onlyActive: true });
  const words = norm(term)
    .split(" ")
    .filter(
      (w) =>
        w.length >= 2 &&
        !["de", "do", "da", "um", "uma", "o", "a", "com", "tem", "carro", "voces"].includes(w),
    );
  if (!words.length) return all.slice(0, limit);
  const scored = all
    .map((p) => {
      const t = norm(p.title);
      const tj = t.replace(/ /g, "");
      const d = norm(p.description ?? "");
      let score = 0;
      for (const w of words) {
        if (t.split(" ").includes(w) || tj.includes(w)) score += 3;
        else if (d.includes(w)) score += 1;
      }
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.p);
}

export const productInput = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(120),
  description: z.string().max(4000).optional().default(""),
  price: z.string().max(40).optional().default(""),
  priceLabel: z.string().trim().max(60).optional().default(""),
  active: z.boolean().default(true),
});

export async function saveProduct(
  db: Database,
  actor: ActorU,
  organizationId: string,
  id: string | null,
  raw: z.input<typeof productInput>,
) {
  requireSettings(actor);
  const input = productInput.parse(raw);
  const values = {
    title: input.title,
    description: input.description.trim() || null,
    priceCents: input.price.trim() ? parseMoneyToCents(input.price) : null,
    priceLabel: input.priceLabel || null,
    active: input.active,
    updatedAt: new Date(),
  };
  if (id) {
    const r = await db
      .update(products)
      .set(values)
      .where(and(eq(products.id, id), eq(products.organizationId, organizationId)))
      .returning({ id: products.id });
    if (!r.length) throw new AppError("not_found", "Produto não encontrado.");
    return id;
  }
  const [p] = await db
    .insert(products)
    .values({ organizationId, ...values })
    .returning({ id: products.id });
  if (!p) throw new Error("Falha ao criar produto");
  return p.id;
}

export async function deleteProduct(db: Database, actor: ActorU, organizationId: string, id: string) {
  requireSettings(actor);
  await db.delete(products).where(and(eq(products.id, id), eq(products.organizationId, organizationId)));
  await db.insert(auditLog).values({
    organizationId,
    actorId: actor.userId,
    action: "product.deleted",
    entity: "product",
    entityId: id,
  });
}

export async function addProductPhotos(
  db: Database,
  actor: ActorU,
  organizationId: string,
  productId: string,
  files: { name: string; mime: string; data: Buffer }[],
) {
  requireSettings(actor);
  if (!uuidRe.test(productId)) throw new AppError("not_found", "Produto não encontrado.");
  const p = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.organizationId, organizationId)),
  });
  if (!p) throw new AppError("not_found", "Produto não encontrado.");
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(productPhotos)
    .where(eq(productPhotos.productId, productId));
  if (Number(n) + files.length > MAX_PHOTOS)
    throw new AppError("validation", `Máximo de ${MAX_PHOTOS} fotos por produto.`);
  for (const [i, f] of files.entries()) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.mime))
      throw new AppError("validation", `${f.name}: use JPG, PNG ou WEBP.`);
    if (f.data.length > MAX_PHOTO_BYTES) throw new AppError("validation", `${f.name}: máximo 5 MB por foto.`);
    await db.insert(productPhotos).values({
      organizationId,
      productId,
      position: Number(n) + i,
      mime: f.mime,
      fileName: f.name.slice(0, 200),
      data: f.data,
    });
  }
}

export async function deleteProductPhoto(
  db: Database,
  actor: ActorU,
  organizationId: string,
  photoId: string,
) {
  requireSettings(actor);
  await db
    .delete(productPhotos)
    .where(and(eq(productPhotos.id, photoId), eq(productPhotos.organizationId, organizationId)));
}

export async function getProductPhoto(db: Database, organizationId: string, photoId: string) {
  if (!uuidRe.test(photoId)) throw new AppError("not_found", "Foto não encontrada.");
  const ph = await db.query.productPhotos.findFirst({
    where: and(eq(productPhotos.id, photoId), eq(productPhotos.organizationId, organizationId)),
  });
  if (!ph) throw new AppError("not_found", "Foto não encontrada.");
  return ph;
}

export async function photosOfProducts(
  db: Database,
  organizationId: string,
  productIds: string[],
  perProduct = 4,
) {
  if (!productIds.length) return [];
  const rows = await db
    .select()
    .from(productPhotos)
    .where(
      and(eq(productPhotos.organizationId, organizationId), inArray(productPhotos.productId, productIds)),
    )
    .orderBy(asc(productPhotos.position), asc(productPhotos.createdAt));
  const out: typeof rows = [];
  for (const id of productIds) out.push(...rows.filter((r) => r.productId === id).slice(0, perProduct));
  return out;
}

/**
 * Importa o catálogo: arquivo do agente antigo (.json, campo "catalogo") ou CSV (titulo;descricao;valor).
 * Produtos com o mesmo título são atualizados, não duplicados. Fotos do sistema antigo não vêm no arquivo.
 */
export async function importCatalog(db: Database, actor: ActorU, organizationId: string, text: string) {
  requireSettings(actor);
  const items: { title: string; description: string; price: string; priceLabel: string; active: boolean }[] =
    [];
  const trimmed = text.replace(/^﻿/, "").trim();
  if (trimmed.startsWith("{")) {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(trimmed);
    } catch {
      throw new AppError("validation", "JSON inválido.");
    }
    for (const c of (Array.isArray(d.catalogo) ? d.catalogo : []) as Record<string, unknown>[]) {
      items.push({
        title: String(c.titulo ?? "").trim(),
        description: String(c.descricao ?? ""),
        price: c.valor != null ? String(c.valor) : "",
        priceLabel: "",
        active: c.is_active !== false,
      });
    }
  } else {
    const rows = parseCsv(trimmed);
    const header = (rows.shift() ?? []).map((h) => norm(h));
    const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const it = col("titulo", "produto", "nome", "title");
    const id = col("descricao", "description");
    const iv = col("valor", "preco", "price");
    const il = col("etiqueta de valor", "valor label", "valor texto");
    if (it < 0) throw new AppError("validation", 'Não achei a coluna "titulo".');
    for (const r of rows)
      items.push({
        title: (r[it] ?? "").trim(),
        description: id >= 0 ? (r[id] ?? "") : "",
        price: iv >= 0 ? (r[iv] ?? "") : "",
        priceLabel: il >= 0 ? (r[il] ?? "").trim() : "",
        active: true,
      });
  }
  const valid = items.filter((i) => i.title);
  if (!valid.length) throw new AppError("validation", "Não encontrei produtos no arquivo.");
  let created = 0;
  let updated = 0;
  for (const i of valid.slice(0, 2000)) {
    const existing = await db.query.products.findFirst({
      where: and(
        eq(products.organizationId, organizationId),
        sql`lower(${products.title}) = lower(${i.title.slice(0, 120)})`,
      ),
    });
    const values = {
      title: i.title.slice(0, 120),
      description: i.description.trim().slice(0, 4000) || null,
      priceCents: i.price.trim()
        ? parseMoneyToCents(/^\d+$/.test(i.price.trim()) ? `${i.price.trim()},00` : i.price)
        : null,
      priceLabel: i.priceLabel.slice(0, 60) || null,
      active: i.active,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(products).set(values).where(eq(products.id, existing.id));
      updated++;
    } else {
      await db.insert(products).values({ organizationId, ...values });
      created++;
    }
  }
  return { created, updated };
}
