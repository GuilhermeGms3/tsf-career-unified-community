import {api} from "../shared/data.js";
import {escapeHtml,toast} from "../../app/ui.js";

export function questionFallbackView(policy={}) {
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Perguntas pendentes</p><h2>WhatsApp primeiro</h2></div></div>
    <form class="task-form question-fallback-form" data-question-fallback>
      <label class="check"><input type="checkbox" name="enabled" ${policy.enabled?"checked":""}/> Tentar a IA depois do prazo nas vagas de nota alta</label>
      <div class="form-grid"><label><span>Espera pela sua resposta (minutos)</span><input name="waitMinutes" type="number" min="1" max="120" step="1" value="${Number(policy.waitMinutes)||20}"/></label>
      <label><span>Modelo da LLM (opcional)</span><input name="model" maxlength="200" value="${escapeHtml(policy.model||"")}" placeholder="Qwen3 4B 2507: detectar automaticamente"/></label></div>
      <label class="check"><input type="checkbox" name="autoFillEnabled" ${policy.autoFillEnabled?"checked":""}/> Permitir trechos literais da BASE 01 sem nova revisao</label>
      <label class="check"><input type="checkbox" name="researchEnabled" ${policy.researchEnabled?"checked":""}/> Consultar contexto da empresa pela Brave Search configurada</label>
      <p class="field-help">Salario, consentimentos, dados sensiveis e respostas sem evidencia continuam pendentes. Texto novo da IA precisa de revisao. O prazo nao autoriza envio em portal sem homologacao.</p>
      <button class="button primary" type="submit">Salvar espera das perguntas</button><p class="form-status" role="status"></p>
    </form></section>`;
}

export function bindQuestionFallback(root) {
  const form=root.querySelector("[data-question-fallback]");
  if(!form)return;
  const refresh=()=>{for(const key of ["waitMinutes","model","autoFillEnabled","researchEnabled"])form.elements[key].disabled=!form.elements.enabled.checked;};
  form.elements.enabled.addEventListener("change",refresh);refresh();
  form.addEventListener("submit",async event=>{
    event.preventDefault();const button=form.querySelector("button"),status=form.querySelector(".form-status");button.disabled=true;status.textContent="Salvando...";
    try {
      await api("/api/auto-apply/question-fallback",{method:"PUT",body:JSON.stringify({enabled:form.elements.enabled.checked,waitMinutes:Number(form.elements.waitMinutes.value),model:form.elements.model.value.trim(),autoFillEnabled:form.elements.autoFillEnabled.checked,researchEnabled:form.elements.researchEnabled.checked})});
      status.textContent="Preferencia salva. Prazos ja iniciados permanecem vinculados a pergunta original.";toast("Espera das perguntas atualizada.");
    }catch(error){status.textContent=error.message||"Nao foi possivel salvar a espera.";}finally{button.disabled=false;}
  });
}
