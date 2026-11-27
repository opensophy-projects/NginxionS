# NginxionS — правила разработки

NginxionS — форк NPMplus с встроенными open-appsec (ML-WAF) и CrowdSec. План: `docs/ROADMAP.md`.

## Два главных правила

1. **Всё управляется через GUI NginxionS.** Любая новая возможность включается и настраивается в интерфейсе. Если для неё нужно править compose, запускать `cscli`/`open-appsec-ctl` или редактировать файлы руками — задача не закончена. Что пока осталось в env, перечислено в `docs/ENV-INVENTORY.md`, и там же указано, когда это уходит в GUI.
2. **Local-first: никакой зависимости от облака.** Без интернета всё работает. Обращение наружу (ACME, обновления, hub CrowdSec, Gravatar…) — только опция, которую включает администратор, и она всегда с таймаутом. Недоступный внешний сервис не должен блокировать запуск. Проверяется тестом `scripts/test-airgap.sh`; каждая фаза добавляет сценарии в `deploy/test/smoke.sh`.

## Структура

| Путь | Что | Правила |
|---|---|---|
| `nginxions/` | NPMplus (git subtree, upstream `ZoeyVid/NPMplus`) + наши изменения | см. «Изменения в upstream-коде» |
| `nginxions/backend/nginxions/`, `nginxions/frontend/src/nginxions/` | Наш код (модули NginxionS) | Новый код — сюда |
| `openappsec/` | Исходники агента NginxionS: open-appsec `agent/`, `attachment/`, `smartsync-shared-files/`, `smartsync-tuning/`, `smartsync/` (git subtree, upstream `openappsec/*`) | Свой код агента; изменения upstream-файлов — с меткой `NginxionS:`, как в `nginxions/` |
| `deploy/` | `compose.yaml` (прод: `nginxions`, `openappsec`, `crowdsec`, `clamav`, `postgres` + разовый `nginxions-init`), `compose.dev.yaml`, `.env` (версии), `init/`, `openappsec/` (образ `nginxions-openappsec`), `test/` | |
| `docs/` | План, ADR, инвентаризация env | |

## Изменения в upstream-коде (`nginxions/`)

- Предпочитать новый код в `nginxions/`-каталогах и точечные «крючки» в upstream-файлах.
- Каждое изменение upstream-файла помечается комментарием `NginxionS:` с причиной (`// NginxionS: …`, `# NginxionS: …`). По этим меткам разрешаются конфликты при обновлении.
- Стиль — как в окружающем коде: биом-форматирование (табы, ширина 120), ESM, `async/await`.
- При добавлении, переименовании или удалении файла обновите раздел 4 в `CODE_OF_CONDUCT.md`. `scripts/check-tree.mjs` сверяет файлы в перечисленных там каталогах.
- Новые строки интерфейса — только в `en.json` и `ru.json` (`nginxions/frontend/src/locale/src/`). Текст прямо в TSX запрещён: `scripts/check-i18n.mjs` (в CI) проверяет, что у каждого ключа `en` есть перевод `ru` и что в разметке нет английского текста.

## Удалено из upstream

Из `nginxions/` удалены файлы NPMplus, которые NginxionS не использует: `caddy/`, `compose.yaml`, `ech-cron-cloudflare-example.sh`, `renovate.json`, `.github/`; во frontend — страницы, которые заменили страницы NginxionS (`pages/Dashboard`, `pages/AuditLog`, `pages/Certificates`, `pages/Nginx/*`), окна `HTTPCertificateModal`, `DNSCertificateModal`, `PermissionsModal`, хуки `useAuditLogs`, `useHostReport` и функции API только для них. `nginxions/README.md` заменён описанием каталога; `patches/attachment.patch` внесён в код `openappsec/attachment`. Если при обновлении NPMplus они вернутся конфликтом «modify/delete», удаляйте их снова (`git rm`).

Из `openappsec/` удалено то, что агент NginxionS не собирает и не запускает: `agent/deployment/` (примеры деплоя), `agent/examples/juiceshop/` (примеры шлюзов: nginx, swag, kong, envoy, apisix), `agent/build_system/apisix/`, `agent/build_system/charts/`, `agent/build_system/docker/Dockerfile` (образ — `deploy/openappsec/Dockerfile`), установщики без исходников (intelligence, CrowdSec auxiliary), готовые бинарники `agent/external/yajl` (примеры и тесты), `attachment/docker/` (kong, envoy, webhook), `attachment/attachments/{envoy,kong,nano_attachment}`, `smartsync*/build/` (их Dockerfile), `smartsync-tuning/internal/app/tuningdomain/v1` (не собирался). При `git subtree pull` они возвращаются конфликтом «modify/delete» — удаляйте снова.

В ветке `rfrns` лежат справочные снимки исходных репозиториев. При обновлении `openappsec/` сохраняйте лицензии, уведомления и инструкции встроенных библиотек. Справочные материалы upstream (`README.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md` в корне каждого из пяти компонентов и PDF аудита агента) доступны по коммитам из `deploy/openappsec/sources.env`. Кэш контрольных сумм в `smartsync-tuning/dependencies/openappsec.io/*/vendor/cache/` удалён. Версии локальных Go-модулей и их контрольные суммы заданы в `go.mod` и `go.sum`.

## Обновление NPMplus

```bash
git subtree pull --prefix=nginxions https://github.com/ZoeyVid/NPMplus <tag> --squash
```

Берём только релизные теги NPMplus (`YYYY-MM-DD-rN`): они ставятся не на `develop`, а `develop` может содержать незавершённые изменения. После обновления: разрешить конфликты по меткам `NginxionS:`, поменять образ NPMplus в последнем `FROM` `deploy/dev/Dockerfile` на тот же тег (с его дайджестом), прогнать проверки и закрытый контур. Текущий тег: **2026-11-18-r1** (nginx 1.31.9, исправления NGINX2Root).

## Команды проверки

```bash
# всё быстрое сразу (то же, что задача CI «Lint, types, tests»); --changed — только затронутое
scripts/check.sh
# backend
cd nginxions/backend && pnpm install --frozen-lockfile && pnpm biome ci . --assist-enabled=false \
  && node --test 'nginxions/**/*.test.js'
# frontend
cd nginxions/frontend && pnpm install --frozen-lockfile && pnpm biome ci . --assist-enabled=false \
  && node check-locales.cjs && node ../../scripts/check-i18n.mjs && pnpm formatjs compile-folder src/locale/src src/locale/lang \
  && pnpm tsc --noEmit && pnpm vitest run
# Go-сервисы агента (openappsec/): vet и тесты в Go-образе их Dockerfile
scripts/test-go.sh
# shell, compose
shellcheck -S warning scripts/*.sh deploy/*/*.sh
docker compose -f deploy/compose.yaml config -q
# закрытый контур (нужны образы nginxions и nginxions-crowdsec, см. ниже)
scripts/test-airgap.sh
```

`--assist-enabled=false`: upstream не соблюдает порядок импортов biome, массово его не исправляем (конфликты при обновлении).

## Образы

| Образ | Источник | Сборка |
|---|---|---|
| `nginxions` | `nginxions/Dockerfile` (+ стадия `crowdsec-seed`; контекст сборки `attachment=openappsec/attachment`) | долго: nginx, aws-lc, attachment из исходников |
| `nginxions-openappsec` | `deploy/openappsec/Dockerfile`: агент (C++), shared storage и tuning (Go) из `openappsec/` (контекст сборки `openappsec=openappsec`), `nginxions-control` (контекст `control=nginxions/backend/nginxions/control`) | долго: C++ |
| CrowdSec, ClamAV, Postgres | официальные образы, версии в `deploy/.env` | — |

Модель агента в образе — продвинутая модель (`openappsec/agent/components/security_apps/waap/resources/waap.data`, лицензия внутри
файла). Модель WAF NginxionS обучается из неё в CI на настоящем агенте (`training.yml`: ветки `training/**` или `[train]` в коммите) и
выпускается, только если на отложенных сайтах и атаках она не хуже модели образа; устройство, данные и выпуск —
`docs/MODEL.md`.

Исходники open-appsec лежат в `openappsec/` и меняются прямо в коде (метка `NginxionS:`). Коммиты upstream, от которых они взяты, — в `deploy/openappsec/sources.env` (полные хэши, проверяется в CI). Обновление: `git subtree pull --prefix=openappsec/<каталог> https://github.com/openappsec/<репозиторий> <коммит> --squash`, конфликты — по меткам `NginxionS:`, новый коммит — в `sources.env`; при обновлении `agent/` обновите примеры политик в `nginxions/backend/nginxions/waf/objects/examples/`. Локальная сборка всех образов: `scripts/build-images.sh` (тег `local/<имя>:dev`), затем `NGINXIONS_REGISTRY=local NGINXIONS_VERSION=dev scripts/test-airgap.sh`. Долгие сборки (nginxions, openappsec) делаются в CI или разработчиком, не в сессии агента.

Контейнер `openappsec` владеет сетью и IPC: порты опубликованы на нём, `nginxions` подключается к ним (`network_mode: service:openappsec`). Его процессы (`deploy/openappsec/nginxions-openappsec.sh`) слушают на 127.0.0.1: агент 7777, shared storage 7811, tuning 7813, smartsync 7815 (на управляющем сервере с узлами); backend `nginxions` на узле держит там ретранслятор обучения 7817/7818. `nginxions-control` работает без сети. Backend обращается к нему через Unix-сокет в томе `control-rpc`. Архитектура целиком — в `CODE_OF_CONDUCT.md`.

## Разработка

```bash
docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml up -d --build   # backend + стек
docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml watch           # синхронизация backend
cd nginxions/frontend && pnpm install && pnpm vite                                     # http://localhost:5173
```

- Dev-образ `nginxions:dev` = upstream-образ того же тега + наши `nginxions/backend` и `nginxions/rootfs`. Собирается за секунды. Прод-образ собирается из `nginxions/Dockerfile` в CI.
- Vite проксирует `/api` на `NGINXIONS_API` (по умолчанию `https://127.0.0.1:81`) и подменяет Origin.
- По умолчанию только IPv4 (`NGINXIONS_DISABLE_IPV6=true`); IPv6 включается `NGINXIONS_DISABLE_IPV6=false`.
- Генератор атак для проверки WAF: `--profile attack`.

## Безопасность

- Секреты генерирует `nginxions-init` в томе `secrets`. Каждый сервис монтирует только свой подкаталог (`subpath`). Пароли не попадают в compose и env-файлы.
- Сервисы, кроме `nginxions`, сидят во внутренних сетях без выхода наружу.
- Проверки безопасности в CI (SAST, секреты, SCA, SBOM, IaC, образы, DAST) и их политика — `docs/DEVSECOPS.md`; итог —
  в Summary прогона и в артефакте `security-report`. Находку исправляют; если нельзя — вносят в
  `.github/security/accepted-risks.json` с причиной и сроком. Ложное срабатывание Semgrep — `// nosemgrep: <правило> -- почему`.
  На обычных ветках CI быстрый (без образов и DAST); полный прогон — `work`, теги, PR, `[full]` в сообщении
  коммита или изменение агента/`deploy/`/Dockerfile; только часть тестов стека — `[smoke:waf]`, `[dast]` и т. п.
  (`scripts/ci-level.mjs`). Перед push — `scripts/check.sh` (быстрая часть CI локально); расширенный (тяжёлые сканеры) — ветки `security/**`, PR с меткой `security-scan`, Run workflow с уровнем
  `extended`.
- Доступ к `/var/run/docker.sock` есть только у `nginxions-control`. Он работает без сети и capabilities, с корнем только для чтения. Список, логи, перезапуск и reload ограничены контейнерами своего проекта с меткой `nginxions.managed`, запросы требуют токен. Только `nginxions` монтирует том `control-rpc` для соединения с API `control`.
