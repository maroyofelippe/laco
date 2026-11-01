# Laço — guia de marca para o produto

> **Finanças da família, em harmonia.**
> Organizar juntos. Planejar com clareza. Viver melhor.

Este pacote é a fonte única da identidade do Laço para o painel web, a API e o futuro app Flutter.

| Arquivo | Uso |
| --- | --- |
| `tokens.json` | Fonte única de cores, gráficos, tipografia e raios. |
| `build.mjs` | Gera `tokens.css` (web) e `apps/mobile/lib/core/theme/laco_tokens.dart` (Flutter): `node packages/brand/build.mjs`. |
| `logo/laco-simbolo.svg` | Símbolo colorido (versão compacta para interfaces pequenas). |
| `logo/laco-simbolo-mono.svg` | Símbolo monocromático (`currentColor`), para carimbos, impressão e ícones de sistema. |
| `logo/laco-simbolo-negativo.svg` | Símbolo sobre o verde profundo. |
| `logo/laco-icone-app.svg` | Ícone de app e favicon (símbolo sobre placa clara). |
| `logo/laco-logo-claro.svg` / `laco-logo-negativo.svg` | Logo horizontal (símbolo + nome) para fundos claros e escuros. |

## Símbolo

Uma silhueta de casa cuja linha de base se ergue e forma um laço: lar, vínculo e organização compartilhada, sem ícones de banco nem cifrões. A casa usa o verde profundo e o laço usa o dourado.

- Área de respiro mínima: metade da altura do símbolo em todos os lados.
- Tamanho mínimo: 20 px para o símbolo e 96 px de largura para o logo horizontal.
- Não distorcer, girar, trocar as cores entre casa e laço, nem aplicar sombra ou gradiente.
- **Provisório**: os arquivos foram desenhados a partir da descrição da proposta. Substitua-os pelo SVG oficial mantendo os mesmos nomes. O texto do logo horizontal ainda é fonte viva e deve ser convertido em contornos antes do lançamento.

## Cores

| Token | Hex | Papel |
| --- | --- | --- |
| `verde` | `#174B43` | Principal: confiança, estabilidade e cuidado. Botões, títulos, menu ativo. |
| `dourado` | `#E5A94D` | Metas, progresso e otimismo sem ostentação. **Só em preenchimentos e detalhes.** |
| `fundo` | `#F7F5EF` | Fundo das telas: leveza e leitura confortável. |
| `apoio` | `#526A62` | Textos secundários e rótulos. |
| `dourado-texto` | `#8A5A12` | Quando um texto precisa do tom dourado sobre fundo claro. |
| `receita` | `#1E7A5A` | Entradas e "dentro do combinado". |
| `despesa` | `#A8462F` | Saídas e "acima do combinado": terracota em vez de vermelho de alarme. |

### Contraste verificado (WCAG 2.1)

| Combinação | Razão | Resultado |
| --- | --- | --- |
| verde sobre fundo | 9,07 : 1 | AAA |
| apoio sobre fundo | 5,36 : 1 | AA |
| dourado sobre fundo | 1,90 : 1 | **não usar para texto** |
| verde sobre dourado | 4,76 : 1 | AA (botões e selos dourados usam texto verde ou tinta) |
| dourado sobre verde | 4,76 : 1 | AA |
| dourado-texto sobre fundo | 5,42 : 1 | AA |
| despesa sobre fundo | 5,38 : 1 | AA |
| receita sobre branco | 5,27 : 1 | AA |

Estado de limites e orçamentos: **verde** (tranquilo) → **dourado** (perto do combinado) → **terracota** (acima do combinado). Cor nunca é o único sinal: sempre há texto ou percentual junto.

## Tipografia

**Nunito Sans** (humanista e acolhedora, números legíveis), servida pelo próprio painel via `@fontsource-variable/nunito-sans`, sem requisição a terceiros. Pesos: 400 (texto), 600 (rótulos e ênfase) e 700 (títulos e valores). Valores monetários usam algarismos tabulares.

## Tom de voz

| Princípio | Na prática |
| --- | --- |
| Próxima e respeitosa | Fala com pessoas, não com planilhas. "Como está o mês da família?" |
| Clara | Traduz números em próximos passos. "Veja o que já está reservado e o que ainda está livre." |
| Inclusiva | Não presume quem paga as contas nem a composição da família: "pessoas da família", "quem lançou". |
| Tranquila | Sem culpa nem alarmismo. "Acima do combinado" em vez de "Estourou!"; nada de exclamações em alertas. |

### Vocabulário do produto

| Evite | Prefira |
| --- | --- |
| Limite estourado / ultrapassado | Acima do combinado |
| Atenção! | Perto do combinado |
| Usuário | Pessoa / membro da família |
| Erro ao processar | Não deu certo. Explique o motivo e o próximo passo. |
| Dashboard | Visão geral |
| Sem meta | Não planejado |

## Itens antes do lançamento

1. Verificar disponibilidade do nome, do domínio e do registro de marca (INPI e demais mercados).
2. Definir o domínio oficial e ajustar `PROBLEM_TYPE_BASE` da API e os links públicos.
3. Substituir os SVGs provisórios pelo arquivo oficial e converter o texto do logo em contornos.
