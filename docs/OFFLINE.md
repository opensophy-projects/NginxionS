# Офлайн-установка NginxionS на Linux x86_64

На подключённой к интернету машине с Docker соберите архив из checkout NginxionS. Используйте тег, опубликованный для обоих образов проекта. По умолчанию используется `develop`. Передайте `NGINXIONS_VERSION`, если нужен другой тег.

```sh
scripts/offline-bundle.sh nginxions-linux-amd64.tar
sha256sum nginxions-linux-amd64.tar > nginxions-linux-amd64.tar.sha256
```

Перенесите архив и его контрольную сумму на целевой сервер с Docker Engine 28+ и Docker Compose 2.23+. Для проверки происхождения используйте контрольную сумму, полученную по доверенному каналу. Бандл содержит конфигурацию и установочные образы. Пользователи, настроенные хосты и секреты существующей установки в него не входят.

На целевом сервере проверьте и распакуйте архив в пустой каталог. Загружать образы нужно на том же Docker-демоне, на котором будет работать стек.

```sh
sha256sum -c nginxions-linux-amd64.tar.sha256
mkdir nginxions-offline
tar -xf nginxions-linux-amd64.tar -C nginxions-offline
cd nginxions-offline
sha256sum -c SHA256SUMS
docker image load -i images.tar.gz
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --no-build --pull never
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

При запуске используйте версии образов из `deploy/.env`. Если в окружении заданы `NGINXIONS_REGISTRY`, `NGINXIONS_VERSION`, `POSTGRES_VERSION`, `CROWDSEC_VERSION` или `CLAMAV_VERSION`, снимите эти переопределения, чтобы Compose использовал образы из архива.

Сервисы должны перейти в состояние `healthy`, а `nginxions-init` завершиться с кодом 0. Панель доступна на `https://127.0.0.1:81` на сервере. Для удалённого доступа через SSH используйте туннель, как при обычной установке.

Workflow **Offline bundle** собирает архив из опубликованных образов, передаёт его на отдельный раннер и проверяет импорт, первый вход, проксирование, WAF и CrowdSec в закрытой сети.
