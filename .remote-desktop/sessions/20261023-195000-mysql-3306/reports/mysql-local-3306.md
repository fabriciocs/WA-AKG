# Configuração MySQL local — WA-AKG

**Status: BLOCKED — endpoint MySQL ajustado, autenticação pendente.**

## Alteração aplicada
- Arquivo: `C:\repos\WA-AKG\.env`
- `DATABASE_URL` agora aponta para `127.0.0.1:3306/wa_akg`.
- Backup privado do `.env` anterior preservado em `raw\.env.before.backup`; contém segredos e não deve ser compartilhado.
- Serviço Windows `MySQL80` está em execução e a porta TCP 3306 está acessível.
- Não foi usado Docker.

## Validação
- A conexão TCP com MySQL 3306 foi bem-sucedida.
- O teste Prisma usando as credenciais atuais foi rejeitado pelo MySQL (credenciais de `root` inválidas para essa instância).
- Não foi criado banco, usuário ou tabela e nenhuma senha foi alterada.
- O processo WA-AKG foi reiniciado para reler `.env`, mas não foi observado listener HTTP na porta 43000 no período de validação. A inicialização precisa ser repetida após corrigir credenciais.

## Próximo requisito
É necessária uma credencial administrativa válida para a instância local MySQL 8.0 ou uma conta já autorizada a criar banco/usuário. Depois disso: verificar se `wa_akg` existe; criar apenas se ausente; criar usuário dedicado de menor privilégio; aplicar `prisma db push` somente após backup/confirmar o estado do schema; testar leitura; reiniciar WA-AKG e validar `/` e `/mcp`.

Nenhum commit, push, merge, deploy ou comando Docker foi executado.
