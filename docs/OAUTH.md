# OAuth para API e MCP

O WA-AKG funciona como Authorization Server OAuth para usuários já cadastrados. Oferece três métodos de identificação do cliente: Client ID Metadata Document (CIMD), Dynamic Client Registration (DCR) e registro administrativo manual. A autorização do usuário continua exigindo login, PKCE S256, consentimento e políticas por sessão.

## Configuração

`OAUTH_ISSUER_URL` é opcional e, quando definido, deve conter a URL pública canônica do Authorization Server, incluindo caminho explícito se houver. Sem essa variável, o issuer usa a origem de `BASE_URL` (ou a origem encaminhada e validada pela requisição) e acrescenta o prefixo recebido em `X-Forwarded-Prefix` uma vez. `NEXTAUTH_URL` configura somente o NextAuth e não é usado como issuer OAuth. Em produção, mantenha a origem em HTTPS.

Os registros OAuth ficam no banco Prisma. Aplique a atualização aditiva do schema pelo procedimento de banco já usado na instalação antes de habilitar os endpoints. A configuração de migrations não apaga dados existentes.

## Clientes

Em `/dashboard/oauth`, usuários autenticados podem revisar e revogar concessões. SUPERADMIN também pode criar e desativar clientes OAuth. A tela cria clientes públicos com Authorization Code + PKCE. Para clientes confidenciais, use a API administrativa `POST /api/oauth/clients`; o segredo é devolvido uma única vez e persistido apenas como hash. O grant `client_credentials` está desabilitado.

O endpoint administrativo aceita `name`, `description`, `redirectUris`, `allowedScopes`, `grantTypes` e `isConfidential`. Scopes e grants devem ser explicitamente permitidos para cada cliente. Os grants suportados são `authorization_code` e `refresh_token`.

## Formas de identificação de cliente (Claude e outros clientes MCP)

As três opções do campo **Cliente OAuth** do Claude são modos alternativos no mesmo Authorization Server; nenhuma delas concede acesso sem consentimento. As URLs publicadas pelo servidor em `/.well-known/oauth-authorization-server` determinam os endpoints; não invente `/authorize` na raiz.

1. **Usar identidade publicada (CIMD, recomendado):** Claude usa uma URL pública HTTPS como `client_id`, apontando para seu documento JSON de metadados. O servidor consulta esse documento sem seguir redirecionamentos HTTP, exige `client_id` igual à URL, valida `redirect_uris`, `token_endpoint_auth_method=none`, grants, escopos e resolução DNS para IPs públicos. Limites: URL até 191 caracteres, porta 443, documento JSON até 16 KiB, timeout 5 segundos. O registro inicial é salvo com o identificador URL e sem segredo. Reautorizações revalidam o documento e aceitam apenas a interseção dos redirects/escopos registrados; se houver mudança de redirect incompatível, requer revisão do administrador. Não aceita documentação privada, destinos locais, redirecionamentos de resposta HTTP nem segredos simétricos. A descoberta anuncia `client_id_metadata_document_supported: true`. As permissões de escrita só são emitidas com escopos explícitos, consentimento e políticas de sessão.
2. **Registrar automaticamente (DCR, RFC 7591):** o cliente envia `POST {issuer}/api/oauth/register` com `application/json`, incluindo `redirect_uris`, `client_name` e opcionalmente `scope`, `grant_types`, `response_types`, `token_endpoint_auth_method=none`. O servidor valida e limita a taxa; a resposta HTTP 201 traz `client_id` aleatório sem `client_secret`. Escopos padrão: `mcp:read api:read sessions:read`; escrita precisa de solicitação explícita e concessão.
3. **Usar seu próprio cliente OAuth (registro manual):** SUPERADMIN cria o cliente em `/dashboard/oauth`, ou por `POST {issuer}/api/oauth/clients` autenticado. Copie o `client_id` retornado para o Claude; o `client_secret` pode ficar vazio para cliente público (o padrão da interface). Para clientes confidenciais, o administrador registra e entrega o segredo por canal seguro. Cadastre antes a callback exata `https://claude.ai/api/mcp/auth_callback`, se estiver usando Claude Web. O `redirect_uri` da requisição deve ser idêntico ao cadastrado.

Para todos os modos: `response_type=code`, PKCE S256, callback exata, `state` não vazio, `resource` igual à URL pública MCP e scopes compatíveis. Tokens são vinculados ao cliente, grant e `resource`. Não reutilize uma URL de autorização antiga com `state`/PKCE de outra tentativa. Escolha uma das três opções na UI do Claude, não as combine em uma tentativa.

**Compatibilidade CIMD Claude Web:** o documento público `https://claude.ai/oauth/mcp-oauth-client-metadata` anuncia `authorization_code`, `refresh_token` e `urn:ietf:params:oauth:grant-type:jwt-bearer`. O WA-AKG aceita o documento e seleciona somente os dois grants implementados: não anuncia, não emite nem executa JWT bearer. Claude Code publica `https://claude.ai/oauth/claude-code-client-metadata`, com callbacks loopback. Não fixe `client_id` de CIMD em cadastro manual: a URL completa é a identidade e deve ser consultada pelo servidor.

**Discovery para issuer com prefixo:** para `https://host/wa-akg`, RFC 8414 prevê `https://host/.well-known/oauth-authorization-server/wa-akg` (inserção do caminho), além da rota legada `https://host/wa-akg/.well-known/oauth-authorization-server` e do fallback sem prefixo quando aplicável. O metadata de recurso protegido para `/wa-akg/mcp` deve ser acessível em `https://host/.well-known/oauth-protected-resource/wa-akg/mcp` ou informado no desafio `WWW-Authenticate`. A rota raiz do Caddy não pode retornar texto genérico `200` nesses caminhos; use `scripts/Repair-Caddy-OAuth-Compat.ps1` para gerar e validar uma configuração candidata, com aplicação ao proxy compartilhado somente mediante autorização operacional específica.

**Reverse proxy/ngrok:** os endpoints públicos de discovery e OAuth precisam servir JSON/redirecionamentos reais, não páginas HTML de interposição (ex.: `ERR_NGROK_6024`). Um teste com o cabeçalho `ngrok-skip-browser-warning` não comprova que Claude consegue consumi-los: a integração exige respostas válidas também para clientes sem esse cabeçalho. Corrija a exposição pública do túnel antes de testar o fluxo fim a fim.

## Fluxo de usuário

O Authorization Code exige `state`, `code_challenge_method=S256` e `code_challenge`. O código expira em cinco minutos, é de uso único e é vinculado ao client, usuário, redirect URI, PKCE, scopes e limite opcional de sessões. O access token opaco expira em 15 minutos; refresh tokens expiram em 30 dias, giram a cada troca e têm replay revogado por família. Tokens e códigos nunca são armazenados em texto puro.

Endpoints disponíveis:

- `GET /.well-known/oauth-authorization-server`: discovery do Authorization Server.
- `GET /.well-known/oauth-protected-resource`: metadados do MCP protegido.
- `GET /api/oauth/authorize`: autorização do usuário e consentimento.
- `POST /api/oauth/token`: troca de código e refresh; corpo `application/x-www-form-urlencoded`.
- `POST /api/oauth/revoke`: revogação conforme RFC 7009.
- `POST /api/oauth/introspect`: introspecção para o próprio cliente.
- `GET /api/oauth/userinfo`: subject e metadados WA-AKG para cliente autorizado; não implementa OpenID Connect.
- `GET /api/oauth/grants` e `DELETE /api/oauth/grants/{clientId}`: consultar e revogar concessões do usuário atual.
- `GET` e `POST /api/oauth/clients`, `PATCH /api/oauth/clients/{clientId}`: administração SUPERADMIN.

O login OAuth usa as contas já existentes. A tela de consentimento mostra cliente e scopes e permite limitar a concessão às sessões WhatsApp acessíveis selecionadas. Para grants que usam sessões, é necessário selecionar explicitamente pelo menos uma sessão; cada sessão recebe `READ` por padrão ou `WRITE` quando escolhido. A lista efetiva é revalidada contra ownership e `SessionAccess` em cada chamada.

## Scopes

- `api:read`, `api:write`: leitura e escrita da API.
- `mcp:read`, `mcp:write`: leitura e escrita através do MCP. MCP exige `api:read` junto com `mcp:read`; escrita também exige `api:write` e `mcp:write`. O registro dinâmico aceita esses escopos quando solicitados explicitamente; por padrão, registra acesso somente de leitura.
- `sessions:read`: leitura de sessões.

As rotas mantêm suas verificações atuais de role, proprietário e `SessionAccess`. Tokens OAuth também precisam do scope apropriado. Scopes não elevam privilégios nem substituem a autorização por sessão.

## MCP HTTP

Ative o endpoint no processo WA-AKG:

```dotenv
WA_AKG_MCP_ENABLED=true
WA_AKG_MCP_HTTP_PATH=/mcp
WA_AKG_API_BASE_URL=http://127.0.0.1:3030/api
WA_AKG_MCP_ALLOW_REMOTE_API=false
```

O MCP usa o `Authorization: Bearer` OAuth do usuário, valida o token em cada requisição MCP e o encaminha às operações de API. Clientes devem obter o recurso em `/.well-known/oauth-protected-resource` e o Authorization Server em `/.well-known/oauth-authorization-server`. O cliente MCP faz descoberta e registro dinâmico, e a autorização exige confirmação do e-mail da conta. Cada grant contém uma capacidade `READ` ou `WRITE` por sessão selecionada. O WA-AKG reavalia as permissões atuais em cada chamada, então sessões compartilhadas removidas deixam de funcionar. Conceda `mcp:write` e `api:write` somente quando necessário; não existe allowlist global de escrita no fluxo OAuth.

As sessões de transporte MCP vivem em memória, expiram após 30 minutos sem atividade e têm limite de 500 sessões por processo. Refresh de OAuth pode continuar a sessão quando o mesmo usuário e cliente fazem a próxima chamada. Reiniciar o servidor encerra essas sessões de transporte; o cliente MCP deve inicializar outra sessão.

O modo stdio continua local. Na primeira configuração em **Dashboard → OAuth Access → Local MCP setup**, o WA-AKG gera uma API key exclusiva para o usuário autenticado. A chave é armazenada somente como hash, exibida uma única vez e deve ser colocada em `WA_AKG_API_KEY` no processo MCP daquele usuário; cada usuário deve usar sua própria chave. Sem `WA_AKG_MCP_CREDENTIAL_CAPABILITIES`, o stdio começa com leitura (`mcp:read`, `api:read`, `sessions:read`). Escritas continuam bloqueadas e exigem a política JSON explícita com capacidades por sessão e operações exatas; wildcards não concedem escrita. O API target remoto exige HTTPS e continua bloqueado por padrão; habilite `WA_AKG_MCP_ALLOW_REMOTE_API=true` apenas quando a implantação precisar disso.

## Verificação operacional

O endpoint MCP é desativado por padrão. Configure issuer, schema, clientes e redirect URIs antes de permitir conexões externas. Use logs que não imprimam Authorization headers, códigos ou tokens. Testes contra banco, proxy HTTPS e cliente MCP real devem ser feitos no ambiente da instalação.
