import assert from "node:assert/strict";
import test from "node:test";
import {
  QueryCache,
  invalidateForMutation,
  queryCache,
} from "../public/app/query-cache.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => ((resolve = ok), (reject = fail)));
  return { promise, resolve, reject };
};

test("cache fresh retorna sem nova chamada", async () => {
  let now = 0, calls = 0;
  const cache = new QueryCache({ now: () => now }), loader = async () => ({ value: ++calls });
  assert.deepEqual(await cache.query({ key: "jobs", loader, staleTime: 100, cacheTime: 1000 }), { value: 1 });
  now = 50;
  assert.deepEqual(await cache.query({ key: "jobs", loader, staleTime: 100, cacheTime: 1000 }), { value: 1 });
  assert.equal(calls, 1);
});

test("cache stale retorna imediatamente e revalida uma vez", async () => {
  let now = 0, calls = 0;
  const refresh = deferred(), cache = new QueryCache({ now: () => now });
  await cache.query({ key: "jobs", loader: async () => ({ value: ++calls }), staleTime: 10, cacheTime: 1000 });
  now = 20;
  const stale = await cache.query({ key: "jobs", loader: () => (calls++, refresh.promise), staleTime: 10, cacheTime: 1000 });
  assert.deepEqual(stale, { value: 1 });
  assert.equal(calls, 2);
  refresh.resolve({ value: 2 });
  await refresh.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cache.getCached("jobs"), { value: 2 });
});

test("requisições idênticas ausentes compartilham o mesmo in-flight", async () => {
  const pending = deferred(), cache = new QueryCache();
  let calls = 0;
  const loader = () => (calls++, pending.promise), options = { key: "sources", loader, staleTime: 100, cacheTime: 1000 };
  const first = cache.query(options), second = cache.query(options);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await second, { ok: true });
});

test("invalidate força novo load e falha de refresh preserva stale", async () => {
  let now = 0, calls = 0;
  const cache = new QueryCache({ now: () => now });
  await cache.query({ key: "today", loader: async () => ++calls, staleTime: 10, cacheTime: 1000 });
  cache.invalidate("today");
  assert.equal(await cache.query({ key: "today", loader: async () => ++calls, staleTime: 10, cacheTime: 1000 }), 2);
  now = 20;
  assert.equal(await cache.query({ key: "today", loader: async () => { throw new Error("offline"); }, staleTime: 10, cacheTime: 1000 }), 2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.getCached("today"), 2);
});

test("notificações distinguem fetch foreground de revalidação SWR", async () => {
  let now = 0;
  const cache = new QueryCache({ now: () => now }), states = [];
  cache.subscribeAll((_key, state) => states.push(state));
  await cache.query({ key: "detail", loader: async () => 1, staleTime: 10, cacheTime: 1000 });
  assert.equal(states.at(-1).background, false);
  now = 20;
  await cache.query({ key: "detail", loader: async () => 2, staleTime: 10, cacheTime: 1000 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1).background, true);
});

test("feedback invalida somente leituras de oportunidades e Today", () => {
  queryCache.entries = new Map([
    ["GET:/api/opportunities", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/today", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/settings", { data: 1, updatedAt: 0, expiresAt: Infinity }],
  ]);
  invalidateForMutation("/api/opportunities/job-1/feedback");
  assert.equal(queryCache.entries.has("GET:/api/opportunities"), false);
  assert.equal(queryCache.entries.has("GET:/api/today"), false);
  assert.equal(queryCache.entries.has("GET:/api/settings"), true);
  queryCache.entries.clear();
});

test("revisão de currículo invalida currículo e projeção sem apagar domínios alheios", () => {
  queryCache.entries = new Map([
    ["GET:/api/resumes", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/opportunities/job-1/workspace", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/whatsapp/status", { data: 1, updatedAt: 0, expiresAt: Infinity }],
  ]);
  invalidateForMutation("/api/resume-documents/versions/version-1/review");
  assert.equal(queryCache.entries.has("GET:/api/resumes"), false);
  assert.equal(queryCache.entries.has("GET:/api/opportunities/job-1/workspace"), false);
  assert.equal(queryCache.entries.has("GET:/api/whatsapp/status"), true);
  queryCache.entries.clear();
});

test("verificação em massa invalida vagas, Today e histórico operacional", () => {
  queryCache.entries = new Map([
    ["GET:/api/opportunities", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/today", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/job-hunt/runs", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/settings", { data: 1, updatedAt: 0, expiresAt: Infinity }],
  ]);
  invalidateForMutation("/api/opportunities/verify");
  assert.equal(queryCache.entries.has("GET:/api/opportunities"), false);
  assert.equal(queryCache.entries.has("GET:/api/today"), false);
  assert.equal(queryCache.entries.has("GET:/api/job-hunt/runs"), false);
  assert.equal(queryCache.entries.has("GET:/api/settings"), true);
  queryCache.entries.clear();
});

test("alterar currículo padrão atualiza biblioteca e workspaces de vagas", () => {
  queryCache.entries = new Map([
    ["GET:/api/experience/resumes", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/opportunities/job-1/workspace", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/whatsapp/status", { data: 1, updatedAt: 0, expiresAt: Infinity }],
  ]);
  invalidateForMutation("/api/experience/resumes/default");
  assert.equal(queryCache.entries.has("GET:/api/experience/resumes"), false);
  assert.equal(queryCache.entries.has("GET:/api/opportunities/job-1/workspace"), false);
  assert.equal(queryCache.entries.has("GET:/api/whatsapp/status"), true);
  queryCache.entries.clear();
});

test("estado WhatsApp invalida integração sem apagar oportunidades", () => {
  queryCache.entries = new Map([
    ["GET:/api/whatsapp/status", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/source-center", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/opportunities", { data: 1, updatedAt: 0, expiresAt: Infinity }],
  ]);
  invalidateForMutation("/api/whatsapp/connect");
  assert.equal(queryCache.entries.has("GET:/api/whatsapp/status"), false);
  assert.equal(queryCache.entries.has("GET:/api/source-center"), false);
  assert.equal(queryCache.entries.has("GET:/api/opportunities"), true);
  queryCache.entries.clear();
});

test("mutação de batch invalida somente batch e projeção de currículos", () => {
  queryCache.entries = new Map([
    ["GET:/api/resume-batches/batch-1", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/experience/resumes", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/opportunities", { data: 1, updatedAt: 0, expiresAt: Infinity }],
    ["GET:/api/whatsapp/status", { data: 1, updatedAt: 0, expiresAt: Infinity }],
  ]);
  invalidateForMutation("/api/resume-batches/batch-1/approve");
  assert.equal(queryCache.entries.has("GET:/api/resume-batches/batch-1"), false);
  assert.equal(queryCache.entries.has("GET:/api/experience/resumes"), false);
  assert.equal(queryCache.entries.has("GET:/api/opportunities"), true);
  assert.equal(queryCache.entries.has("GET:/api/whatsapp/status"), true);
  queryCache.entries.clear();
});
