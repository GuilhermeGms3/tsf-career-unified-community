# Reconciliação cross-source

Um lead comunitário pode ser vinculado a uma vaga oficial quando o alvo de candidatura é idêntico ou quando empresa e título atingem confiança alta. A vaga oficial mantém autoridade sobre os campos estruturados; o lead preserva sua proveniência e ganha referência ao `jobId` oficial. `job_sources` registra o provider oficial e `community-whatsapp`.

Confiança abaixo do limiar não faz merge automático. Dado ausente na comunidade nunca substitui campo oficial.
# Atualização V4.1.1

A reconciliação oficial não é mais limitada a `COMMUNITY_WHATSAPP_GROUP`. Leads de WhatsApp, Public Web e captura manual podem reconciliar por alvo/canonical URL exato ou assinatura forte de empresa, cargo e localização. Confiança intermediária apenas marca possível duplicata; não funde registros.
