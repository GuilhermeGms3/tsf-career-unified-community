export function discoveryRecovery(errorCode = "", status = "") {
  const code = String(errorCode || status).toUpperCase();
  if (["HEALTHY", "SUCCESS", "CONSULTED", "READY"].includes(code)) return null;
  if (/403|CAPTCHA|AUTH|LOGIN|CREDENTIAL/.test(code))
    return { retryable: false, action: "CHECK_PORTAL", message: "O portal bloqueou o acesso. Verifique a fonte ou a sessão no Cofre; não repetiremos automaticamente nem tentaremos contornar o bloqueio." };
  if (/404|NOT_FOUND|IDENTITY|REDIRECTED/.test(code))
    return { retryable: false, action: "CHECK_BOARD", message: "Confira a URL e a identidade da empresa. Um board indisponível não encerra automaticamente suas vagas." };
  if (/LOCATION_UNSUPPORTED/.test(code))
    return { retryable: false, action: "ADJUST_LOCATION", message: "Este portal não aceitou a localização. Ajuste a região antes de buscar novamente apenas nele." };
  if (/429|RATE_LIMIT/.test(code))
    return { retryable: true, action: "RETRY_LATER", message: "O portal limitou as consultas. Aguarde antes de repetir somente esta fonte." };
  if (/5\d\d|TIMEOUT|TIMED_OUT|OFFLINE|ECONN|FETCH_FAILED/.test(code))
    return { retryable: true, action: "RETRY_LATER", message: "Falha temporária de rede ou do portal. As vagas salvas foram preservadas; tente novamente apenas nesta fonte mais tarde." };
  if (/EMPTY|NO_RESULTS/.test(code))
    return { retryable: false, action: "REFINE_QUERY", message: "A consulta não encontrou resultados. Experimente outro termo ou localização; vazio não significa fonte indisponível." };
  return { retryable: false, action: "INSPECT_SOURCE", message: "Confira o diagnóstico da fonte antes de repetir a consulta." };
}
