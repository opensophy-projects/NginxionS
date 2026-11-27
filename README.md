<div align="center">

<img src="readme/logo.svg" alt="NginxionS" width="140">

# NginxionS

**Reverse Proxy & Application Security Platform**

Обратный прокси на nginx со встроенной защитой: WAF на машинном обучении, CrowdSec, свой центр сертификации
и mTLS, аналитика трафика и роли. Всё настраивается в одном интерфейсе и работает без облака.

[![CI](https://github.com/opensophy-projects/NginxionS/actions/workflows/ci.yml/badge.svg?branch=work)](https://github.com/opensophy-projects/NginxionS/actions/workflows/ci.yml)
[![Security](https://github.com/opensophy-projects/NginxionS/actions/workflows/security-weekly.yml/badge.svg)](https://github.com/opensophy-projects/NginxionS/actions/workflows/security-weekly.yml)
[![Docker](https://img.shields.io/badge/docker-opensophy%2Fnginxions-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/opensophy/nginxions)
[![WAF](https://img.shields.io/badge/WAF-open--appsec-f4405f)](https://github.com/openappsec/openappsec)
[![CrowdSec](https://img.shields.io/badge/IPS-CrowdSec-6f42c1)](https://www.crowdsec.net)
[![Local-first](https://img.shields.io/badge/local--first-без%20облака-2ea44f)](#принципы)
[![RU/EN](https://img.shields.io/badge/интерфейс-RU%20%7C%20EN-555)](#возможности)

[**Документация**](https://opensophy.com/) · [**Быстрая установка**](#быстрая-установка) · [**Возможности**](#возможности) · [**Контакты**](#безопасность-и-контакты)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="readme/overview-dark.webp">
  <img src="readme/overview.webp" alt="Обзор NginxionS" width="100%">
</picture>

</div>

## Быстрая установка

На Linux x86_64 с Git, свободными портами 80, 443 и 81 и примерно 10 ГБ на диске выполните:

```bash
git clone https://github.com/opensophy-projects/NginxionS nginxions &&
  cd nginxions &&
  sudo ./scripts/install.sh
```

Установщик развернёт стек в `/opt/nginxions` и дождётся готовности сервисов. На Debian и Ubuntu с systemd он предложит
установить недостающие Docker Engine и Compose из официального репозитория Docker. Ответьте `y` или передайте
`--yes` для автоматической установки. На других дистрибутивах заранее установите
Docker Engine 28+ и Compose 2.23+. Docker 28 закрывает доступ из локальной сети к портам, опубликованным на `127.0.0.1`.

Панель (порт `81`) по умолчанию слушает только `127.0.0.1` сервера, из интернета её не видно. Откройте её через
SSH-туннель и зарегистрируйте администратора:

```bash
ssh -L 8181:127.0.0.1:81 user@<адрес-сервера>   # затем в браузере https://localhost:8181
```

Чтобы открыть панель в сети управления или VPN, задайте `NGINXIONS_ADMIN_BIND_IP=10.0.0.5` в
`/opt/nginxions/deploy/.env` и повторите запуск установщика. Пароли сервисов
генерируются автоматически. Порты: `80` и `443` для сайтов, `81` для панели.

Установщик использует существующую конфигурацию при повторном запуске. Для ручного развёртывания из клона, в том числе обновления уже развернутого таким способом стека, используйте `git pull` и `docker compose -f deploy/compose.yaml up -d --pull always`.

Полное удаление установленного скриптом стека — `sudo /opt/nginxions/uninstall.sh`. Скрипт отдельно спросит,
удалять ли Docker. [Подробности удаления](docs/UNINSTALL.md).

Образы подписаны (cosign, keyless) и несут SLSA provenance и SBOM. Проверка подписи:

```bash
cosign verify docker.io/opensophy/nginxions:develop \
  --certificate-identity-regexp '^https://github.com/opensophy-projects/NginxionS/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Для сервера без интернета используйте [офлайн-бандл](docs/OFFLINE.md).

Подробная установка, обновление и решение проблем — в [документации](https://opensophy.com/).

## Возможности

| | Что умеет | Как выглядит |
|---|---|---|
| **Хосты** | Прокси, редиректы, потоки TCP/UDP и 404-хосты в одной таблице: TLS, WAF, mTLS и доступ каждого хоста видны сразу. Локации, списки доступа, HTTP/2 и HTTP/3, HSTS, проверка доступности upstream, история изменений. | <img src="readme/hosts.webp" width="420" alt="Хосты"> |
| **WAF на машинном обучении** | open-appsec по хостам и локациям: режимы «обучение», «обнаружение» и «блокировка», визуальный редактор политики и YAML, исключения, ограничение частоты запросов, своя страница блокировки. Модель в комплекте. | <img src="readme/waf-policy.webp" width="420" alt="Политика WAF"> |
| **Обучение агента** | Разметка ложных срабатываний прямо из событий, готовность каждого хоста к режиму блокировки, отмена решений. Настройки агента и fail-open — в интерфейсе. | <img src="readme/waf-agent.webp" width="420" alt="Агент open-appsec"> |
| **CrowdSec** | Баны и капча на nginx, сценарии по журналам доступа и событиям WAF, решения, алерты, машины и баунсеры, hub без интернета, блок-листы, белые списки, AppSec. | <img src="readme/crowdsec.webp" width="420" alt="CrowdSec"> |
| **События** | Атаки open-appsec, баны CrowdSec и отказы mTLS в одной ленте: фильтры, карточка события, экспорт, бан источника или исключение из события в один клик. | <img src="readme/events.webp" width="420" alt="События"> |
| **Аналитика** | Запросы, посетители, производительность, безопасность, кэш и серверы за хостами; периоды от «сейчас» до 30 дней, фильтры по любой строке, журнал запросов. | <img src="readme/analytics.webp" width="420" alt="Аналитика"> |
| **Сертификаты** | Единый реестр: ACME от любого центра (Let's Encrypt, ZeroSSL, Google Trust Services, SSL.com, свой ACME-сервер), HTTP- и DNS-проверка, свой CSR, клиенты certbot и lego; свои сертификаты; напоминания об истечении. | <img src="readme/certificates.webp" width="420" alt="Сертификаты"> |
| **Свой PKI** | Корневые и промежуточные центры сертификации, серверные и клиентские сертификаты, отзыв, CRL и OCSP, короткоживущие сертификаты с автопродлением, выдача в PEM, PKCS#12, по ссылке и QR. | <img src="readme/pki.webp" width="420" alt="PKI"> |
| **mTLS** | Защита хоста клиентскими сертификатами одним переключателем: сертификаты доступа по хостам, отзыв действует за минуту, своя страница отказа. | <img src="readme/mtls.webp" width="420" alt="mTLS"> |
| **Роли и аудит** | Встроенные и свои роли, права по разделам и по конкретным хостам, OIDC-группы, двухфакторная аутентификация, журнал аудита всех действий. | <img src="readme/roles.webp" width="420" alt="Роли"> |
| **Уведомления и система** | Email, webhook с подписью HMAC и Telegram по правилам; состояние контейнеров стека, настройки без правки env, GeoIP, перенос с Nginx Proxy Manager и NPMplus. | <img src="readme/login.webp" width="420" alt="Вход"> |

## Принципы

1. **Всё в интерфейсе.** После `docker compose up -d` не нужны ни терминал, ни правка файлов, ни `cscli`
   и `open-appsec-ctl`, ни облачные консоли.
2. **Без облака.** open-appsec и CrowdSec работают локально и автономно. Выход в интернет (ACME, hub CrowdSec,
   обновления) — только опция, которую включает администратор, всегда с таймаутом.
3. **Безопасность по умолчанию.** Секреты генерируются при первом запуске, внутренние сервисы сидят в сетях
   без выхода наружу, каждый образ проходит SAST, SCA, скан образов и DAST до публикации.

## Как устроено

Шесть сервисов: `nginxions` (nginx, панель и API), `openappsec` (WAF-агент и обучение), `control` (управление
стеком), `crowdsec`, `clamav` (проверка загружаемых файлов политикой WAF) и `postgres`.
При запуске `nginxions-init` подготавливает тома и создаёт недостающие секреты.
Образы — `opensophy/nginxions` и `opensophy/nginxions-openappsec` на Docker Hub, версии закреплены в
`deploy/.env`. См. [архитектуру](CODE_OF_CONDUCT.md#3-архитектура-nginxions),
[структуру репозитория](CODE_OF_CONDUCT.md#4-дерево-файлов) и [правила разработки](CONTRIBUTING.md).

Стек, установленный под старым названием NPMOS, переносится скриптом `scripts/upgrade-from-npmos.sh`
([как](docs/MIGRATION.md#обновление-стека-установленного-под-названием-npmos)).

## Безопасность и контакты

Актуальные контакты, способы сообщить об уязвимости и связаться с командой — на
**[opensophy.com](https://opensophy.com/)**. Пишите туда.

## Благодарности

NginxionS построен на [NPMplus](https://github.com/ZoeyVid/NPMplus) и
[Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager), использует
[open-appsec](https://github.com/openappsec/openappsec) и [CrowdSec](https://www.crowdsec.net).

Условия NginxionS описаны в [LICENSE](LICENSE).
