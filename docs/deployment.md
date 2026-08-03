# Развёртывание ИТС Баланс на локальном сервере

## Что переносится

Для рабочего сервера нужны:

- исходный код проекта;
- `.env.local` с учётными данными;
- `server-data/runtime-state.json` с последней синхронизацией и
  распределением инженеров;
- Node.js 22.13 или новее;
- Chrome, Chromium или Microsoft Edge.

`.env.local` и `runtime-state.json` не находятся в Git. Их нужно перенести на
сервер отдельно. Не передавайте содержимое `.env.local` через чат.

## Подготовка

Выполняйте команды из корня проекта:

```bash
npm ci
npm run build
npm run deploy:check
npm run backup
```

`deploy:check` не выводит пароли. Он проверяет версию Node.js, наличие
обязательных настроек, браузера, production-сборки и доступность хранилища.

Рекомендуемая серверная конфигурация `.env.local`:

```dotenv
ATOL_LOGIN=...
ATOL_PASSWORD=...
ENGINEER_ADMIN_PASSWORD=...
ATOL_HEADLESS=true

APP_HOST=0.0.0.0
PORT=3000

ITS_STATE_PATH=server-data/runtime-state.json
ITS_BACKUP_DIR=D:\Backups\its-balance
ITS_BACKUP_RETENTION=30
ATOL_PROFILE_DIR=.atol-browser-profile
```

Для Linux укажите путь резервных копий в его формате, например
`/var/backups/its-balance`.

Запуск production-версии:

```bash
npm start
```

Команда запускает и веб-приложение, и локальный помощник АТОЛ. Если любой из
двух процессов завершается, общий процесс тоже завершается, чтобы системная
служба могла корректно перезапустить весь комплект.

## Перенос рабочих данных

Перед копированием остановите приложение на старом сервере и выполните:

```bash
npm run backup
```

Затем скопируйте `server-data/runtime-state.json` на новый сервер по тому же
пути либо задайте его расположение через `ITS_STATE_PATH`.

После запуска проверьте:

1. открывается главная страница;
2. отображается время последней синхронизации;
3. сохранено распределение инженеров;
4. администраторский пароль открывает редактирование;
5. «Обновить данные» завершается успешно;
6. после перезапуска сервера данные остаются на месте.

## Windows Server

Откройте PowerShell от имени администратора и запустите:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\deploy\windows\install-tasks.ps1
```

Скрипт создаёт две задачи от имени `SYSTEM`:

- запуск приложения при старте Windows с автоматическим перезапуском;
- ежедневное резервное копирование в 02:00.

Если проект находится в другой папке:

```powershell
.\deploy\windows\install-tasks.ps1 -ProjectPath "D:\Apps\its-analityc"
```

Для удаления задач:

```powershell
.\deploy\windows\uninstall-tasks.ps1
```

После установки проверьте журнал Планировщика заданий и доступ к
`http://адрес-сервера:3000`.

## Linux с systemd

Создайте отдельного системного пользователя `its-balance`, разместите проект в
`/opt/its-analityc` и выдайте ему права записи на:

- `server-data`;
- `server-backups`;
- `.atol-browser-profile`.

Скопируйте файлы из `deploy/systemd`, убрав суффикс `.example`, в
`/etc/systemd/system`. Если проект или Node.js находятся по другим путям,
измените `WorkingDirectory` и `ExecStart`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now its-balance.service
sudo systemctl enable --now its-balance-backup.timer
sudo systemctl status its-balance.service
```

Не запускайте Chrome от пользователя `root`. Служба должна работать от
выделенного непривилегированного пользователя.

## Сеть и HTTPS

Для прямого доступа откройте входящий TCP-порт `3000` только для локальной
сети. Порт помощника `4317` открывать не нужно: он слушает только
`127.0.0.1`.

Рекомендуемый вариант — закрыть порт `3000` извне сервера и поставить перед
приложением Caddy, Nginx или IIS с HTTPS. Пример для Caddy находится в
`deploy/Caddyfile.example`. При HTTPS администраторская cookie автоматически
получает атрибут `Secure`.

## Обновление версии

Перед обновлением:

```bash
npm run backup
```

Затем остановите службу, обновите код и выполните:

```bash
npm ci
npm run build
npm run deploy:check
```

После запуска проверьте `/api/atol/health` и проведите одну ручную
синхронизацию.

Не удаляйте `.env.local`, `server-data`, папку резервных копий и
`.atol-browser-profile` при обновлении.
