# Diagnóstico — conclusão dos filtros avançados de Webhooks

## Evidência inicial
- Repositório: `C:\repos\WA-AKG`
- Branch: `main`
- HEAD: `9d74cf262d632247d45fc08d3554e796c3febc2a`
- Git: 99 caminhos staged preexistentes e 4 caminhos untracked já existentes; 13 arquivos apresentam diff unstaged.
- `package.json` e `package-lock.json` contêm mudanças staged preexistentes. Não sobrescrever nem regenerar lockfile sem necessidade.
- Node.js 24.22.0, npm 11.19.1, PowerShell 5.1, Codex CLI 0.164.0.
- `next-intl` consta em package.json e lockfile (4.14.9), mas `node_modules/next-intl` está ausente.
- A execução anterior dos testes teve 24 aprovações e 1 falha por módulo ausente; TypeScript apresentou erros de resolução de next-intl.

## Plano de menor risco
1. Revalidar o estado de Git e as diferenças staged/unstaged/untracked antes de editar.
2. Usar Codex Exec com instrução explícita de preservar as alterações existentes; pedir auditoria paralela independente (implementação/filtros, API/UI, testes/documentação), se multi-agent estiver disponível.
3. Restaurar dependências de modo compatível com package-lock atual sem editar package.json/lockfile; nunca usar `git add`, reset, clean, checkout destrutivo ou commit.
4. Executar testes, typecheck, lint focado e build; corrigir apenas problemas atribuíveis à tarefa e atualizar documentação.
5. Validar diff e staged invariance; não conectar/mutar banco, fazer deploy, push ou chamadas de webhook externas.

## Critérios de aceitação
- Filtros mantêm semântica AND, vazio/desconfigurado é ignorado, false explícito funciona, validação server-side e tipos de mensagem coerentes.
- Testes direcionados e testes do projeto passam quando dependências permitirem.
- TypeScript, lint e build com resultados reais; falhas ambientais claramente separadas.
- Documentação atualizada, diff whitespace limpo, alterações staged preexistentes preservadas.
