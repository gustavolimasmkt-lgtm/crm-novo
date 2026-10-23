"use server";

import {
  addStage,
  createPipeline,
  deletePipeline,
  deleteSource,
  deleteStage,
  deleteTag,
  moveStage,
  saveSource,
  saveTag,
  updatePipeline,
  updateStage,
} from "@crm/core";
import { getDb } from "@crm/db";
import { revalidatePath } from "next/cache";
import { type FormState, str, toFormError } from "@/lib/form";
import { requireOrg } from "@/lib/session";

/** Uma ação só para a tela de configuração do CRM: o campo "op" diz o que fazer. */
export async function crmSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireOrg();
  const db = getDb();
  const a = [db, ctx.actor, ctx.organization.id] as const;
  const id = str(fd, "id");
  const stage = {
    name: str(fd, "name"),
    color: str(fd, "color") || undefined,
    kind: (str(fd, "kind") || undefined) as "open" | "scheduled" | "won" | "lost" | undefined,
  };
  try {
    switch (str(fd, "op")) {
      case "pipeline.create":
        await createPipeline(...a, str(fd, "name"));
        break;
      case "pipeline.rename":
        await updatePipeline(...a, id, { name: str(fd, "name") });
        break;
      case "pipeline.default":
        await updatePipeline(...a, id, { isDefault: true });
        break;
      case "pipeline.delete":
        await deletePipeline(...a, id);
        break;
      case "stage.add":
        await addStage(...a, str(fd, "pipelineId"), stage);
        break;
      case "stage.update":
        await updateStage(...a, id, stage);
        break;
      case "stage.up":
      case "stage.down":
        await moveStage(...a, id, str(fd, "op") === "stage.up" ? "up" : "down");
        break;
      case "stage.delete":
        await deleteStage(...a, id);
        break;
      case "tag.save":
        await saveTag(...a, { id: id || undefined, name: str(fd, "name"), color: str(fd, "color") });
        break;
      case "tag.delete":
        await deleteTag(...a, id);
        break;
      case "source.save":
        await saveSource(...a, str(fd, "name"));
        break;
      case "source.delete":
        await deleteSource(...a, id);
        break;
      default:
        return { error: "Ação desconhecida." };
    }
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/crm/configuracoes");
  revalidatePath("/crm");
  return { ok: true };
}
