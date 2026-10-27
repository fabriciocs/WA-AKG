# OAuth para API e MCP

O WA-AKG funciona como Authorization Server OAuth para usuários já cadastrados. Clientes OAuth são criados por um SUPERADMIN em **Dashboard → OAuth Access**; não há cadastro público de clientes.

## Configuração

`OAUTH_ISSUER_URL` é opcional e, quando definido, deve conter a URL pública canônica do Authorization Server, incluindo caminho explícito se houver. Sem essa variável, o issuer usa a origem de `BASE_URL` (ou a origem encaminhada e validada pela requisição) e acrescenta o prefixo recebido em `X-Forwarded-Prefix` uma vez. `NEXTAUTH_URL` configura somente o NextAuth e não é usado como issuer OAuth. Em produção, mantenha a origem em HTTPS.

Os registros OAuth ficam no banco Prisma. Aplique a atualização aditiva do schema pelo procedimento de banco já usado na instalação antes de habilitar os endpoints. A configuração de migrations não apaga dados existentes.

## Clientes

Em `/dashboard/oauth`, usuários autenticados podem revisar e revogar concessões. SUPERADMIN também pode criar e desativar clientes OAuth. A tela cria clientes públicos com Authorization Code + PKCE. Para clientes confidenciais, use a API administrativa `POST /api/oauth/clients`; o segredo é devolvido uma única vez e persistido apenas como hash. O grant `client_credentials` está desabilitado.

O endpoint administrativo aceita `name`, `description`, `redirectUris`, `allowedScopes`, `grantTypes` e `isConfidential`. Scopes e grants devem ser explicitamente permitidos para cada cliente. Os grants suportados são `authorization_code` e `refresh_token`.

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

O login OAuth usa as contas já existentes. A tela de consentimento mostra cliente e scopes e permite limitar a concessão às sessões WhatsApp acessíveis selecionadas. Sem seleção, a API mantém as permissões existentes do usuário e a lista de `SessionAccess`; uma seleção restringe todas as chamadas do token àquelas sessões.

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
WA_AKG_MCP_WRITE_ALLOWLIST=
WA_AKG_MCP_ALLOW_REMOTE_API=false
```

O MCP usa o `Authorization: Bearer` OAuth do usuário, valida o token em cada requisição MCP e o encaminha às operações de API. Clientes devem obter o recurso em `/.well-known/oauth-protected-resource` e o Authorization Server em `/.well-known/oauth-authorization-server`. O cliente MCP faz descoberta e registro dinâmico, e a autorização exige confirmação do e-mail da conta. Cada concessão inclui todas as sessões próprias ou compartilhadas que o usuário pode acessar, a menos que ele selecione uma lista menor na tela de consentimento. O WA-AKG reavalia as permissões atuais em cada chamada, então sessões compartilhadas removidas deixam de funcionar. Conceda `mcp:write` somente quando necessário e habilite cada ferramenta de escrita por uma entrada exata `METHOD /path` em `WA_AKG_MCP_WRITE_ALLOWLIST`.

As sessões de transporte MCP vivem em memória, expiram após 30 minutos sem atividade e têm limite de 500 sessões por processo. Refresh de OAuth pode continuar a sessão quando o mesmo usuário e cliente fazem a próxima chamada. Reiniciar o servidor encerra essas sessões de transporte; o cliente MCP deve inicializar outra sessão.

O modo stdio continua local. `WA_AKG_API_KEY` é usado somente por esse modo quando configurado. O API target remoto exige HTTPS e continua bloqueado por padrão; habilite `WA_AKG_MCP_ALLOW_REMOTE_API=true` apenas quando a implantação precisar disso.

## Verificação operacional

O endpoint MCP é desativado por padrão. Configure issuer, schema, clientes e redirect URIs antes de permitir conexões externas. Use logs que não imprimam Authorization headers, códigos ou tokens. Testes contra banco, proxy HTTPS e cliente MCP real devem ser feitos no ambiente da instalação.
