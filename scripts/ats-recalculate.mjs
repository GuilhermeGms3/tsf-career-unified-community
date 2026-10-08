const baseUrl = String(process.env.TSF_CAREER_URL || "http://127.0.0.1:7123").replace(/\/$/, "");
const limit = Number(process.argv.find((value) => value.startsWith("--limit="))?.split("=")[1] || 500);
try {
  const response = await fetch(`${baseUrl}/api/ats/recalculate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limit }),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
  console.log(JSON.stringify(body.report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "FAIL", code: error.code || "ATS_RECALCULATION_UNAVAILABLE", error: error.message }, null, 2));
  process.exitCode = 1;
}
