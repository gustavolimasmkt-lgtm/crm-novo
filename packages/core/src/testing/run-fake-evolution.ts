import { startFakeEvolution } from "./fake-evolution.js";

const port = Number(process.env.FAKE_EVOLUTION_PORT ?? 3199);
const fake = await startFakeEvolution({ port, apiKey: process.env.FAKE_EVOLUTION_KEY ?? "chave-teste" });
console.log(`Evolution falsa em ${fake.url}`);
