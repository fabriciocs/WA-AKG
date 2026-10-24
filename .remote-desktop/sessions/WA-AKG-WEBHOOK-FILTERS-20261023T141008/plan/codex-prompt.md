Conclua a tarefa em C:\repos\WA-AKG: finalizar os filtros avançados de webhook já parcialmente implementados, com testes, interface, documentação e todos os gates seguros.

Antes de editar, inspecione Git status, HEAD, staged/unstaged/untracked e instruções. Baseline: branch main, HEAD 9d74cf262d632247d45fc08d3554e796c3febc2a, 99 caminhos staged, staged hash = 84d7bf52862e074e9b3d2685fa1a49971557b8bc. NÃO altere o índice, não use git add/reset/clean/destructive checkout, commit, push, merge, release ou deploy. Preserve todas as alterações. Não use Playwright.

Use subagentes em paralelo, se possível: (A) lógica/Prisma/payloads, (B) API/UI/i18n, (C) testes/OpenAPI/docs. Auditorias read-only e sem escrita concorrente; agente principal é o único editor. Se falhar por memória/recurso, registre BLOCKED e prossiga sequencialmente sem loop.

Dependência: next-intl 4.14.9 está no package.json/lockfile, mas ausente de node_modules. O usuário autorizou restaurar dependências locais. Execute `npm ci` com lockfile atual, sem editar package.json/package-lock; se falhar, diagnostique e não regenere lockfile. Compare Git antes/depois.

Conclua os sete filtros sessionId, senderJid, chatJid, messageType, fromMe, isGroup, chatType. Valores ausentes/vazios não configuram critério; false explícito é critério ativo; combinação AND; evento sem campo não corresponde; JIDs exatos. Audite payloads, tipos Prisma/interativos, limites, persistência e semântica update (omitir filters preserva; {} ou null limpa segundo contrato), autorização e não exposição de segredos. Corrija somente defeitos comprovados e documente.

Execute e capture exit code/stdout/stderr/duração de: testes direcionados, npm test, prisma validate/generate sem banco, tsc, ESLint focado, build se viável, JSON/OpenAPI e git diff --check. Não execute banco, db push/migrations, webhook real, servidor externo ou deploy. Separe problemas preexistentes/ambientais de regressões.

Sessão: `.remote-desktop/sessions/WA-AKG-WEBHOOK-FILTERS-20261023T141008`. Preserve logs RAW sem segredos em raw; atualize evidence/environment.json, git.json, validation.json, plan e reports/summary.md e final-report.md; session.json, checksums.sha256. Sem segredos .env nos logs.

Ao final, staged hash deve continuar 84d7bf52862e074e9b3d2685fa1a49971557b8bc e o inventário de caminhos staged deve ser igual ao baseline. Revise diff unstaged, execute etapas seguras restantes e relate arquivos, comandos, resultados, riscos e pendências. Nunca alegue gate aprovado sem evidência.
