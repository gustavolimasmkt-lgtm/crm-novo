import { startFakeEvolution } from "./fake-evolution.js";

const port = Number(process.env.FAKE_EVOLUTION_PORT ?? 3199);
const fake = await startFakeEvolution({ port, apiKey: process.env.FAKE_EVOLUTION_KEY ?? "chave-teste" });
console.log(`Evolution falsa em ${fake.url}`);

const { startFakeAnthropic } = await import("./fake-anthropic.js");
const ai = await startFakeAnthropic({ port: Number(process.env.FAKE_ANTHROPIC_PORT ?? 3198) });
console.log(`Anthropic falsa em ${ai.url}`);
