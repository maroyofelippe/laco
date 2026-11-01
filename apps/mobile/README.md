# Laço — app Android (Flutter)

> Finanças da família, em harmonia.

App Android do Laço. Ele fala **somente com a API** (`/api/v1`): não guarda credencial de banco e nunca acessa o MySQL. Funciona sem internet para lançar e consultar o que já foi baixado, e sincroniza quando a conexão volta.

> **Importante:** este código foi escrito sem um SDK Flutter disponível no ambiente de geração. Ele **não foi compilado nem executado**. Siga o roteiro de validação abaixo e, se aparecer algum erro, envie a saída de `flutter analyze` ou do build para correção.

## Requisitos

- Flutter **3.27 ou mais novo** (Dart 3.6+), Android SDK 35, JDK 17.
- Celular ou emulador com Android 6.0+ (API 23). O ML Kit (leitura da nota) roda no próprio aparelho.
- API do Laço rodando (veja o README da raiz).

## Primeira execução

```bash
cd apps/mobile

# 1) Completa o que não vai no repositório (gradle-wrapper.jar, local.properties).
#    Não sobrescreve os arquivos existentes de lib/ nem do android/ já configurado.
flutter create . --platforms=android --org br.app --project-name laco

# 2) Dependências
flutter pub get

# 3) Validação
flutter analyze
flutter test

# 4) Rodar no emulador (10.0.2.2 = "localhost" do computador visto pelo emulador)
flutter run --dart-define=API_URL=http://10.0.2.2:3001/api/v1
```

**Celular físico na mesma rede Wi-Fi**: use o IP do computador, por exemplo `--dart-define=API_URL=http://192.168.0.10:3001/api/v1`. Como esse endereço não é HTTPS, inclua o IP em `android/app/src/main/res/xml/network_security_config.xml` (só para testes) e libere a origem no `CORS_ORIGINS` da API se necessário. Em produção, use somente HTTPS.

Contas de demonstração: as mesmas do `npm run db:seed` da API (ver README da raiz).

### Se o build do Android falhar por versão do Gradle/Kotlin

O `android/` usa AGP 8.7.3, Kotlin 2.1.0 e Gradle 8.10.2. Se a sua versão do Flutter pedir outras:

1. Renomeie `android/` para `android_laco/` e rode `flutter create . --platforms=android --org br.app --project-name laco`.
2. Copie de volta de `android_laco/`: `app/src/main/AndroidManifest.xml`, `app/src/main/res/` (ícones, cores, splash, `xml/network_security_config.xml`) e `MainActivity.kt`.
3. No `android/app/build.gradle.kts` novo: `namespace`/`applicationId = "br.app.laco"`, `minSdk = 23`, `isCoreLibraryDesugaringEnabled = true` e a dependência `coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")` (exigida pelo `flutter_local_notifications`).

## Configuração por `--dart-define`

| Chave | Padrão | Para quê |
| --- | --- | --- |
| `API_URL` | `http://10.0.2.2:3001/api/v1` | Endereço da API |
| `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_SENDER_ID`, `FIREBASE_PROJECT_ID` | vazio | Push pelo FCM (opcional) |

Sem as chaves do Firebase o app não usa FCM: os alertas chegam pela verificação periódica (WorkManager a cada 15 min, só com internet) e sempre que o app volta ao primeiro plano. Com elas, o app registra o token em `POST /me/devices` e passa a receber push. Não é preciso `google-services.json`: o Firebase é inicializado pelas opções acima.

## Estrutura

```
lib/
├─ main.dart, app.dart, router.dart     inicialização, deep link de convite, rotas (go_router)
├─ core/
│  ├─ api/          Dio + renovação de token com uma única requisição por vez; erros Problem Details
│  ├─ auth/         sessão, tokens no Keystore (flutter_secure_storage)
│  ├─ db/           SQLite local: lançamentos, fila de envio (outbox) e cache
│  ├─ sync/         outbox com Idempotency-Key + GET /sync/changes incremental
│  ├─ data/         modelos e repositórios
│  ├─ notifications/ avisos locais, verificação periódica, FCM opcional
│  ├─ theme/        tokens da marca (gerados de packages/brand) e tema Material 3
│  └─ util/         dinheiro em centavos inteiros, datas, texto
├─ shared/widgets/  logo, cartões, valores, estados vazios, barra de limite
└─ features/        início, lançamentos, contas e faturas, orçamento, limites, alertas,
                    relatórios, importação de PDF, nota fiscal, família, ajustes
```

Sem geração de código (sem build_runner): Riverpod com provedores comuns.

## Como funciona offline

1. Um lançamento novo ganha um id UUIDv7 no celular, entra no banco local como **pendente** e vai para a fila de envio com `Idempotency-Key` igual ao id da entrada da fila. Se a conexão cair no meio do envio, o reenvio não duplica nada.
2. A fila é enviada **na ordem** sempre que há conexão, depois de cada escrita e quando o app volta ao primeiro plano.
3. Recusas definitivas (dados inválidos, sem permissão, conflito de edição) ficam em **Mais → Sincronização** com o motivo, para tentar de novo ou descartar. O celular volta a mostrar o que está no servidor.
4. O download usa um cursor (`GET /families/:id/sync/changes?since=`), inclui exclusões e não sobrescreve edições locais ainda não enviadas.
5. Painel, faturas, orçamento, limites e relatórios mostram a última resposta guardada quando não há conexão.
6. Ao sair da conta, o banco local é apagado (o app avisa se ainda há algo não enviado).

## Permissões do Android

| Permissão | Quando é pedida | Por quê |
| --- | --- | --- |
| `INTERNET` | instalação (sem diálogo) | Falar com a API |
| `POST_NOTIFICATIONS` (Android 13+) | só quando a pessoa toca em **Ativar** (Início ou **Mais → Avisos de limites**), depois de uma explicação | Avisar quando um limite chega perto ou passa do combinado |

O app **não** pede câmera, galeria, arquivos ou localização:

- **Foto da nota**: abre o app de câmera do sistema (`ACTION_IMAGE_CAPTURE`) ou o seletor de fotos do Android. A leitura (texto e QR Code) é feita no aparelho pelo ML Kit; a foto só é enviada se a pessoa marcar "anexar ao lançamento".
- **PDF do extrato**: seletor de documentos do sistema (Storage Access Framework), que dá acesso só ao arquivo escolhido.
- `allowBackup=false`: tokens e dados locais não vão para o backup automático do Google.
- Tráfego sem HTTPS liberado apenas para `10.0.2.2`, `localhost` e `127.0.0.1`.

## Telas

- **Abertura, entrar, criar conta, escolher/criar família, aceitar convite** (link `laco://convite/<token>`).
- **Início**: "Como está o mês da família?", entradas × saídas, limites combinados, vencimentos, atalhos.
- **Lançamentos**: busca, filtros, pendentes de envio; formulário com categoria obrigatória, parcelado, recorrente, membro, conta ou cartão; detalhe com anexos; edição com escopo para parcelas.
- **Contas e cartões**, faturas e pagamento de fatura.
- **Orçamento** (planejado × realizado), **Limites**, **Alertas** (ativos e histórico).
- **Relatórios**: por categoria e série mensal.
- **Importar extrato/fatura (PDF)**: envio, senha do PDF, revisão item a item (duplicados marcados para pular, categoria sugerida), confirmação atômica. PDF escaneado ou ilegível → caminho para lançar à mão.
- **Nota fiscal**: QR Code da NFC-e + leitura do texto; a pessoa confere valor, data e estabelecimento e segue para o formulário já preenchido.
- **Mais**: família ativa, atalhos, avisos, sincronização, sobre e sair.

## Tipografia

O tema usa Nunito Sans via `google_fonts`, que baixa a fonte na primeira execução e guarda em cache. Para não depender da internet, coloque `NunitoSans-*.ttf` em `assets/google_fonts/` (ver `LEIA-ME.txt` na pasta).

## Riscos conhecidos

- As dependências usam faixas de versão. Se o `pub get` escolher uma versão com mudança de API, fixe a versão anterior no `pubspec.yaml` e envie o erro.
- `applicationId` `br.app.laco` é provisório; o release está assinado com a chave de debug só para facilitar testes.
- Os logos são provisórios (mesmos de `packages/brand/logo`).
