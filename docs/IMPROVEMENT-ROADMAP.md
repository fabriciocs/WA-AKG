# WA-AKG — Plano de melhorias técnicas

Data da inspeção: 2026-10-23  
Escopo: diagnóstico local de `C:\\repos\\WA-AKG`. Nenhuma implantação, alteração de banco ou chamada de API externa foi executada.

## Estado inicial confirmado

- Branch atual: `main`.
- HEAD observado: `01362d6` (`fix: update docker-compose configuration for improved service management and environment variable handling`).
- Git indica `main...origin/main [ahead 2, behind 2]`.
- `docker-compose-local.yml` já estava staged antes do trabalho. Deve ser preservado e revisado separadamente; não foi editado nesta tarefa.
- Stack declarada: Next.js 16.1.1, React 19.2.3, TypeScript, Prisma 5, Baileys 7 RC, Socket.IO.
- Não há script `test` no `package.json`.
- `src/lib/api-auth.ts` gerava API keys usando `Math.random()`. A função foi alterada para `node:crypto.randomBytes(24)` codificado em Base64URL.
- O Dockerfile contém uma condição shell de bootstrap de administrador com espaçamento suspeito. Não foi alterada porque corrigir o parsing sem rever o comportamento de promoção de usuários poderia mudar a segurança de inicialização.
- `src/server/index.ts` configura CORS Socket.IO com origem `*`; o impacto precisa ser avaliado antes de restringir ou ampliar a configuração.
- `NEXT_PUBLIC_SWAGGER_USERNAME` e `NEXT_PUBLIC_SWAGGER_PASSWORD` são variáveis com prefixo público. Verificar se credenciais são expostas ao bundle ou ao navegador antes de manter autenticação de Swagger baseada nelas.
- O endpoint de registro verifica a configuração de cadastro, mas não há evidência ainda de limitação de tentativas, normalização de e-mail ou verificação de endereço.
- Relatórios `eslint-errors.txt` e `ts_errors.log` contêm caminhos antigos e erros potencialmente desatualizados; não devem ser tratados como resultado do código atual.

## Alterações desta rodada

| Item | Estado | Evidência |
|---|---|---|
| Criar instruções operacionais do repositório em `AGENTS.md` | IMPLEMENTED | Arquivo criado |
| Trocar geração de API key para fonte criptograficamente segura | IMPLEMENTED | `src/lib/api-auth.ts` usa `randomBytes(24)` |
| Evitar cache em respostas que devolvem credenciais | IMPLEMENTED | `src/app/api/user/api-key/route.ts` envia `Cache-Control: no-store, max-age=0` em GET e POST |
| Validar geração de credenciais em runtime | TESTED | Amostra de 1.000 chaves: formato esperado e nenhuma duplicata na amostra |
| Preservar alteração staged preexistente | VERIFIED | Diff staged de `docker-compose-local.yml` foi inspecionado e o arquivo não foi editado |
| TypeScript (`npx tsc --noEmit --pretty false`) | TESTED | Exit code 0; verificação de tipos concluída sem erros reportados |
| ESLint (`npm run lint -- --no-warn-ignored`) | FAILED | Exit code 1; 473 problemas: 296 erros e 177 warnings em múltiplos arquivos |
| Build de produção (`npm run build`) | PARTIAL | Exit code 0 e 42 páginas geradas; durante prerender ocorreram erros repetidos de conexão com MySQL em `127.0.0.1:3307` e inicializações repetidas do scheduler |
| Testes de integração | DEFERRED | Não há script `test` configurado |
| Validação de configuração Docker Compose local | TESTED | `docker compose -f docker-compose-local.yml config --quiet` retornou exit code 0 |

## Backlog priorizado

### P0 — Segurança e inicialização

1. **Swagger e segredos públicos**
   - IMPLEMENTED: removida a comparação de credenciais no componente cliente; criada autenticação server-side em `/api/swagger-auth`, cookie HttpOnly assinado por HMAC com expiração de 1 hora, e proteção de `/api/docs`.
   - IMPLEMENTED: removidas as credenciais padrão `admin/admin123` da interface e adicionado suporte preferencial a `SWAGGER_USERNAME` / `SWAGGER_PASSWORD`; nomes legados continuam aceitos no servidor para compatibilidade com Compose.
   - TESTED: TypeScript passou; lint direcionado passou com dois warnings preexistentes na rota de API keys; teste do token confirmou aceitação do token válido e rejeição de token expirado.
   - PENDENTE: adicionar rate limiting ao login e validar a integração HTTP ponta a ponta com o servidor em execução. Rotacione qualquer senha de Swagger anteriormente exposta ou padrão.
2. **Bootstrap de SUPERADMIN**
   - Rever `Dockerfile` e `scripts/setup-admin.js`. O script promove usuários existentes a SUPERADMIN; o comportamento em todo startup precisa ser explicitamente controlado.
   - Critério: iniciar o container não promove silenciosamente uma conta comum.
3. **CORS do Socket.IO**
   - Mapear clientes reais, autenticação do handshake e necessidade de origens cruzadas.
   - Critério: origens autorizadas explícitas em produção, sem quebrar clientes válidos.
4. **API key**
   - IMPLEMENTED: geração criptograficamente segura e cabeçalhos `Cache-Control: no-store` nas respostas GET/POST.
   - TESTED: formato e comprimento conferidos em runtime para uma credencial; teste de geração repetida ainda pendente.
   - Avaliar rotação/revogação, exibição única e armazenamento por hash sem quebrar clientes existentes.

### P1 — Correção e qualidade

5. Executar TypeScript, ESLint e build com comandos locais instalados, capturando saída RAW e exit codes.
6. Corrigir erros reais reproduzidos, evitando usar relatórios antigos como fonte da verdade.
7. Criar infraestrutura mínima de testes para funções de domínio e rotas críticas.
8. Normalizar e-mails no registro e avaliar rate limiting, mensagens de erro e verificação de e-mail.
9. Revisar handlers de erro para evitar devolver detalhes internos em respostas HTTP.
10. Verificar compatibilidade dos scripts npm com Windows e Linux, mantendo comportamento explícito por plataforma.

### P2 — Confiabilidade e operação

11. Revisar webhooks: assinatura HMAC, timeout, retentativas limitadas, deduplicação, SSRF e retenção dos logs.
12. Revisar inicialização do servidor: falhas de `waManager.loadSessions()`, scheduler, heartbeat externo, shutdown gracioso e tratamento de processos. Durante `next build`, o scheduler foi inicializado repetidamente durante a geração de páginas e tentou consultar o banco indisponível; separar efeitos colaterais de runtime da importação/compilação.
13. Validar persistência de autenticação Baileys e arquivos de mídia em Docker; confirmar se volumes montados correspondem aos caminhos reais da aplicação.
14. Revisar política de migrações Prisma e evitar `db push` automático em ambientes de produção sem uma política explícita.
15. Gerar inventário de rotas diretamente do código e comparar com OpenAPI, documentando divergências.
16. Adicionar health/readiness checks que distingam servidor HTTP ativo, banco disponível e subsistema WhatsApp funcional.

### P3 — Manutenibilidade

17. Atualizar documentação e versão declarada do README a partir de fontes reais.
18. Remover relatórios e inventários obsoletos apenas após verificar se são artefatos necessários; não apagar arquivos automaticamente.
19. Adicionar CI local/CI de repositório para lint, TypeScript, testes, build e validação de schema.
20. Documentar recuperação de sessão, backup/restauração do banco, rotação de credenciais e rollback.

## Gates para a próxima rodada

- [x] TypeScript atual executado: exit code 0.
- [x] ESLint completo executado: 296 erros e 177 warnings; correção integral pendente.
- [x] Build executado: exit code 0, com erros de conexão ao banco durante prerender; estabilidade de build sem banco pendente.
- [x] Geração de API keys verificada em amostra de 1.000 chaves; teste automatizado persistente pendente.
- [x] Auditoria inicial de Swagger concluída e proteção server-side implementada; teste HTTP ponta a ponta e rate limiting pendentes.
- [ ] Revisão de bootstrap administrativo concluída.
- [x] Diff e status Git revisados; alteração staged preexistente em docker-compose-local.yml preservada.
- [x] Sem push, merge, release, deploy ou migração destrutiva.

## Critérios de estado

- `CONFIRMED`: comprovado por saída atual.
- `INFERRED`: conclusão técnica a validar.
- `NOT_VERIFIED`: teste ainda não executado ou sem resultado disponível.
- `BLOCKED`: impedimento concreto documentado.

Este documento é um plano de trabalho e não afirma que os gates pendentes foram aprovados.
