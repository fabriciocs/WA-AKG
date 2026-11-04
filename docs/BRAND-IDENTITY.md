# Identidade ConectaFlow — versão 0.2

**Status:** identidade provisória de interface e plugin. Antes do lançamento público, verificar marca registrada e domínio. A licença do projeto e atribuições de terceiros permanecem intactas.

## Posicionamento

ConectaFlow oferece uma interface para conectar sessões de mensagens, automações e equipes com autenticação, APIs e recursos MCP. Não é um produto oficial do WhatsApp ou da Meta.

## Sistema visual

- **Marca:** um C aberto representa conexão; duas travessas paralelas simbolizam fluxo; o ponto final indica a entrega da mensagem.
- **Cores:** tinta profunda `#0D3033`, verde-fluxo `#087F76`, lima `#BBEB68`, água `#55D6C2` e fundo claro `#F6F7EF`.
- **Tipografia:** Geist para interface; SVGs usam família sans-serif de sistema para portabilidade. Jamais depender da tipografia para reconhecer o ícone.
- **Tom:** objetivo e claro; não prometer recursos não verificados; não inserir depoimentos ou resultados inventados.
- **Raio:** 12–16px em componentes; raio expandido somente em destaque de marca.
- **Acessibilidade:** marca sempre com texto alternativo; contraste mínimo WCAG AA; foco visível; efeitos opcionais respeitando movimento reduzido.

## Arquivos canônicos

| Asset | Uso |
| --- | --- |
| `public/brand/conectaflow-mark.svg` | Marca quadrada, aplicação e dashboard |
| `public/brand/conectaflow-wordmark.svg` | Assinatura horizontal |
| `public/brand/conectaflow-favicon.svg` | Favicon vetorial |
| `public/brand/conectaflow-icon-192.png` / `-512.png` | Ícones PWA |
| `public/brand/conectaflow-social.svg` / `.png` | Prévia social 1200 × 630 |

O manifesto do plugin declara `brandColor`, `composerIcon` e `logo`, usando caminhos relativos a `./assets/`.

Os SVGs são fonte primária. Regenerar PNGs com `node scripts/generate-brand-assets.mjs`. Regenerar o plugin com `powershell.exe -NoProfile -File scripts/build-conectaflow-plugin.ps1`.

## Limites da migração

- Variáveis `WA_AKG_*`, nomes de tabelas, contratos de eventos, URLs persistidas e endpoint `/wa-akg/mcp` são identificadores técnicos de compatibilidade; não renomear sem uma migração validada.
- O pacote MCP mantém temporariamente a URL externa existente; substituir por URL com a nova marca somente depois que o proxy, OAuth issuer, audience e testes de descoberta funcionarem.
- O repositório remoto continua `fabriciocs/WA-AKG`; renomear ou republicar depende de decisão e autorização próprias.
- Não remover licença, histórico e atribuições de código original.
