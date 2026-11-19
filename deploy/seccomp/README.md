# Профиль seccomp контейнеров NginxionS

`nginxions.json` — штатный профиль seccomp Docker
([moby/profiles](https://github.com/moby/profiles/blob/main/seccomp/default.json)), в котором контейнерам запрещено
создавать сокеты SCTP. Его получают все сервисы `deploy/compose.yaml` (`security_opt: seccomp=./seccomp/nginxions.json`).

## Зачем

NGINX2Root (опубликовано 18.11.2026) — это пять уязвимостей nginx (исправлены в nginx 1.31.9, NginxionS собирает его с
NPMplus `2026-11-18-r1`) и отдельная ошибка ядра Linux в подсистеме SCTP. Код, запущенный через nginx, получает права
рабочего процесса nginx, а через ошибку SCTP — root на хосте, в том числе из контейнера Docker: ядро у контейнеров
и хоста общее. Патча ядра на момент публикации нет.

Ни одному сервису NginxionS SCTP не нужен. Профиль закрывает этот путь внутри контейнеров: `socket()` для IPv4 и IPv6
разрешён только для потоковых, датаграммных и raw-сокетов с протоколом не SCTP (132); `SOCK_SEQPACKET` для IPv4/IPv6 —
это SCTP даже с протоколом 0, он запрещён тоже. Попытка получает `EPERM` раньше, чем ядро загрузит модуль `sctp`.
Остальное — как в профиле Docker по умолчанию.

## Что сделать на хосте

Профиль защищает контейнеры NginxionS, но не другие программы сервера. Пока ядро не исправлено и SCTP не нужен:

```bash
echo "install sctp /bin/false" | sudo tee /etc/modprobe.d/disable-sctp.conf
lsmod | grep -w sctp    # модуль уже загружен: rmmod sctp или перезагрузка
```

Это не действует, если SCTP встроен в ядро (не модулем). Когда выйдет исправленное ядро — обновите его.

## Обновление профиля

При новой версии профиля Docker:

```bash
curl -fsSL https://raw.githubusercontent.com/moby/profiles/main/seccomp/default.json -o /tmp/default.json
node scripts/seccomp-profile.mjs /tmp/default.json deploy/seccomp/nginxions.json
node --test scripts/seccomp-profile.test.mjs
```

Скрипт падает, если раскладка правил `socket()` в профиле Docker изменилась и его нужно поправить.
