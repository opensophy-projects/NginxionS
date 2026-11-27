# Полное удаление NginxionS

## Установка через `scripts/install.sh`

```bash
sudo /opt/nginxions/uninstall.sh
```

После подтверждения скрипт удаляет контейнеры, сети, тома, локальные конфигурационные файлы и образы,
скачанные при установке. Образы, которые были на сервере до установки, используются другими контейнерами
или с тех пор были заменены, сохраняются. Также сохраняются исходный клон и резервные копии вне каталога установки.

Удаление томов необратимо. При необходимости сначала сделайте [резервную копию](#0-резервная-копия-по-желанию).

Второй запрос подтверждает удаление Docker Engine и Compose на Debian или Ubuntu. Если в Docker остались другие
контейнеры, тома, сети или образы, пакеты Docker сохраняются. При выборе «оставить Docker» репозиторий APT
остаётся, чтобы Docker продолжал получать обновления. При удалении Docker скрипт убирает добавленные им файлы репозитория APT.

При установке с `--dir` запустите `uninstall.sh` из указанного каталога. Параметр `--yes` подтверждает
удаление только NginxionS. Без ответа на второй вопрос Docker сохраняется.

## Стек, запущенный вручную

Следующие шаги относятся к установкам через Docker Compose и к тестовым стекам. В такой установке могут остаться:

- контейнеры;
- тома с данными: база, сертификаты, ключи CA, настройки, логи;
- сети;
- образы NginxionS и сторонние образы стека;
- кэш сборки;
- клон репозитория со всеми ветками;
- кэш интерфейса в браузере.

После этого установка начинается с нуля. Подходит для Linux и macOS. На Windows команды выполняются в WSL или Git Bash при запущенном Docker Desktop.

> **Удаление необратимо.** Пропадут хосты, сертификаты Let's Encrypt и их ключи, корневые CA и выданные клиентские сертификаты, пользователи, политика WAF, данные обучения агента, журнал событий. Если что-то из этого может понадобиться, сначала сделайте резервную копию (раздел 0).

## Почему «старое осталось» после переустановки

Обычно причина одна из двух:

1. **Остался старый образ.** Тег `develop` (или `latest`) уже лежит на машине, и `docker compose up` его не обновляет: стек запускается из старой сборки, даже если тома и папка удалены. Поэтому шаг 3 удаляет образы, а переустановка (раздел 7) скачивает их заново с `--pull always`.
2. **Браузер держит старый интерфейс.** Кэш и данные сайта панели переживают удаление сервера. Их чистит шаг 6.

Команды ручного удаления выполняются из каталога, из которого запускался стек.

## 0. Резервная копия (по желанию)

```bash
mkdir -p ~/nginxions-backup
for v in nginxions-data postgres-data secrets crowdsec-conf crowdsec-data appsec-localconfig appsec-data appsec-storage clamav-control; do
  docker run --rm -v nginxions_$v:/v:ro -v ~/nginxions-backup:/b alpine tar czf /b/$v.tgz -C /v .
done
```

Самое ценное:

- `nginxions_postgres-data` — база: хосты, пользователи, PKI, события;
- `nginxions_nginxions-data` — сертификаты, конфиги nginx, ключи;
- `nginxions_secrets` — сгенерированные пароли и ключ шифрования ключей CA. Без него зашифрованные ключи из базы не расшифровать.

Восстановление: создайте тома запуском `docker compose -f deploy/compose.yaml up -d`, остановите стек (`stop`), распакуйте
архивы обратно (`docker run --rm -v nginxions_$v:/v -v ~/nginxions-backup:/b alpine tar xzf /b/$v.tgz -C /v`) и запустите снова.

## 1. Стек

Из каталога ручной установки выполните:

```bash
docker compose -f deploy/compose.yaml down --volumes --remove-orphans
```

- Для dev-стека добавьте `-f deploy/compose.dev.yaml --profile attack`. Для собственного стека используйте его `compose.yaml` и имя проекта.
- Тестовые проекты Compose, например `nginxions-airgap` или `nginxions-chaos`, обычно удаляют сами тесты. Если прогон прервался, укажите то же имя проекта и те же файлы Compose, которые использовал тест.

## 2. Остатки

Compose удаляет только то, что знает по текущим файлам. Если файлы менялись или папки уже нет, остатки удаляются по имени и метке `nginxions.managed`.

| Что | Имена |
|---|---|
| Контейнеры | `nginxions`, `nginxions-openappsec`, `nginxions-control`, `nginxions-postgres`, `nginxions-crowdsec`, `nginxions-clamav`, `nginxions-nginxions-init-1`; от версий до ноября 2026: `nginxions-socket-proxy`, `nginxions-appsec-agent`, `nginxions-appsec-shared-storage`, `nginxions-appsec-tuning-svc`; dev и тесты: `nginxions-test-upstream`, `nginxions-attacker`, `nginxions-<тест>-*` (стеки тестов), `nginxions-<тест>-probe`/`-load` (их клиенты), `nginxions-contract-*` (контракт политики) |
| Тома | `nginxions_secrets`, `nginxions_nginxions-data`, `nginxions_postgres-data`, `nginxions_appsec-shm`, `nginxions_appsec-conf`, `nginxions_appsec-data`, `nginxions_appsec-logs`, `nginxions_appsec-localconfig`, `nginxions_appsec-model`, `nginxions_appsec-storage`, `nginxions_crowdsec-conf`, `nginxions_crowdsec-data`, `nginxions_clamav-db`, `nginxions_clamav-control`; тесты: `nginxions-<тест>_*`, `nginxions-<тест>-state` |
| Сети | `nginxions_edge`, `nginxions_internal`, `nginxions_control`; тесты: `nginxions-<тест>_*` |

Установка под старым названием NPMOS оставляет то же с префиксом `npmos`: если `scripts/upgrade-from-npmos.sh` не запускался, повторите шаг 2 с `npmos` вместо `nginxions`.

## 3. Образы

Без этого шага переустановка запустит старую сборку (см. начало).

- Образы NginxionS: `opensophy/nginxions`, `opensophy/nginxions-openappsec` (и `opensophy/nginxions-appsec-{agent,shared-storage,tuning}` старых версий) из Docker Hub, `local/nginxions*:dev` из `scripts/build-images.sh`, `nginxions:dev` из dev-стека.
- Сторонние: `crowdsecurity/crowdsec`, `clamav/clamav`, `postgres` (и `tecnativa/docker-socket-proxy` старых версий); для dev и тестов `traefik/whoami`, `curlimages/curl`, `zoeyvid/npmplus` (база dev-образа), `node` (сборка dev-образа). Удаляйте только конкретные теги, которые больше не используются. Удалённый образ просто скачается заново при следующем запуске того проекта.

## 4. Кэш сборки

Если образы собирались на этой машине (`scripts/build-images.sh`, dev-стек), кэш BuildKit может занимать гигабайты. Очищайте кэш отдельно, если для NginxionS использовался отдельный экземпляр BuildKit.

## 5. Папки

Клон ручной установки можно удалить отдельно после сохранения локальных изменений. Храните резервные копии вне клона.

## 6. Браузер

Интерфейс панели кэшируется в браузере, а тема и язык хранятся в данных сайта. Откройте панель (`https://<сервер>:81`, для dev ещё `http://localhost:5173`) и очистите данные сайта:

- **Chrome, Edge, Chromium:** F12 → Application → Storage → «Clear site data»;
- **Firefox:** значок замка в адресной строке → «Удалить куки и данные сайта».

Потом обновите страницу с Ctrl+Shift+R. Можно проверить и в окне инкогнито.

Если после переустановки домен перекидывает на старый адрес, это кэшированный редирект браузера: см. [Решение проблем](TROUBLESHOOTING.md#браузер-перенаправляет-на-другой-адрес-хотя-редиректа-в-nginxions-нет).

Сертификаты, импортированные в браузер или ОС, удаляются отдельно: корневой CA NginxionS и клиентские `.p12` для mTLS. В Chrome на Linux это «Настройки → Конфиденциальность и безопасность → Безопасность → Управление сертификатами», в Firefox — «Настройки → Приватность и защита → Сертификаты», в Windows — `certmgr.msc`, в macOS — «Связка ключей».

## 7. Переустановка с нуля

```bash
git clone -b work https://github.com/opensophy-projects/NginxionS ~/nginxions
cd ~/nginxions
docker compose -f deploy/compose.yaml up -d --pull always
docker compose -f deploy/compose.yaml ps    # все сервисы healthy
```

Репозиторий переехал из `opensophy-projects/NPMOS` в `opensophy-projects/NginxionS`; старый адрес GitHub перенаправляет. В уже
существующем клоне: `git remote set-url origin https://github.com/opensophy-projects/NginxionS`.

`--pull always` скачивает образы заново, даже если тег уже есть на машине. Проверка: `docker images | grep nginxions` показывает образы, созданные недавно, а не в день первой установки.

## 8. Что ещё проверить

- **Порты.** После удаления 80, 443 и 81 свободны (или свои из `NGINXIONS_HTTP_PORT`, `NGINXIONS_HTTPS_PORT`, `NGINXIONS_ADMIN_PORT`): `ss -ltnp | grep -E ':(80|443|81)\b'` ничего не выводит.
- **Файрвол.** Если для NginxionS открывали порты (ufw, firewalld, security group в облаке), закройте их: `ufw delete allow 81/tcp` и т.п.
- **DNS.** Записи доменов, которые указывали на этот сервер, перенаправьте или удалите.
- **Docker Hub.** Если входили в Docker Hub только ради NginxionS: `docker logout`.
