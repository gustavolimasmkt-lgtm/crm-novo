"use client";

import {
  ArrowDown,
  ArrowUp,
  Bell,
  ChevronLeft,
  Clock,
  Film,
  ImagePlus,
  ListTodo,
  MessageSquare,
  Mic,
  MoveRight,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveFlowAction } from "@/app/actions/flows";
import { Button, cx, Field, Input, Notice, Select } from "@/components/ui";

type Step =
  | { type: "message"; text: string }
  | { type: "wait"; minutes: number }
  | { type: "move_stage"; stageId: string }
  | { type: "task"; title: string; dueMinutes: number }
  | { type: "notify"; text: string }
  | {
      type: "media";
      mediaId: string;
      kind: "image" | "video" | "audio" | "document";
      fileName: string;
      caption: string;
      extra?: { mediaId: string; fileName: string }[];
    };
type Trigger = "manual" | "lead_created" | "stage_entered" | "tag_added";
type Flow = {
  id: string;
  name: string;
  trigger: Trigger;
  triggerStageId: string | null;
  triggerTagId: string | null;
  stopOnReply: boolean;
  steps: Step[];
};

const STEP_INFO: Record<Step["type"], { label: string; icon: React.ReactNode }> = {
  message: { label: "Mensagem", icon: <MessageSquare size={16} /> },
  wait: { label: "Esperar", icon: <Clock size={16} /> },
  move_stage: { label: "Mover etapa", icon: <MoveRight size={16} /> },
  task: { label: "Criar tarefa", icon: <ListTodo size={16} /> },
  notify: { label: "Avisar responsável", icon: <Bell size={16} /> },
  media: { label: "Fotos, vídeo ou áudio", icon: <Film size={16} /> },
};
const UNITS = [
  { id: "min", label: "minutos", mult: 1 },
  { id: "h", label: "horas", mult: 60 },
  { id: "d", label: "dias", mult: 1440 },
] as const;

function splitMinutes(m: number) {
  if (m % 1440 === 0) return { n: m / 1440, unit: "d" as const };
  if (m % 60 === 0) return { n: m / 60, unit: "h" as const };
  return { n: m, unit: "min" as const };
}

function Duration({
  minutes,
  onChange,
  label,
}: {
  minutes: number;
  onChange: (m: number) => void;
  label: string;
}) {
  const { n, unit } = splitMinutes(minutes);
  const mult = (u: string) => UNITS.find((x) => x.id === u)?.mult ?? 1;
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        value={n}
        aria-label={label}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value || 0)) * mult(unit))}
        className="w-24"
      />
      <Select
        value={unit}
        aria-label={`${label} (unidade)`}
        onChange={(e) => onChange(n * mult(e.target.value))}
        className="w-32"
      >
        {UNITS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function FlowEditor({
  flow,
  stages,
  tags,
}: {
  flow: Flow | null;
  stages: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [f, setF] = useState<Flow>(
    flow ?? {
      id: "",
      name: "",
      trigger: "lead_created",
      triggerStageId: null,
      triggerTagId: null,
      stopOnReply: true,
      steps: [{ type: "message", text: "Oi {nome}! " }],
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const setStep = (i: number, s: Step) =>
    setF((x) => ({ ...x, steps: x.steps.map((y, j) => (j === i ? s : y)) }));
  const move = (i: number, d: -1 | 1) =>
    setF((x) => {
      const steps = [...x.steps];
      const [s] = steps.splice(i, 1);
      if (s) steps.splice(i + d, 0, s);
      return { ...x, steps };
    });
  const add = (type: Step["type"]) =>
    setF((x) => ({
      ...x,
      steps: [
        ...x.steps,
        type === "message"
          ? { type, text: "" }
          : type === "wait"
            ? { type, minutes: 1440 }
            : type === "move_stage"
              ? { type, stageId: stages[0]?.id ?? "" }
              : type === "task"
                ? { type, title: "", dueMinutes: 0 }
                : type === "media"
                  ? { type, mediaId: "", kind: "image" as const, fileName: "", caption: "", extra: [] }
                  : { type, text: "" },
      ],
    }));

  function save() {
    setError(null);
    start(async () => {
      const r = await saveFlowAction(flow?.id ?? null, {
        name: f.name,
        trigger: f.trigger,
        triggerStageId: f.triggerStageId,
        triggerTagId: f.triggerTagId,
        stopOnReply: f.stopOnReply,
        steps: f.steps,
      });
      if (r.error) return setError(r.error);
      router.push("/fluxos");
      router.refresh();
    });
  }

  return (
    <div className="max-w-[760px] space-y-5">
      <section className="space-y-4 rounded-[var(--radius-card)] bg-surface p-5">
        <Field label="Nome do fluxo">
          <Input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            maxLength={80}
            placeholder="Boas-vindas lead novo"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Começa quando">
            <Select value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value as Trigger })}>
              <option value="lead_created">Entra um lead novo</option>
              <option value="stage_entered">Negociação entra numa etapa</option>
              <option value="tag_added">Negociação ganha uma etiqueta</option>
              <option value="manual">Botão Enviar fluxo na conversa</option>
            </Select>
          </Field>
          {f.trigger === "stage_entered" && (
            <Field label="Etapa">
              <Select
                value={f.triggerStageId ?? ""}
                onChange={(e) => setF({ ...f, triggerStageId: e.target.value || null })}
              >
                <option value="">Escolha</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {f.trigger === "tag_added" && (
            <Field label="Etiqueta">
              <Select
                value={f.triggerTagId ?? ""}
                onChange={(e) => setF({ ...f, triggerTagId: e.target.value || null })}
              >
                <option value="">Escolha</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            checked={f.stopOnReply}
            onChange={(e) => setF({ ...f, stopOnReply: e.target.checked })}
            className="size-4 accent-[var(--accent)]"
          />
          Parar o fluxo quando o cliente responder
        </label>
        <p className="text-[12px] text-ink-3">
          Também para se a negociação for ganha ou perdida, ou se o cliente pedir SAIR. Mensagens saem só no
          horário de envio e pela proteção contra bloqueio (Agente de IA → Follow-up).
        </p>
      </section>

      <ol className="space-y-3">
        {f.steps.map((s, i) => (
          <li
            key={`${i}-${s.type}`}
            className="rounded-[var(--radius-card)] bg-surface p-4"
            data-testid="passo"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">
                {i + 1}
              </span>
              <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                {STEP_INFO[s.type].icon} {STEP_INFO[s.type].label}
              </span>
              <div className="ml-auto flex items-center">
                <button
                  type="button"
                  aria-label={`Subir passo ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="rounded-full p-2 text-ink-2 md:p-1.5 hover:bg-fill disabled:opacity-30"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Descer passo ${i + 1}`}
                  disabled={i === f.steps.length - 1}
                  onClick={() => move(i, 1)}
                  className="rounded-full p-2 text-ink-2 md:p-1.5 hover:bg-fill disabled:opacity-30"
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Remover passo ${i + 1}`}
                  onClick={() => setF((x) => ({ ...x, steps: x.steps.filter((_, j) => j !== i) }))}
                  className="rounded-full p-2 text-ink-3 md:p-1.5 hover:bg-fill"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {s.type === "message" && (
              <textarea
                value={s.text}
                onChange={(e) => setStep(i, { ...s, text: e.target.value })}
                rows={3}
                maxLength={2000}
                aria-label={`Mensagem do passo ${i + 1}`}
                placeholder="Use {nome} para o primeiro nome e #periodo-dia para bom dia, boa tarde ou boa noite"
                className="w-full rounded-xl bg-fill px-3.5 py-3 text-[15px] outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
              />
            )}
            {s.type === "wait" && (
              <Duration
                minutes={s.minutes}
                label={`Espera do passo ${i + 1}`}
                onChange={(m) => setStep(i, { ...s, minutes: m })}
              />
            )}
            {s.type === "move_stage" && (
              <Select
                value={s.stageId}
                aria-label={`Etapa do passo ${i + 1}`}
                onChange={(e) => setStep(i, { ...s, stageId: e.target.value })}
              >
                {stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </Select>
            )}
            {s.type === "task" && (
              <div className="space-y-3">
                <Input
                  value={s.title}
                  onChange={(e) => setStep(i, { ...s, title: e.target.value })}
                  maxLength={200}
                  aria-label={`Tarefa do passo ${i + 1}`}
                  placeholder="Ligar para o cliente"
                />
                <div className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
                  Para daqui a
                  <Duration
                    minutes={s.dueMinutes}
                    label={`Prazo da tarefa do passo ${i + 1}`}
                    onChange={(m) => setStep(i, { ...s, dueMinutes: m })}
                  />
                </div>
              </div>
            )}
            {s.type === "media" && <MediaStep step={s} index={i} onChange={(m) => setStep(i, m)} />}
            {s.type === "notify" && (
              <textarea
                value={s.text}
                onChange={(e) => setStep(i, { ...s, text: e.target.value })}
                rows={2}
                maxLength={1000}
                aria-label={`Aviso do passo ${i + 1}`}
                placeholder="Cliente {nome} não respondeu, liga pra ele"
                className="w-full rounded-xl bg-fill px-3.5 py-3 text-[15px] outline-none focus:bg-surface focus:shadow-[0_0_0_4px_var(--accent-soft)]"
              />
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(STEP_INFO) as Step["type"][]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => add(t)}
            className={cx(
              "flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-[14px] font-medium hover:bg-fill-strong",
            )}
          >
            + {STEP_INFO[t].label}
          </button>
        ))}
      </div>

      {error && <Notice>{error}</Notice>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? "Salvando..." : "Salvar fluxo"}
        </Button>
        <Button variant="secondary" onClick={() => router.push("/fluxos")}>
          Cancelar
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        Depois de salvar, ligue o fluxo na lista para ele começar a rodar.
      </p>
    </div>
  );
}

type MediaStepData = Extract<Step, { type: "media" }>;
const MAX_PHOTOS = 10;

/**
 * Passo de mídia: foto(s), vídeo, áudio ou PDF, ou áudio gravado na hora.
 * Foto aceita até 10 no mesmo passo (saem em seguida, na ordem; a legenda vai na primeira).
 */
function MediaStep({
  step,
  index,
  onChange,
}: {
  step: MediaStepData;
  index: number;
  onChange: (s: MediaStepData) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photos =
    step.kind === "image" && step.mediaId
      ? [{ mediaId: step.mediaId, fileName: step.fileName }, ...(step.extra ?? [])]
      : [];

  async function send(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch("/api/fluxos/midia", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Não consegui enviar o arquivo.");
    return j as { id: string; kind: MediaStepData["kind"]; fileName: string };
  }

  /** Um arquivo troca o passo; várias fotos (ou fotos a mais) entram em sequência. */
  async function upload(files: File[]) {
    setError(null);
    if (!files.length) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    const adding = photos.length > 0 && images.length === files.length;
    try {
      if (!adding && (files.length === 1 || images.length !== files.length)) {
        if (files.length > 1) setError("Várias de uma vez só para fotos. Usei o primeiro arquivo.");
        setBusy("Enviando...");
        const j = await send(files[0] as File);
        onChange({ ...step, mediaId: j.id, kind: j.kind, fileName: j.fileName, extra: [] });
        return;
      }
      const room = MAX_PHOTOS - photos.length;
      if (images.length > room)
        setError(`No máximo ${MAX_PHOTOS} fotos por passo. Usei as ${room} primeiras.`);
      const take = images.slice(0, Math.max(room, 0));
      const got: { mediaId: string; fileName: string }[] = [];
      for (const [i, f] of take.entries()) {
        setBusy(`Enviando foto ${i + 1} de ${take.length}...`);
        const j = await send(f);
        got.push({ mediaId: j.id, fileName: j.fileName });
      }
      const all = [...photos, ...got];
      const [first, ...rest] = all;
      if (first)
        onChange({ ...step, kind: "image", mediaId: first.mediaId, fileName: first.fileName, extra: rest });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function setPhotos(all: { mediaId: string; fileName: string }[]) {
    const [first, ...rest] = all;
    if (first) onChange({ ...step, mediaId: first.mediaId, fileName: first.fileName, extra: rest });
    else onChange({ ...step, mediaId: "", fileName: "", extra: [] });
  }

  async function record() {
    setError(null);
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        setRecording(false);
        const mime = (rec.mimeType || "audio/webm").split(";")[0] ?? "audio/webm";
        const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
        upload([new File(chunks, `audio-gravado.${ext}`, { type: mime })]);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError("Não consegui usar o microfone. Libere o acesso no navegador.");
    }
  }

  const src = step.mediaId ? `/api/fluxos/midia/${step.mediaId}` : null;
  const isPhotos = photos.length > 0;
  return (
    <div className="space-y-3">
      {isPhotos && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid={`fotos-passo-${index + 1}`}>
          {photos.map((ph, i) => (
            <li key={ph.mediaId} className="relative overflow-hidden rounded-xl bg-fill">
              {/* biome-ignore lint/performance/noImgElement: arquivo privado servido pela API */}
              <img
                src={`/api/fluxos/midia/${ph.mediaId}`}
                alt={ph.fileName}
                className="aspect-square w-full object-cover"
              />
              <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[11px] font-semibold text-white">
                {i + 1}
              </span>
              <div className="absolute right-1 top-1 flex gap-1">
                {i > 0 && (
                  <button
                    type="button"
                    aria-label={`Passar a foto ${i + 1} para antes`}
                    title="Passar para antes"
                    className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
                    onClick={() => {
                      const all = [...photos];
                      [all[i - 1], all[i]] = [all[i] as (typeof all)[0], all[i - 1] as (typeof all)[0]];
                      setPhotos(all);
                    }}
                  >
                    <ChevronLeft size={15} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Tirar a foto ${i + 1}`}
                  title="Tirar"
                  className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
                  onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                >
                  <X size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {src && !isPhotos && (
        <div className="rounded-xl bg-fill p-2">
          {step.kind === "video" && (
            // biome-ignore lint/a11y/useMediaCaption: vídeo do carro enviado pela equipe
            <video src={src} controls preload="metadata" className="max-h-56 rounded-lg" />
          )}
          {step.kind === "audio" && (
            // biome-ignore lint/a11y/useMediaCaption: áudio gravado pela equipe
            <audio src={src} controls preload="none" className="w-full" />
          )}
          {step.kind === "document" && <p className="px-2 py-1 text-[14px]">📄 {step.fileName}</p>}
          <p className="px-1 pt-1 text-[12px] text-ink-3">{step.fileName}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {isPhotos ? (
          photos.length < MAX_PHOTOS && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!!busy}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={14} /> Adicionar fotos ({photos.length}/{MAX_PHOTOS})
            </Button>
          )
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!!busy || recording}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={14} /> {src ? "Trocar arquivo" : "Enviar fotos, vídeo, áudio ou PDF"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={recording ? "danger" : "secondary"}
              disabled={!!busy}
              onClick={record}
            >
              {recording ? (
                <>
                  <Square size={14} /> Parar gravação
                </>
              ) : (
                <>
                  <Mic size={14} /> Gravar áudio
                </>
              )}
            </Button>
          </>
        )}
        {busy && <span className="self-center text-[13px] text-ink-2">{busy}</span>}
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={isPhotos ? "image/*" : "image/*,video/*,audio/*,application/pdf"}
        className="hidden"
        data-testid={`midia-passo-${index + 1}`}
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = "";
          upload(fs);
        }}
      />
      {isPhotos && photos.length === 1 && (
        <p className="text-[12px] text-ink-3">
          Dá para colocar até {MAX_PHOTOS} fotos neste passo: escolha várias de uma vez ou use Adicionar
          fotos.
        </p>
      )}
      {step.kind !== "audio" && src && (
        <Input
          value={step.caption}
          maxLength={1000}
          aria-label={`Legenda do passo ${index + 1}`}
          placeholder={
            photos.length > 1
              ? "Legenda (vai na primeira foto), ex.: {nome}, olha ele"
              : "Legenda (opcional), ex.: {nome}, olha ele por dentro"
          }
          onChange={(e) => onChange({ ...step, caption: e.target.value })}
        />
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
