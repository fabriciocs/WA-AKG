# Onboarding WA-AKG → MCP: implantação e validação

> Estado da implementação: código do wizard revisado em 2026-11-02. O teste de ponta a ponta com um cliente MCP exige confirmação independente. Nenhum teste automatizado deve criar sessão WhatsApp ou enviar mensagens de produção.

## Objetivo e limites

O onboarding orienta a instalação e o primeiro uso do WA-AKG até a disponibilização do MCP em um cliente autorizado. O sistema diferencia **configuração** de **funcionamento comprovado**: o wizard não marca uma conexão WhatsApp ou um cliente MCP como funcional por clique do usuário.

- Ambiente primário: Windows 11, PowerShell 5.1, Node 22+ recomendado, MySQL/Prisma, Caddy em `/wa-akg`.
- Banco e migrações: o assistente não faz `prisma db push` implícito nem reseta o banco.
- Sem alteração automática de serviços externos, ngrok, Caddy, WhatsApp ou publicação GitHub.
- Não usar Playwright; preferir CDP com Brave para E2E de interface.
- Evitar telemetria e reconexão de sessões reais durante smoke tests em ambientes não isolados.
- `SessionAccess` legado não confere acesso a usuários não proprietários na política atual; só proprietário ou SUPERADMIN.

## Fluxo funcional

1. **Pré-configuração CLI (`npm run setup`)**: validar Node, variáveis obrigatórias, URL pública, banco, chave de criptografia do AuthState, SMTP e migrations versionadas. Segredos não são logados.
2. **Autenticação**: login com usuário autorizado; verificar e-mail antes do consentimento OAuth.
3. **Sessão WhatsApp**: criar uma sessão por `POST /api/sessions` (efeito externo somente pela ação explícita do usuário), emparelhar QR em tela própria.
4. **Validação de sessão**: `GET /api/sessions/{sessionId}`, apenas `data.status === CONNECTED` com `data.hasInstance === true` permite avançar. `sessionStorage` conserva apenas seleção, nunca o status de conexão.
5. **Transporte**: selecionar HTTP/OAuth para clientes remotos ou `stdio` para ferramentas locais.
6. **HTTP/OAuth — pré-flight automatizado**: consultar os dois documentos `/.well-known`, verificar issuer e resource de mesma origem, PKCE S256, endpoints e desafio `401 WWW-Authenticate` do MCP.
7. **HTTP/OAuth — autorização real**: cliente escolhe CIMD, DCR ou registro manual, inicia Authorization Code + PKCE S256, login, consentimento com seleção de sessões e capacidade READ/WRITE, troca de código, `initialize`, `tools/list`, chamada READ. O wizard não simula esse último passo.
8. **stdio — pré-flight automatizado**: confirmar existência de API key do usuário via `GET /api/user/api-key`; nunca pedir sua cópia no frontend de status. Gerar/rotacionar na página OAuth Access e configurar a variável `WA_AKG_API_KEY` fora de arquivos rastreados.
9. **stdio — autorização real**: `WA_AKG_API_BASE_URL` aponta para a API local; executar `npm run mcp:check`, `npm run mcp:test`, e cliente real com `initialize`, `tools/list` e uma ferramenta READ.
10. **Conclusão**: distinguir `PREREQUISITES_OK`, `CLIENT_CONNECTED`, `TOOL_READ_VERIFIED` e `TOOL_WRITE_VERIFIED`. Somente os últimos dois constituem validação funcional de ponta a ponta.

## OAuth: 3 modalidades de cliente

### CIMD (Client ID Metadata Document)
O `client_id` é URL HTTPS pública do documento JSON de metadados do cliente. O resolver deve validar DNS/IP público, SSRF, URL e conteúdo, limite de tamanho, callback e scopes. Está implementado no checkout local de trabalho mas não deve ser tratado como funcional até a execução de testes de interoperabilidade com o cliente real.

### DCR (Dynamic Client Registration)
O cliente usa `registration_endpoint` informado pelo discovery; registro público limitado por taxa, callbacks validadas e escopos mínimos. Para leitura: `mcp:read api:read sessions:read`.

### Registro administrativo manual
SUPERADMIN cria cliente na tela `/dashboard/oauth` ou `POST /api/oauth/clients`, com `redirectUris`, `allowedScopes`, `grantTypes`. O `client_id` retornado é usado no cliente; para clientes públicos não há segredo. Registro manual não deve ser confundido com credencial local `stdio`.

As três modalidades convergem para Authorization Code + PKCE S256; o grant `client_credentials` não faz parte desse fluxo.

## Configuração de referência (variáveis, sem credenciais)

```dotenv
WA_AKG_MCP_ENABLED=true
WA_AKG_MCP_HTTP_PATH=/mcp
WA_AKG_API_BASE_URL=http://127.0.0.1:43000/api
WA_AKG_MCP_ALLOW_REMOTE_API=false
OAUTH_ISSUER_URL=https://example.ngrok-free.dev/wa-akg
```

O exemplo exige que o servidor real escute na porta local configurada e que o Caddy remova `/wa-akg` antes de encaminhar para a aplicação. Nunca adote a porta 3030 por padrão sem verificar a porta efetiva.

As URLs públicas, quando o proxy está configurado, devem possuir o mesmo prefixo:
- `https://<host>/wa-akg/.well-known/oauth-authorization-server`
- `https://<host>/wa-akg/.well-known/oauth-protected-resource`
- `https://<host>/wa-akg/mcp`
- `https://<host>/wa-akg/api/oauth/authorize`, `/api/oauth/token`, `/api/oauth/register`

O Caddy deve encaminhar também os aliases raiz de `/.well-known`, proteger `X-Forwarded-Prefix`/`Host`/`Proto` e manter ativos os WebSockets/Socket.IO. A presença de uma página 200 não comprova que o transporte MCP, a autenticação ou os recursos estão disponíveis.

## Controles obrigatórios

- Negar escrita por padrão; exigir scopes `mcp:write` + `api:write` e capacidade `WRITE` na sessão selecionada; não usar wildcards em políticas `stdio`.
- Revalidar dono/superadmin e sessão a cada chamada, incluindo revogação, token expirado, refresh replay e mudanças de acesso.
- Nunca armazenar senha, OAuth token, AuthState ou API key no repositório, documentação, log ou client-side storage. A presença anterior de uma API key em `.codex/config.toml` deve ser tratada como credencial exposta: **rotacionar fora deste procedimento e inspecionar o histórico Git**.
- Testar negativas de client_id, redirect_uri, state, PKCE, scope, resource, Origin, Content-Type, credencial ausente/expirada e sessão inexistente.
- Limitar quantidade/tamanho de requisições, proteger redirecionamentos e SSRF, preservar TLS e não confiar em proxies não controlados.

## Matriz de validação

| Gate | Método | Esperado |
|---|---|---|
| Instalação | `npm run setup` com configuração isolada | validação sem perder dados |
| Sessão WA | `GET /api/sessions/{id}` | CONNECTED + hasInstance true |
| Disc. OAuth | `GET /.well-known/oauth-authorization-server` | 200 JSON, PKCE S256 |
| Recurso MCP | `GET /.well-known/oauth-protected-resource` | 200 JSON, resource canônico |
| OAuth challenge | `GET /mcp` sem bearer | 401 com `WWW-Authenticate` resource_metadata |
| Registro | CIMD / DCR / manual | clientes reconhecidos com redirect exato |
| Consentimento | usuário e sessões | READ/WRITE apenas para sessões permitidas |
| Protocolo | initialize + tools/list | respostas JSON-RPC válidas |
| Delegação | ferramenta de leitura contra API | dado esperado sem segredos |
| Isolamento | usuário sem permissão + sessão revogada | 401/403 sem vazamento |
| Escrita | somente cenário isolado/autorizado | ação precisa + auditoria |
| Proxy | URLs prefixed + assets + Socket.IO | redirecionamento e sessão persistem |

## Diagnóstico local sem credenciais em logs

```powershell
Set-Location C:\repos\WA-AKG
git status --short
npm test
npm run mcp:check
npm run mcp:test
```

Para testar OAuth real, instale o schema/migrations apenas em banco conhecido, faça login com e-mail verificado, cadastre o cliente, conceda escopos e sessões necessárias, valide `resource` canônico e execute uma ferramenta somente de leitura pelo cliente.

## Próximas fases

1. Evoluir o wizard de pré-flight para um diagnóstico autenticado de `tools/list` mediado pelo cliente (sem armazenar token no frontend).
2. Exibir status persistente por usuário/cliente e motivos de bloqueio com carimbo e prova de runtime. Nunca guardar a etapa concluída como simples boolean de sessão local.
3. Integrar testes automáticos de E2E através de Brave/CDP com ambiente isolado, nunca com sessão real para ações de escrita.
4. Finalizar a interoperabilidade de CIMD/DCR/manual com clientes efetivos e atualizar a documentação com evidências.
