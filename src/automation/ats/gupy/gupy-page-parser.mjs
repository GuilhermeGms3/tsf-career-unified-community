import {parseGupyIdentity} from "./gupy-identity.mjs";
export async function parseGupyPage(page){
    const identity=parseGupyIdentity(page.url());
    const metadata=await page.evaluate(()=>{
      const plain=value=>String(value||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,20000);
      const section=title=>{const heading=[...document.querySelectorAll("h2")].find(h=>h.textContent.trim()===title);return heading?.nextElementSibling?.textContent?.trim().slice(0,20000)||null;};
      let posting=null;
      for(const script of document.querySelectorAll('script[type="application/ld+json"]'))try{const parsed=JSON.parse(script.textContent),nodes=Array.isArray(parsed)?parsed:[parsed,...(parsed["@graph"]||[])];posting=nodes.find(n=>n["@type"]==="JobPosting");if(posting)break;}catch{}
      const text=document.body.innerText,location=posting?.jobLocation?.address;
      return {title:posting?.title||document.querySelector("h1")?.textContent?.trim()||null,company:posting?.hiringOrganization?.name||null,location:location?[location.addressLocality,location.addressRegion,location.addressCountry].filter(Boolean).join(", "):null,workModel:posting?.jobLocationType||null,description:posting?.description?plain(posting.description):section("Descrição da vaga"),requirements:posting?.qualifications?plain(posting.qualifications):section("Requisitos e qualificações"),responsibilities:section("Responsabilidades e atribuições"),stages:section("Etapas do processo"),validThrough:posting?.validThrough||null,status:/vaga (?:encerrada|finalizada)|inscrições encerradas|job closed/i.test(text)?"CLOSED":/inscrições abertas/i.test(text)?"OPEN":"UNKNOWN",source:posting?"PUBLIC_JSON_LD":"VISIBLE_DOM"};
    });
    return {...metadata,identity,applicationUrl:identity.applicationUrl,provenance:{url:identity.canonicalUrl||page.url(),source:metadata.source,parsedAt:new Date().toISOString()}};
  }
