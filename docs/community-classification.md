# Classificação comunitária

O classificador determinístico reconhece linguagem de contratação em português e inglês, inclusive “meu time está buscando”, “precisamos de”, “posição aberta”, “hiring” e “looking for”. “Chama no privado ou inbox”, “manda DM”, “DM me”, “message me” e “reach out to me” resultam em `DIRECT_MESSAGE` quando não há email, telefone ou formulário.

O extrator tenta obter título, empresa somente quando explícita, localização, senioridade, skills, work model, método e alvo. Ollama não é necessário para o caminho determinístico; enriquecimento opcional deve ser apenas consultivo para ambiguidades.
