"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { type ReactNode, useActionState } from "react";
import { crmSettingsAction } from "@/app/actions/crm";
import { Badge, Button, GroupedList, Input, Notice, Select } from "@/components/ui";
import type { FormState } from "@/lib/form";

type StageRow = { id: string; name: string; color: string; kind: "open" | "scheduled" | "won" | "lost" };
const KIND_LABEL = { open: "Em andamento", scheduled: "Agendamento", won: "Ganho", lost: "Perdido" } as const;

/** Formulário de uma linha: envia "op" + campos para a ação única de configuração. */
function Op({
  op,
  fields,
  children,
  className,
}: {
  op: string;
  fields?: Record<string, string>;
  children: ReactNode;
  className?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(crmSettingsAction, {});
  return (
    <form action={action} className={className}>
      <input type="hidden" name="op" value={op} />
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state.error && (
        <div className="mt-2 w-full basis-full">
          <Notice>{state.error}</Notice>
        </div>
      )}
    </form>
  );
}

function IconBtn({ label, children, tone }: { label: string; children: ReactNode; tone?: "danger" }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`rounded-full p-1.5 hover:bg-fill ${tone === "danger" ? "text-danger" : "text-ink-2"}`}
    >
      {children}
    </button>
  );
}

export function Settings({
  pipelines,
  tags,
  sources,
}: {
  pipelines: { id: string; name: string; isDefault: boolean; stages: StageRow[] }[];
  tags: { id: string; name: string; color: string }[];
  sources: { id: string; name: string; key: string }[];
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div>
        {pipelines.map((p) => (
          <section key={p.id} className="mb-8" aria-label={`Funil ${p.name}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
              <Op op="pipeline.rename" fields={{ id: p.id }} className="flex flex-1 items-center gap-2">
                <Input
                  name="name"
                  defaultValue={p.name}
                  className="h-9 max-w-xs font-semibold"
                  aria-label="Nome do funil"
                />
                <Button size="sm" variant="secondary">
                  Renomear
                </Button>
              </Op>
              {p.isDefault ? (
                <Badge tone="accent">Padrão</Badge>
              ) : (
                <>
                  <Op op="pipeline.default" fields={{ id: p.id }}>
                    <Button size="sm" variant="plain">
                      Tornar padrão
                    </Button>
                  </Op>
                  <Op op="pipeline.delete" fields={{ id: p.id }}>
                    <Button size="sm" variant="plain" className="text-danger">
                      Excluir funil
                    </Button>
                  </Op>
                </>
              )}
            </div>
            {p.isDefault && (
              <p className="mb-2 px-1 text-[13px] text-ink-3">
                Leads novos do WhatsApp entram na primeira etapa deste funil.
              </p>
            )}
            <GroupedList>
              {p.stages.map((s, i) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2.5"
                  data-testid="stage-row"
                >
                  <Op
                    op="stage.update"
                    fields={{ id: s.id }}
                    className="flex flex-1 flex-wrap items-center gap-2"
                  >
                    <input
                      type="color"
                      name="color"
                      defaultValue={s.color}
                      aria-label="Cor"
                      className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent"
                    />
                    <Input
                      name="name"
                      defaultValue={s.name}
                      className="h-9 min-w-36 flex-1"
                      aria-label="Nome da etapa"
                    />
                    <Select
                      name="kind"
                      defaultValue={s.kind}
                      className="h-9 w-40 text-[14px]"
                      aria-label="Tipo da etapa"
                    >
                      {Object.entries(KIND_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="secondary">
                      Salvar
                    </Button>
                  </Op>
                  <div className="flex">
                    {i > 0 && (
                      <Op op="stage.up" fields={{ id: s.id }}>
                        <IconBtn label="Subir">
                          <ArrowUp size={16} />
                        </IconBtn>
                      </Op>
                    )}
                    {i < p.stages.length - 1 && (
                      <Op op="stage.down" fields={{ id: s.id }}>
                        <IconBtn label="Descer">
                          <ArrowDown size={16} />
                        </IconBtn>
                      </Op>
                    )}
                    <Op op="stage.delete" fields={{ id: s.id }}>
                      <IconBtn label="Excluir etapa" tone="danger">
                        <Trash2 size={16} />
                      </IconBtn>
                    </Op>
                  </div>
                </div>
              ))}
              <Op
                op="stage.add"
                fields={{ pipelineId: p.id }}
                className="flex flex-wrap items-center gap-2 px-3 py-2.5"
              >
                <Input
                  name="name"
                  placeholder="Nova etapa"
                  className="h-9 flex-1"
                  aria-label="Nova etapa"
                  required
                />
                <Button size="sm">Adicionar etapa</Button>
              </Op>
            </GroupedList>
            <p className="px-1 text-[12px] text-ink-3">
              O tipo diz o que a etapa representa nos relatórios: Ganho e Perdido fecham a negociação.
            </p>
          </section>
        ))}
        <Op op="pipeline.create" className="flex items-center gap-2">
          <Input
            name="name"
            placeholder="Nome do novo funil"
            className="h-10 max-w-xs"
            aria-label="Novo funil"
            required
          />
          <Button variant="secondary">Criar funil</Button>
        </Op>
      </div>

      <aside className="space-y-8">
        <section>
          <h2 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-ink-3">Etiquetas</h2>
          <div className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
            {tags.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2">
                <Op op="tag.save" fields={{ id: t.id }} className="flex flex-1 items-center gap-2">
                  <input
                    type="color"
                    name="color"
                    defaultValue={t.color}
                    aria-label="Cor"
                    className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent"
                  />
                  <Input
                    name="name"
                    defaultValue={t.name}
                    className="h-8 flex-1"
                    aria-label="Nome da etiqueta"
                  />
                  <Button size="sm" variant="secondary">
                    Salvar
                  </Button>
                </Op>
                <Op op="tag.delete" fields={{ id: t.id }}>
                  <IconBtn label="Excluir etiqueta" tone="danger">
                    <Trash2 size={15} />
                  </IconBtn>
                </Op>
              </div>
            ))}
            <Op op="tag.save" className="flex items-center gap-2 px-3 py-2">
              <input
                type="color"
                name="color"
                defaultValue="#0071e3"
                aria-label="Cor"
                className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent"
              />
              <Input
                name="name"
                placeholder="Nova etiqueta"
                className="h-8 flex-1"
                aria-label="Nova etiqueta"
                required
              />
              <Button size="sm">Criar</Button>
            </Op>
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-wide text-ink-3">
            Fontes de lead
          </h2>
          <div className="divide-y divide-separator overflow-hidden rounded-[var(--radius-card)] bg-surface">
            {sources.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-[15px]">{s.name}</span>
                <span className="text-[12px] text-ink-3">{s.key}</span>
                <Op op="source.delete" fields={{ id: s.id }}>
                  <IconBtn label="Excluir fonte" tone="danger">
                    <Trash2 size={15} />
                  </IconBtn>
                </Op>
              </div>
            ))}
            <Op op="source.save" className="flex items-center gap-2 px-3 py-2">
              <Input
                name="name"
                placeholder="Nova fonte"
                className="h-8 flex-1"
                aria-label="Nova fonte"
                required
              />
              <Button size="sm">Criar</Button>
            </Op>
          </div>
        </section>
      </aside>
    </div>
  );
}
