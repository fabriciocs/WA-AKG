# AGENTS.md — WA-AKG

## Objetivo
Manter o WA-AKG funcional, seguro, verificável e extensível. Inspecione a implementação real antes de propor ou alterar arquitetura. O repositório combina Next.js/React, TypeScript, Prisma, Baileys, APIs HTTP e Socket.IO; confirme versões e comandos em `package.json`.

## Regras de trabalho
- Diagnostique antes de alterar e prefira mudanças pequenas, rastreáveis e reversíveis.
- Preserve alterações preexistentes do usuário, incluindo arquivos staged, untracked e commits locais. Nunca use reset/clean ou descarte alterações.
- Não use Playwright. Não instale dependências durante diagnóstico sem justificativa e autorização.
- Não execute deploy, push, merge, release, migrações destrutivas, exclusões de dados ou alterações em serviços externos sem autorização explícita.
- Não leia, imprima nem registre valores de segredos em `.env`. Ao diagnosticar, liste apenas nomes de variáveis.
- Não considere documentação antiga, relatórios de erros ou inventários de rotas como estado atual sem reproduzir a verificação.
- Não declare sucesso apenas por exit code 0. Registre os comandos, os resultados e os critérios efetivamente verificados.
- Prefira ferramentas e versões já instaladas. Scripts PowerShell destinados ao Windows devem ser compatíveis com PowerShell 5.1.
- Antes de alterar autenticação, autorização, API keys, sessões WhatsApp, webhooks, banco ou Docker, avalie compatibilidade e efeitos operacionais.

## Processo obrigatório
1. Registrar branch, HEAD e `git status` antes das alterações.
2. Ler instruções e documentação pertinentes; mapear dependências e consumidores.
3. Definir hipótese, plano mínimo, risco e critério de aceitação.
4. Implementar em passos pequenos e revisar o diff.
5. Executar verificações proporcionais: lint, TypeScript, testes, build ou validação de integração quando disponíveis.
6. Distinguir testes locais de testes reais em serviços externos.
7. Revisar regressões, segurança, configuração e documentação.
8. Reavaliar gates e próximos passos; executar o trabalho restante que esteja autorizado.

## Segurança e integração
- Trate API keys como credenciais bearer: gere-as com criptografia segura, não as registre em logs e evite cache de respostas sensíveis.
- Validar autenticação e autorização em cada rota; não confiar somente em middleware ou na interface.
- Webhooks devem considerar autenticação/assinatura, timeouts, retentativas limitadas, deduplicação e proteção contra SSRF.
- Não ampliar CORS nem expor portas administrativas sem necessidade comprovada.
- Não incluir credenciais reais em exemplos, testes, commits ou relatórios.
- Alterações de schema Prisma devem ser incrementais; não usar reset ou operações destrutivas em bancos com dados.
- Mudanças em workflows, sessões ou transporte WhatsApp devem respeitar limites do provedor e evitar duplicação de efeitos externos.

## Estados de conclusão
Use `PROPOSED`, `IMPLEMENTED`, `TESTED`, `VERIFIED`, `BLOCKED`, `DEFERRED` ou `FAILED`. Só usar `VERIFIED` com evidência adequada. Para verificações impossíveis, registrar `NOT_VERIFIED` e o motivo.

## Relatório final
Informar: resumo, arquivos alterados, comandos e resultados, estado de cada gate, riscos, pendências, evidências e próximos passos. Não fazer commit, push, merge ou deploy como parte implícita da tarefa.
