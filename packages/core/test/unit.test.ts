import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "../src/auth/crypto.js";
import { can, canInviteRole } from "../src/auth/permissions.js";
import { dayPeriod, fillDayPeriod, initials, slugify } from "../src/text.js";

describe("senhas", () => {
  it("gera hash verificável e rejeita senha errada", async () => {
    const h = await hashPassword("Carro2026");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Carro2026", h)).toBe(true);
    expect(await verifyPassword("carro2026", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
  it("valida força mínima", () => {
    expect(passwordProblem("curta1")).toMatch(/8 caracteres/);
    expect(passwordProblem("semnumero")).toMatch(/letras e números/);
    expect(passwordProblem("boa12345")).toBeNull();
  });
});

describe("permissões", () => {
  it("master pode tudo", () => {
    expect(can({ isMaster: true, role: null }, "org.manage")).toBe(true);
  });
  it("vendedor não gerencia equipe nem vê tudo", () => {
    const v = { isMaster: false, role: "seller" as const };
    expect(can(v, "members.manage")).toBe(false);
    expect(can(v, "deals.view_all")).toBe(false);
    expect(can(v, "conversations.take")).toBe(true);
  });
  it("atendente não vê valores", () => {
    expect(can({ isMaster: false, role: "agent" }, "deals.view_values")).toBe(false);
  });
  it("gestor só convida vendedor e atendente", () => {
    const g = { isMaster: false, role: "manager" as const };
    expect(canInviteRole(g, "seller")).toBe(true);
    expect(canInviteRole(g, "admin")).toBe(false);
  });
});

describe("texto", () => {
  it("slug e iniciais", () => {
    expect(slugify("GreenCar Veículos")).toBe("greencar-veiculos");
    expect(initials("Gustavo de Lima")).toBe("GL");
    expect(initials("")).toBe("?");
  });
});

describe("#periodo-dia", () => {
  // 10h, 15h e 21h em Brasília (UTC-3).
  const at = (h: number) => new Date(`2026-11-02T${String(h + 3).padStart(2, "0")}:00:00Z`);
  it("vira bom dia, boa tarde ou boa noite no horário de Brasília", () => {
    expect(fillDayPeriod("#periodo-dia, Ana!", at(10))).toBe("Bom dia, Ana!");
    expect(fillDayPeriod("Oi Ana, #periodo-dia!", at(15))).toBe("Oi Ana, boa tarde!");
    expect(fillDayPeriod("Tudo certo. #período-dia", at(21))).toBe("Tudo certo. Boa noite");
    expect(fillDayPeriod("#PERIODO-DIA", new Date("2026-11-02T06:30:00Z"))).toBe("Boa noite");
    expect(dayPeriod(new Date("2026-11-02T08:00:00Z"))).toBe("bom dia");
    expect(dayPeriod(new Date("2026-11-02T15:00:00Z"))).toBe("boa tarde");
    expect(fillDayPeriod("sem etiqueta")).toBe("sem etiqueta");
  });
});
