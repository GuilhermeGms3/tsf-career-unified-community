// Presentation only: API/model values remain unchanged. Unknown values never become English copy.
export const presentation = {
  auth: {
    AUTH_REQUIRED:'Entre na Gupy para continuar', AUTH_REQUEST_CREATED:'Solicitação de autenticação preparada',
    LAUNCH_PENDING:'Aguardando abertura da janela de autenticação', AUTH_IN_PROGRESS:'Autenticação em andamento',
    USER_ACTION_REQUIRED:'Conclua a autenticação na janela da Gupy', SESSION_VALIDATING:'Verificando sua sessão',
    SESSION_ACTIVE:'Acesso verificado para esta empresa', SESSION_EXPIRED:'Sua sessão expirou',
    AUTH_REQUEST_EXPIRED:'Sua tentativa de autenticação expirou', AUTH_LAUNCH_FAILED:'Não foi possível abrir a janela de autenticação da Gupy.',
    AUTH_FAILED:'Não foi possível concluir a autenticação da Gupy.', LAUNCH_NOT_ACKNOWLEDGED:'Não conseguimos abrir a janela automaticamente.',
    GUPY_TARGET_SELECTION_REQUIRED:'Escolha a empresa onde deseja entrar.', GUPY_JOB_REQUIRED:'Escolha uma oportunidade Gupy válida.',
    AUTH_HANDOFF_INVALID:'Esta autorização de abertura não é mais válida.', AUTH_REQUEST_NOT_FOUND:'A tentativa de autenticação não foi encontrada.',
    AUTH_RATE_LIMITED:'Muitas tentativas de autenticação. Aguarde alguns minutos.', AUTH_COMPLETION_IN_PROGRESS:'A sessão já está sendo verificada.',
    PROTOCOL_HANDLER_FAILED:'O Windows não conseguiu iniciar o auxiliar de autenticação.', RUNNER_START_FAILED:'O auxiliar de autenticação não conseguiu iniciar.',
    NODE_NOT_FOUND:'O auxiliar de autenticação precisa do Node.js instalado.', CHROMIUM_NOT_FOUND:'O navegador exclusivo de autenticação não está instalado.',
    CLAIM_FAILED:'O auxiliar não conseguiu confirmar a solicitação.', BROWSER_START_FAILED:'Não foi possível abrir a janela de autenticação da Gupy.',
    BROWSER_NAVIGATION_FAILED:'Não foi possível carregar a página de autenticação da Gupy.', BROWSER_CLOSED:'A janela de autenticação foi fechada.',
    RUNNER_LOST:'Perdemos a comunicação com a janela de autenticação.', REQUEST_EXPIRED:'Sua tentativa de autenticação expirou.',
    SESSION_VALIDATION_FAILED:'Não foi possível confirmar a sessão. Entre novamente.', AUTHENTICATED_STATE_NOT_CONFIRMED:'A autenticação ainda não foi confirmada.',
    CANCELLED:'Tentativa cancelada', RUNNER_CLAIMED:'Auxiliar de autenticação iniciado', BROWSER_OPENED:'Janela de autenticação aberta', HEARTBEAT:'Auxiliar de autenticação respondendo',
  },
  application: {
    PREPARATION_REQUIRED:'Prepare o currículo desta vaga', APPROVED_JOB_SPECIFIC_VERSION_REQUIRED:'Aprove um currículo específico para esta vaga',
    REVIEW_REQUIRED:'Há itens que precisam da sua revisão', READY_TO_FILL:'Pronta para preencher', READY_TO_SUBMIT:'Pronta para revisão final',
    PREPARING:'Preparando candidatura', FILLING:'Preenchendo formulário', FILLED:'Formulário preenchido', VALIDATING:'Verificando formulário',
    SUBMITTING:'Enviando candidatura', SUBMITTED:'Candidatura enviada', SUBMISSION_UNCERTAIN:'Envio não confirmado',
    WAITING_USER:'Aguardando sua resposta', USER_REQUIRED:'Confirmação necessária', REQUIRED_ANSWER_UNKNOWN:'Responda às perguntas obrigatórias para continuar',
    EVIDENCE_GUARD_LINEAGE_REQUIRED:'Revise e aprove as evidências do currículo desta vaga', POLICY_NOT_ELIGIBLE:'Esta vaga não atende às condições de preparação',
    BLOCKED_DUPLICATE:'Já existe uma preparação ou candidatura para este destino', FINAL_STAGE_NOT_CONFIRMED:'A etapa final do formulário ainda não foi confirmada',
    RESUME_UPLOAD_MAPPING_REQUIRED:'O campo para anexar o currículo precisa ser verificado', JOB_CLOSED:'Esta vaga foi encerrada',
    ADAPTER_MISMATCH:'O formulário mudou ou ainda não pode ser preenchido com segurança', DRAFT_STATE_CONFLICT:'A preparação mudou. Atualize a página antes de continuar',
    ANSWERED_CONFIDENT:'Resposta confirmada', ANSWERED_USER_SAVED:'Resposta salva por você', ANSWERED_DERIVED:'Resposta derivada — requer atenção',
    NEEDS_REVIEW:'Revise esta resposta', UNSUPPORTED:'Requer preenchimento manual', DRY_RUN:'Somente verificar', FILL_ONLY:'Preencher sem enviar',
    PREPARE_ONLY:'Somente analisar formulários', APPROVAL_REQUIRED:'Preencher e aguardar aprovação', AUTO_SUBMIT_ELIGIBLE:'Envio automático indisponível',
    APPROVED_JOB_SPECIFIC_VERSION:'Currículo específico aprovado', OFF:'Desativado',
  },
  resume: {
    REVIEW_REQUIRED:'Há alterações que precisam da sua revisão', GENERIC:'Currículo base', JOB_SPECIFIC:'Currículo específico da vaga',
    DRAFT:'Rascunho', DRAFT_READY:'Pronto para revisão', RENDERING:'Gerando documentos', RENDERED:'Pronto para uso', GENERATION_FAILED:'Falha ao gerar', GENERATING:'Preparando documentos', BUILDING_VERSION:'Criando versão',
    AWAITING_SELECTION:'Escolha o currículo por vaga', AWAITING_REVIEW:'Aguardando revisão', BASE_SELECTED:'Base confirmada',
    TAILORING:'Preparando ajustes', TAILORING_REVIEW_REQUIRED:'Revise os ajustes', VERSION_REVIEW_REQUIRED:'Revise a versão',
    TAILORING_APPROVED:'Ajustes aprovados', VERSION_APPROVED:'Versão aprovada', ANALYZING:'Comparando bases', ANALYZED:'Comparação pronta',
    PARTIAL_SUCCESS:'Concluído parcialmente', NOT_REQUESTED:'Não solicitado', PDF_COMPILER_NOT_AVAILABLE:'O gerador de PDF não está disponível',
    BASE_01:'BASE 01 fiel ao PDF', OVERLEAF_BLUE:'Overleaf azul', OVERLEAF_CLASSIC:'Overleaf classico',
    ATS_STRICT:'Modelo de leitura simplificada', ATS_CLEAN:'Modelo limpo', GENERAL:'Geral',
    SUMMARY:'Resumo', EXPERIENCE:'Experiência', SKILLS:'Competências', PROJECTS:'Projetos', EDUCATION:'Formação',
    'PT-BR':'Português do Brasil', PT:'Português', EN:'Inglês', 'EN-US':'Inglês', ES:'Espanhol',
    BASE:'Currículo base', TAILORED:'Ajustado para a vaga', SINGLE_COLUMN:'Uma coluna', TWO_COLUMN:'Duas colunas',
    INFRA_NOC:'Infraestrutura e NOC', CLOUD_DEVOPS:'Cloud e DevOps', CYBER_SOC:'Cibersegurança e SOC', BACKEND_PYTHON:'Backend Python',
    ONE_COLUMN:'Uma coluna', ATS_TECH:'Modelo para vagas técnicas', ATS_BALANCED:'Modelo equilibrado',
    ATS_EARLY_CAREER:'Modelo para início de carreira', ATS_IMPACT:'Modelo orientado a resultados',
    PROFESSIONAL:'Modelo profissional', COMPACT:'Modelo compacto',
    PASS:'Aprovada pelo gate editorial',
    SUMMARY_PRESENT:'O resumo profissional está ausente ou curto demais', SUMMARY_CONCISE:'O resumo profissional está longo demais',
    SUMMARY_FORMAT:'O resumo profissional tem formatação quebrada', EXPERIENCE_BULLETS_PRESENT:'As experiências precisam de atividades objetivas',
    NO_DUPLICATE_BULLETS:'Existem atividades duplicadas', BULLET_LENGTH:'Revise o tamanho das atividades',
    BULLET_FORMAT:'Existem atividades com formatação quebrada', TARGET_ROLE_ALIGNMENT:'O texto ainda está pouco alinhado ao cargo',
    ATS_SCORE_NON_REGRESSION:'A nova versão reduziu a nota ATS', NO_GENERATION_ARTIFACTS:'O texto contém resíduos da resposta do modelo',
    EVIDENCE_VIOLATION:'Há afirmações sem evidência suficiente',
  },
  evidence: {
    NOT_INDEXED:'Repositórios ainda não analisados', SYSTEM_EXTRACTED:'Extraído pelo sistema — ainda não confirmado',
    USER_CONFIRMED:'Confirmado por você', IMPORTED_CONFIRMED:'Importado e confirmado', REVIEW_REQUIRED:'Revise esta evidência',
    USER_ENTERED:'Informado por você', RESUME_IMPORTED:'Currículo importado', DOCUMENT_IMPORTED:'Documento importado',
    CANDIDATE_PROFILE:'Seu perfil', APPROVED_RESUME_VERSION:'Versão aprovada do currículo', PROFILE_SYNC:'Sincronização do perfil',
    LEGACY:'Migração anterior', LEGACY_READ_ONLY:'Histórico preservado', GITHUB:'GitHub', REUSABLE:'Pode ser reutilizado',
    EXPLICIT_ONLY:'Exige confirmação a cada uso', ACTIVE:'Ativo', ARCHIVED:'Arquivado', VALID:'Validado', INVALID:'Precisa de correção',
    PROFESSIONAL:'Experiência profissional', PERSONAL_PROJECT:'Projeto pessoal', ACADEMIC_PROJECT:'Projeto acadêmico', COURSE:'Curso', LAB:'Laboratório',
    IN_PROGRESS:'Em andamento', PAUSED:'Pausado', COMPLETE:'Concluído',
  },
  opportunity: {
    EXCELLENT:'Excelente oportunidade', GOOD:'Boa oportunidade', EXCLUDED:'Fora da fila principal', STRETCH:'Oportunidade de desenvolvimento', REVIEW:'Vale revisar', RECOMMENDED:'Recomendada', PREPARE_ELIGIBLE:'Elegível para preparar',
    SKIP:'Não priorizar', BLOCKED:'Bloqueada', ELIGIBLE:'Elegível', ELIGIBLE_WITH_WARNINGS:'Elegível com alertas', INELIGIBLE:'Não elegível',
    LOCATION_MISMATCH:'Localização incompatível com sua busca', FAMILY_MISMATCH:'Área de atuação diferente da sua busca',
    SENIORITY_MISMATCH:'Senioridade diferente da sua busca', REMOTE_PORTUGAL:'Remoto em Portugal', LOCAL_LISBON:'Lisboa', LOCAL_PORTO:'Porto', LOCAL_BRAGA:'Braga', REMOTE_BRAZIL:'Remoto no Brasil', LOCAL_DF:'Brasília e Distrito Federal',
    INTERNSHIP:'Estágio', JUNIOR:'Júnior', MID:'Pleno', SENIOR:'Sênior', REMOTE:'Remoto', HYBRID:'Híbrido', ONSITE:'Presencial',
    BACKEND:'Desenvolvimento de sistemas', FRONTEND:'Desenvolvimento de interfaces', DEVOPS:'Desenvolvimento e operações', INFRASTRUCTURE:'Infraestrutura', SUPPORT:'Suporte',
    STRONG:'Forte', ADJACENT:'Área relacionada', WEAK:'Baixa', MATCH:'Correspondência', TRANSFERABLE:'Evidência transferível',
  },
  source: {
    AUTH_REQUIRED:'Autenticação necessária', NOT_REQUIRED:'Não exige autenticação', NONE:'Não exige autenticação', NOT_MANAGED:'Acesso à conta não gerenciado pelo aplicativo',
    INTERACTIVE_SESSION:'Autenticação em janela separada', PER_TENANT_SESSION:'Verificação de acesso por empresa', PER_HOST:'Verificação de acesso por empresa',
    TOKEN:'Credencial de acesso', DEVICE_FLOW:'Autorização por código', LOCAL_RUNNER:'Auxiliar local', NOT_CONFIGURED:'Ainda não configurado',
    CONFIG_REQUIRED:'Configuração necessária', CREDENTIAL_REQUIRED:'Credencial necessária', REQUIRES_AUTH:'Requer autenticação',
    SUPPORTED_LIMITED:'Disponível com limitações', NOT_SUPPORTED:'Não disponível', SUPPORTED:'Disponível', AVAILABLE:'Disponível',
    MANUAL_CAPTURE:'Importação manual', MANUAL_ONLY:'Uso manual', MANUAL:'Manual', OPTIONAL:'Opcional', DISABLED:'Desativado',
    OPERATIONAL_REAL:'Operacional com consulta real', SUCCESS_EMPTY:'Consulta real sem resultados', BLOCKED:'Bloqueada',
    NOT_IMPLEMENTED:'Discovery não implementado', DEGRADED:'Funcionando com limitações', UNKNOWN:'Ainda sem consulta real',
    DISCOVERY:'Busca de vagas', JOB_DETAILS:'Detalhes da vaga', DESCRIPTION_ENRICHMENT:'Complemento da descrição', RECRUITER_POST_CAPTURE:'Publicações de recrutadores',
    EVIDENCE_SYNC:'Sincronização de evidências', APPLICATION_PARSE:'Leitura do formulário', APPLICATION_FILL:'Preenchimento do formulário',
    RESUME_UPLOAD:'Anexo do currículo', READY_TO_SUBMIT:'Preparação para revisão final', CONTROLLED_SUBMIT:'Envio sujeito a autorização',
    AUTH_SESSION_REUSE:'Reutilização da sessão autorizada', API:'API', ATS:'Sistema de recrutamento', URL:'Link',
    PUBLIC:'Fonte pública', API_KEY:'Chave de API', PARTNER:'Parceiro', UNSUPPORTED:'Não disponível', CONSULTED:'Consultada',
  },
  connection: {
    CONNECTED:'Conectado', DISCONNECTED:'Desconectado', PAIRING_REQUIRED:'Conecte sua conta', ONLINE:'Disponível', OFFLINE:'Indisponível',
    OFFLINE_OPTIONAL:'Indisponível — recurso opcional', ONLINE_CONFIG_INCOMPLETE:'Disponível, mas falta configurar', DEGRADED:'Funcionando com limitações',
    HEALTHY:'Funcionando normalmente', UNAVAILABLE:'Indisponível', LIMITED:'Disponível com limitações',
    CONFIGURED:'Configurado', CONFIG_INCOMPLETE:'Configuração incompleta', PARTIAL_OR_READY:'Disponibilidade parcial ou pronta',
    UNKNOWN:'Ainda não verificado', NOT_CHECKED:'Ainda não verificado', READY:'Disponível', OPTIONAL:'Opcional', DISABLED:'Desativado',
    NOT_CONFIGURED:'Ainda não configurado', AUTH_REQUIRED:'Requer login', SESSION_EXPIRED:'Sessão expirada',
  },
  observability: {
    DEBUG:'Depuração', INFO:'Informação', WARN:'Aviso', ERROR:'Erro', CRITICAL:'Crítico', 'WARN,ERROR,CRITICAL':'Avisos e erros',
    OPEN:'Aberto', ACKNOWLEDGED:'Reconhecido', RESOLVED:'Resolvido', IGNORED:'Ignorado',
    SOURCE_AUTH:'Autenticação de fontes', SOURCE_HEALTH:'Saúde das fontes', HTTP:'Operações do aplicativo', SYSTEM:'Sistema',
    APPLICATION_FILL:'Preenchimento de candidaturas', APPLICATION_BATCH:'Candidaturas em lote', RESUME_BATCH:'Currículos em lote',
    RESUME_RENDER:'Geração de currículo', DOCUMENT_RENDER:'Geração de documentos', DISCOVERY:'Busca de vagas', GITHUB_SYNC:'Sincronização do GitHub',
    HTTP_OPERATION_COMPLETED:'Operação do aplicativo concluída', HTTP_OPERATION_FAILED:'Não foi possível concluir a operação',
    SOURCE_AUTH_LAUNCH_FAILED:'Falha ao abrir a autenticação da Gupy',
  },
  common: {
    AUTO:'Automático', LOW_VRAM:'Pouca memória de vídeo', BALANCED:'Equilibrado', HIGH_MEMORY:'Alta memória', OPTIONAL_DISABLED:'Opcional e desativado',
    HIGH:'Alta', MEDIUM:'Média', LOW:'Baixa', UNKNOWN:'Ainda não verificado', READY:'Pronto', WAITING_USER:'Aguardando você',
    REVIEW_REQUIRED:'Revisão necessária', SUBMITTED:'Enviada', SUBMITTING:'Enviando', SUBMISSION_UNCERTAIN:'Envio não confirmado',
    SCREENING:'Triagem', RECRUITER_INTERVIEW:'Entrevista com recrutador', TECHNICAL_INTERVIEW:'Entrevista técnica', FINAL_INTERVIEW:'Entrevista final',
    INTERVIEW:'Entrevista', SCHEDULED:'Agendada', OFFER:'Oferta', WITHDRAWN:'Retirada', ACCEPTED:'Aceita', BLOCKED:'Bloqueada',
    FAILED:'Falhou', RETRYABLE:'Pode tentar novamente', PLANNED:'Planejada', APPROVED:'Aprovada', USER_REQUIRED:'Confirmação necessária',
    KNOWN:'Conhecido', DERIVED:'Derivado', REJECTED:'Rejeitado', COMPLETED:'Concluída', PARTIAL:'Parcial', CANCELLED:'Cancelado',
    PENDING:'Pendente', RUNNING:'Em andamento', SUCCESS:'Concluído', EMPTY:'Nenhum resultado', NO_RESULTS:'Nenhum resultado',
    TIMED_OUT:'Tempo de espera esgotado', QUEUED:'Na fila', NOT_ATTEMPTED:'Ainda não executado', FALSE:'Não', TRUE:'Sim',
    OPERATIONAL_REAL:'Operacional com consulta real', SUCCESS_EMPTY:'Consulta real sem resultados', NOT_CONFIGURED:'Não configurada',
    NOT_IMPLEMENTED:'Discovery não implementado', MANUAL_ONLY:'Uso manual', DISABLED:'Desativado', DEGRADED:'Degradada',
    CONSULTED:'Consultada', BUDGET_SKIPPED:'Não executada por limite', RATE_LIMITED:'Bloqueada por limite do portal',
    PROCESS_INTERRUPTED:'Interrompida pelo reinício do aplicativo',
    USER_PAUSED:'Pausada por você',
  },
};
export function humanLabel(value,domain='common') {
  if(value===null||value===undefined||value==='')return 'Não informado';
  const code=String(value).toUpperCase();
  return presentation[domain]?.[code]||presentation.common[code]||Object.values(presentation).map(labels=>labels[code]).find(Boolean)||'Estado não reconhecido — consulte os detalhes técnicos';
}
export function humanError(error,domain='common') {
  const code=String(error?.code||error?.errorCode||'UNKNOWN_ERROR');
  const known=presentation[domain]?.[code]||Object.values(presentation).map(labels=>labels[code]).find(Boolean);
  return {message:known||'Não foi possível concluir esta ação.',nextAction:code==='GUPY_TARGET_SELECTION_REQUIRED'?'Escolha uma empresa.':/AUTH|SESSION|RUNNER|BROWSER|CHROMIUM|NODE_NOT_FOUND|CLAIM|PROTOCOL/.test(code)?'Tente novamente ou consulte como resolver.':'Tente novamente. Se persistir, consulte os detalhes técnicos.',code};
}
// Human-authored job/candidate prose is not an enum and must not be rewritten.
export function humanText(value,domain='common') {
  if(value===null||value===undefined||value==='')return 'Não informado';
  const text=String(value);
  return /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(text)||Object.values(presentation).some(labels=>Object.hasOwn(labels,text))?humanLabel(text,domain):text;
}
export const developmentOpportunityExplanation='Você atende parte importante da vaga, mas existem lacunas relevantes.';
