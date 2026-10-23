const text=value=>String(value?.text??value??"").trim();
const normalized=value=>text(value).normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/\s+/g," ");
const collectBullets = (value) => {
  if (Array.isArray(value)) return value.flatMap(collectBullets);
  if (typeof value === "string")
    return value
      .split("\n")
      .filter((line) => /^\s*[•*-]\s+/.test(line))
      .map((line) => line.replace(/^\s*[•*-]\s+/, ""));
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.bullets)) return value.bullets.map(text);
  return Object.values(value).flatMap(collectBullets);
};
const bullets = (resume) =>
  collectBullets([
    resume?.sections?.experience ||
      resume?.sections?.experiences ||
      resume?.experiences ||
      [],
    resume?.sections?.projects || resume?.projects || [],
  ])
    .map(text)
    .filter(Boolean);
const summary=resume=>text(resume?.sections?.summary||resume?.summary);
const malformed = (value) =>
  /\s{3,}|\p{Ll}\.\p{Lu}|\S[,;!?][A-Za-zÀ-ÿ]/u.test(value) ||
  /\b(undefined|null|lorem ipsum|n\/a)\b/i.test(value);
const hasArtifactMarkup = (value) => /```|#{3,}|[{}]\s*"[A-Za-z]/.test(value);
const hasRoboticProse = (value) => /\b(?:re[uú]ne conhecimentos comprovados|direcionad[oa]s? a|trajet[oó]ria re[uú]ne|base aplic[aá]vel a desafios|combina base t[eé]cnica|para contribuir em)\b/i.test(value);
const hasCompiledSummary = value => /profissional de tecnologia/i.test(value) &&
  /viv[eê]ncia com|atua[cç][aã]o voltada/i.test(value);
const hasFirstPersonSummary = value => /\b(?:eu|minha|meus|tenho|trabalhei|atuei|desenvolvi|automatizei)\b/i.test(value);
const targetTerms=job=>normalized(job?.title).split(/[^a-z0-9+#.]+/).filter(term=>term.length>=4&&!new Set(["analista","junior","pleno","senior","estagio"]).has(term));

export class ResumeQualityGate{
  evaluate({resume,baselineResume=null,tailoringChanges=null,job,originalScore=null,tailoredScore=null}={}){
    const blockingReasons=[],warnings=[],checks=[],resumeSummary=summary(resume),resumeBullets=bullets(resume),uniqueBullets=new Set(resumeBullets.map(normalized));
    const check=(id,ok,severity="BLOCK",detail="")=>{checks.push({id,status:ok?"PASS":severity,detail});if(ok)return;(severity==="BLOCK"?blockingReasons:warnings).push(id);};
    check("SUMMARY_PRESENT",resumeSummary.length>=60,"BLOCK",`${resumeSummary.length} caracteres`);
    check("SUMMARY_CONCISE",resumeSummary.length<=750,"BLOCK",`${resumeSummary.length} caracteres`);
    check("SUMMARY_FORMAT",!malformed(resumeSummary),"BLOCK");
    check("NATURAL_PROSE",!hasRoboticProse([resumeSummary,...resumeBullets].join("\n"))&&!hasCompiledSummary(resumeSummary)&&!hasFirstPersonSummary(resumeSummary),"REVIEW");
    check("NO_GENERATION_ARTIFACTS",!hasArtifactMarkup([resumeSummary,...resumeBullets].join("\n")),"BLOCK");
    check("EXPERIENCE_BULLETS_PRESENT",resumeBullets.length>0,"BLOCK",`${resumeBullets.length} itens`);
    check("NO_DUPLICATE_BULLETS",uniqueBullets.size===resumeBullets.length,"BLOCK",`${resumeBullets.length-uniqueBullets.size} repetidos`);
    check("BULLET_LENGTH",resumeBullets.every(item=>item.length>=20&&item.length<=420),"REVIEW","20 a 420 caracteres por item");
    check("BULLET_FORMAT",resumeBullets.every(item=>!malformed(item)),"BLOCK");
    const terms=targetTerms(job),corpus=normalized([resumeSummary,...resumeBullets].join(" "));
    check("TARGET_ROLE_ALIGNMENT",!terms.length||terms.some(term=>corpus.includes(term)),"REVIEW",terms.join(", "));
    if(Array.isArray(tailoringChanges)){
      const validChanges=tailoringChanges.filter(item=>item.validationStatus!=="EVIDENCE_VIOLATION"),
        hasSummary=validChanges.some(item=>item.type==="REWRITE_SUMMARY"||item.targetSection==="summary"),
        hasProfessionalRewrite=validChanges.some(item=>item.type==="REWRITE_BULLET"&&["experience","projects"].includes(item.targetSection)),
        baselineHasSummary=Boolean(summary(baselineResume)),baselineHasBullets=bullets(baselineResume).length>0;
      check("TAILORING_HAS_CHANGES",validChanges.length>0,"BLOCK",`${validChanges.length} alteração(ões) válida(s)`);
      check("TAILORED_SUMMARY",!baselineHasSummary||hasSummary,"REVIEW",hasSummary?"resumo direcionado":"resumo base preservado");
      check("TAILORED_EXPERIENCE",!baselineHasBullets||hasProfessionalRewrite,"REVIEW",hasProfessionalRewrite?"experiência direcionada":"experiência base preservada");
    }
    const before=Number(originalScore),after=Number(tailoredScore),comparable=originalScore!==null&&tailoredScore!==null&&Number.isFinite(before)&&Number.isFinite(after);
    check("ATS_SCORE_NON_REGRESSION",!comparable||after>=before,"BLOCK",comparable?`${before} -> ${after}`:"não comparável");
    const score=Math.max(0,100-blockingReasons.length*24-warnings.length*7),status=blockingReasons.length||score<70?"BLOCKED":warnings.length?"REVIEW_REQUIRED":"PASS";
    return {version:"resume-quality-gate-v1",status,score,autoApplyEligible:status==="PASS",blockingReasons:[...new Set(blockingReasons)],warnings:[...new Set(warnings)],checks};
  }
}
