import { AppError, addProductPhotos, listProducts, saveProduct } from "@crm/core";
import { getDb } from "@crm/db";
import { withOrg } from "@/lib/api";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f-]{36}$/i;

export const GET = withOrg(async (req, ctx) => {
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  return Response.json({ products: await listProducts(getDb(), ctx.organizationId, { q }) });
});

/** Cria ou atualiza um produto (multipart: campos + fotos novas). */
export const POST = withOrg(async (req, ctx) => {
  const fd = await req.formData();
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : "";
  };
  const id = s("id");
  if (id && !uuid.test(id)) throw new AppError("not_found", "Produto não encontrado.");
  const db = getDb();
  const files = fd.getAll("photos").filter((f): f is File => typeof f !== "string" && f.size > 0);
  const productId = await saveProduct(db, ctx.actor, ctx.organizationId, id || null, {
    title: s("title"),
    description: s("description"),
    price: s("price"),
    priceLabel: s("priceLabel"),
    active: s("active") !== "off",
  });
  if (files.length)
    await addProductPhotos(
      db,
      ctx.actor,
      ctx.organizationId,
      productId,
      await Promise.all(
        files.map(async (f) => ({ name: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()) })),
      ),
    );
  return Response.json({ id: productId });
});
