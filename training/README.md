# Поколения модели WAF

| Поколение | Модель | Где получить |
| --- | --- | --- |
| [1](generations/1/) | Первая модель | Добавит автор проекта |
| [2](generations/2/) | Модель из образа, внутренняя версия `V3.0` | [Скачать `.tgz`](generations/2/open-appsec-advanced-model.tgz) |
| [3](generations/3/) | Кандидат, прошедший оценку | Архив из успешного прогона обучения после упаковки |

## Скачать и установить поколение 2

Скачайте [архив](generations/2/open-appsec-advanced-model.tgz) и [SHA256SUMS](generations/2/SHA256SUMS) в одну папку. Проверьте архив командой `sha256sum -c SHA256SUMS`. Затем загрузите `open-appsec-advanced-model.tgz` в разделе **Агенты → open-appsec → Агент → Модель**. Архив с карточкой модели также доступен в артефакте `waf-model-generation-2` успешного прогона. [GitHub Actions](https://github.com/opensophy-projects/NginxionS/actions/workflows/model-archives.yml)

Чтобы собрать архив из тех же байтов модели, в клоне с закреплённым коммитом выполните:

```bash
python3 training/package_generation.py baseline --out model-work/generation-2
```

Экспорт использует конкретный коммит и проверяет размер, SHA-256 и внутреннюю версию. Поэтому обновление модели в образе не меняет архив поколения 2. В неглубоком клоне сначала получите коммит из `generations/2/source.json`.

## Упаковать поколение 3

Возьмите `out/waap.data`, `out/model-card.json` и `metrics.json` из одного успешного прогона CI. Для упаковки нужен отчёт с полем `model_sha256`, вычисленным при оценке. Путь к распакованному артефакту передайте в `--work`.

```bash
python3 training/package_generation.py candidate \
  --work /path/to/extracted/waf-model --out model-work/generation-3
```

Упаковщик проверяет формат модели, сохранение исходной лицензии, совпадение SHA-256 и полный набор успешных проверок. Он сохраняет установочный архив, карточку с контрольной суммой и сводку оценки. Используйте файлы из доверенного прогона CI. Эта команда проверяет согласованность данных и не устанавливает модель. [Описание обучения и критериев оценки](../docs/MODEL.md).
