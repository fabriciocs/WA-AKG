# Plano de comandos — sessão de conclusão

- CMD-001 READ_ONLY: registrar branch, HEAD, staged/unstaged/untracked; sucesso = evidência registrada.
- CMD-002 READ_ONLY: confirmar perfil Codex, package.json/lockfile e ausência de next-intl; sucesso = versão e causa verificadas.
- CMD-003 LOW_RISK_WRITE/LOCAL: executar Codex Exec com multi-agent opcional, pedir inspeção paralela e implementação mínima; exclusões = banco, deploy, push, merge, commit, Playwright, staging de arquivos, descarte de alterações.
- CMD-004 LOCAL_DEPENDENCIES: restaurar dependências a partir do lockfile atual sem modificar package.json/lockfile; não executar scripts externos além dos scripts locais necessários ao build.
- CMD-005 READ_ONLY/TEST: testes direcionados e suíte; sucesso = saída e código real capturados.
- CMD-006 READ_ONLY/TEST: TypeScript, ESLint focado e build; registrar todos os resultados, inclusive falhas.
- CMD-007 READ_ONLY: revisar diff e `git diff --check`; confirmar que staged diff permanece idêntico ao baseline.
- CMD-008 LOW_RISK_WRITE: atualizar relatório de sessão e checksums.
