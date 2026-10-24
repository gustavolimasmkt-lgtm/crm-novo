"use client";

import { ImagePlus, Package, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { Badge, Button, cx, Field, Input, Notice } from "@/components/ui";

type Product = {
  id: string;
  title: string;
  description: string | null;
  priceCents: number | null;
  priceLabel: string | null;
  active: boolean;
  photoIds: string[];
  updatedAt: string;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function price(p: Product) {
  if (p.priceLabel?.trim()) return /^\d/.test(p.priceLabel) ? `R$ ${p.priceLabel}` : p.priceLabel;
  return p.priceCents != null ? brl.format(p.priceCents / 100) : "Sob consulta";
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Reduz fotos grandes do celular antes de enviar (lado maior 1600 px, JPEG). */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 900_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function CatalogClient({
  initial,
  canEdit,
  maxPhotos,
}: {
  initial: Product[];
  canEdit: boolean;
  maxPhotos: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const t = norm(q);
    if (!t) return initial;
    return initial.filter((p) => norm(`${p.title} ${p.description ?? ""}`).includes(t));
  }, [q, initial]);

  async function importFile(f: File) {
    setMsg(null);
    const fd = new FormData();
    fd.set("file", f);
    const r = await fetch("/api/catalogo/importar", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) return setMsg({ tone: "danger", text: j.error ?? "Não consegui importar." });
    setMsg({
      tone: "ok",
      text: `Importado: ${j.created} novo(s), ${j.updated} atualizado(s). Fotos não vêm no arquivo: adicione em cada item.`,
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar no catálogo"
            className="pl-9"
            aria-label="Buscar no catálogo"
          />
        </div>
        {canEdit && (
          <>
            <Button variant="secondary" onClick={() => importRef.current?.click()}>
              <Upload size={16} /> Importar
            </Button>
            <input
              ref={importRef}
              type="file"
              accept=".json,.csv,text/csv,application/json"
              className="hidden"
              data-testid="importar-catalogo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) importFile(f);
              }}
            />
            <Button onClick={() => setEditing("new")}>
              <Plus size={16} /> Novo item
            </Button>
          </>
        )}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {list.length === 0 ? (
        <div className="rounded-[var(--radius-card)] bg-surface px-6 py-14 text-center">
          <Package className="mx-auto text-ink-3" size={36} />
          <p className="mt-3 text-[17px] font-semibold">
            {initial.length ? "Nada encontrado" : "Catálogo vazio"}
          </p>
          <p className="mt-1 text-[14px] text-ink-2">
            {initial.length
              ? "Tente outro termo."
              : "Cadastre os itens (ou importe o arquivo do sistema antigo) para o agente responder sobre estoque e preços."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setEditing(p)}
                className="flex w-full gap-3 rounded-[var(--radius-card)] bg-surface p-3 text-left transition hover:brightness-[0.98]"
              >
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-fill">
                  {p.photoIds[0] ? (
                    // biome-ignore lint/performance/noImgElement: foto privada servida pela API
                    <img
                      src={`/api/catalogo/fotos/${p.photoIds[0]}`}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Package size={24} className="text-ink-3" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cx("line-clamp-2 text-[15px] font-semibold", !p.active && "text-ink-3")}>
                    {p.title}
                  </p>
                  <p className="mt-0.5 text-[15px] text-accent">{price(p)}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {!p.active && <Badge>Inativo</Badge>}
                    <Badge tone={p.photoIds.length ? "neutral" : "warn"}>
                      {p.photoIds.length} foto{p.photoIds.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ProductSheet
          product={editing === "new" ? null : editing}
          canEdit={canEdit}
          maxPhotos={maxPhotos}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ProductSheet({
  product,
  canEdit,
  maxPhotos,
  onClose,
  onSaved,
}: {
  product: Product | null;
  canEdit: boolean;
  maxPhotos: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState(product?.photoIds ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  const room = maxPhotos - photos.length - files.length;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set("active", fd.get("active") === "on" ? "on" : "off");
      if (product) fd.set("id", product.id);
      fd.delete("photos");
      for (const f of files) fd.append("photos", await shrink(f));
      const r = await fetch("/api/catalogo", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setError(j.error ?? "Não consegui salvar.");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(id: string) {
    const r = await fetch(`/api/catalogo/fotos/${id}`, { method: "DELETE" });
    if (r.ok) {
      setPhotos((p) => p.filter((x) => x !== id));
      router.refresh();
    }
  }

  async function remove() {
    if (!product || !confirm(`Excluir "${product.title}" do catálogo?`)) return;
    const r = await fetch(`/api/catalogo/${product.id}`, { method: "DELETE" });
    if (r.ok) onSaved();
  }

  const priceValue =
    product?.priceCents != null ? (product.priceCents / 100).toFixed(2).replace(".", ",") : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={product ? "Editar item" : "Novo item"}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-bg p-5 md:max-w-[560px] md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[20px] font-semibold">
            {product ? (canEdit ? "Editar item" : product.title) : "Novo item"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full p-2 hover:bg-fill"
          >
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={!canEdit} className="space-y-4">
            <Field label="Título">
              <Input
                name="title"
                defaultValue={product?.title ?? ""}
                required
                maxLength={120}
                placeholder="Honda HR-V EXL 2020"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Preço (R$)" hint="Deixe vazio se for sob consulta">
                <Input name="price" defaultValue={priceValue} inputMode="decimal" placeholder="89.900,00" />
              </Field>
              <Field label="Ou texto no lugar do preço">
                <Input
                  name="priceLabel"
                  defaultValue={product?.priceLabel ?? ""}
                  placeholder="Consulte"
                  maxLength={60}
                />
              </Field>
            </div>
            <Field
              label="Descrição"
              hint="Ano, km, cor, opcionais, condições. O agente usa este texto para responder."
            >
              <textarea
                name="description"
                defaultValue={product?.description ?? ""}
                rows={6}
                maxLength={4000}
                className="w-full rounded-xl bg-fill px-3.5 py-3 text-[15px] outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
              />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
              <span className="text-[15px]">Disponível (o agente oferece)</span>
              <input
                type="checkbox"
                name="active"
                defaultChecked={product?.active ?? true}
                className="size-5 accent-[var(--accent)]"
              />
            </label>
          </fieldset>

          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">
              Fotos ({photos.length + files.length}/{maxPhotos}) · as 4 primeiras vão para o cliente
            </p>
            <div className="grid grid-cols-4 gap-2">
              {photos.map((id) => (
                <div key={id} className="relative aspect-square overflow-hidden rounded-xl bg-fill">
                  {/* biome-ignore lint/performance/noImgElement: foto privada servida pela API */}
                  <img src={`/api/catalogo/fotos/${id}`} alt="" className="size-full object-cover" />
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removePhoto(id)}
                      aria-label="Remover foto"
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {previews.map((src, i) => (
                <div key={src} className="relative aspect-square overflow-hidden rounded-xl bg-fill">
                  {/* biome-ignore lint/performance/noImgElement: prévia local */}
                  <img src={src} alt="" className="size-full object-cover opacity-80" />
                  <button
                    type="button"
                    onClick={() => setFiles((f) => f.filter((_, j) => j !== i))}
                    aria-label="Tirar foto"
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {canEdit && room > 0 && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-separator text-[12px] text-ink-2 hover:bg-fill"
                >
                  <ImagePlus size={20} />
                  Adicionar
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              data-testid="fotos-produto"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []).slice(0, Math.max(0, room));
                e.target.value = "";
                setFiles((f) => [...f, ...list]);
              }}
            />
          </div>

          {error && <Notice>{error}</Notice>}
          {canEdit && (
            <div className="flex items-center justify-between gap-2 pt-2">
              {product ? (
                <Button type="button" variant="danger" onClick={remove}>
                  Excluir
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={busy}>
                {busy ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
