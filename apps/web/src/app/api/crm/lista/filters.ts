import type { DealFilter } from "@crm/core";

/** Lê os filtros da URL (mesmos nomes da tela). */
export function filtersFrom(u: URLSearchParams): DealFilter {
  const g = (k: string) => u.get(k) ?? undefined;
  return {
    pipelineId: g("funil"),
    stageId: g("etapa"),
    status: g("status") as DealFilter["status"],
    assignedUserId: g("responsavel"),
    tagId: g("etiqueta"),
    sourceId: g("fonte"),
    qualification: g("qualificacao") as DealFilter["qualification"],
    fromAd: u.get("anuncio") === "1" ? true : undefined,
    createdFrom: g("de"),
    createdTo: g("ate"),
    idleDays: g("parada") as unknown as number | undefined,
    q: g("q"),
    sort: g("ordem") as DealFilter["sort"],
    dir: g("dir") as DealFilter["dir"],
    page: g("pagina") as unknown as number | undefined,
  };
}
