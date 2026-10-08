export function createCoverageBenchmarkRoutes({ service, readJson, json, sendError }) {
  return async function coverageBenchmarkRoutes(req, res, url) {
    try {
      if (url.pathname === "/api/coverage-benchmark" && req.method === "GET") {
        json(res, { ok: true, ...(await service.dashboard()) });
        return true;
      }
      if (url.pathname === "/api/coverage-benchmark/references" && req.method === "POST") {
        const input = await readJson(req), references = Array.isArray(input.references) ? service.addMany(input.references) : [service.add(input)];
        json(res, { ok: true, references }, 201);
        return true;
      }
      if (url.pathname === "/api/coverage-benchmark/import" && req.method === "POST") {
        json(res, { ok: true, references: service.importData(await readJson(req)) }, 201);
        return true;
      }
      if (url.pathname === "/api/coverage-benchmark/diagnose" && req.method === "POST") {
        json(res, { ok: true, diagnostic: await service.diagnoseUrl(await readJson(req)) });
        return true;
      }
      if (url.pathname === "/api/coverage-benchmark/runs" && req.method === "POST") {
        json(res, { ok: true, run: await service.runBenchmark() }, 201);
        return true;
      }
      const manualImport = url.pathname.match(/^\/api\/coverage-benchmark\/references\/([^/]+)\/import$/);
      if (manualImport && req.method === "POST") {
        json(res, { ok: true, ...(await service.importReference(decodeURIComponent(manualImport[1]))) });
        return true;
      }
    } catch (error) {
      sendError(res, error, { status: error.status || 400, code: error.code || "COVERAGE_BENCHMARK_FAILED", message: error.message });
      return true;
    }
    return false;
  };
}
