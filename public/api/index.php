<?php
declare(strict_types=1);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
require dirname(__DIR__, 2) . '/private/bootstrap.php';
try {
    startWebSession();
    $action = $_GET['action'] ?? 'entries';
    $method = $_SERVER['REQUEST_METHOD'];
    if (!is_string($action)) fail('Неизвестный запрос.', 404);
    $reads = ['session', 'entries', 'export'];
    $writes = ['login', 'logout', 'setup', 'save', 'delete', 'import'];
    if (!in_array($action, array_merge($reads, $writes), true)) fail('Неизвестный запрос.', 404);
    if (in_array($action, $reads, true) && $method !== 'GET') fail('Метод не разрешён.', 405);
    if (in_array($action, $writes, true)) mutationGuard();
    if ($action === 'session') respond(['admin' => adminId() !== null, 'csrf' => $_SESSION['csrf']]);
    if ($action === 'setup') {
        throttle();
        $data = body();
        $hash = config()['setup_token_hash'] ?? '';
        $token = $data['token'] ?? '';
        if (!is_string($hash) || !preg_match('/^[a-f0-9]{64}$/D', $hash) || !is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token) || !hash_equals($hash, hash('sha256', $token))) {
            fail('Первичная настройка недоступна или токен неверен.', 403);
        }
        [$username, $password] = credentials($data);
        $passwordHash = password_hash($password, PASSWORD_DEFAULT);
        $pdo = db();
        $pdo->beginTransaction();
        $state = $pdo->query('SELECT completed FROM setup_state WHERE id = 1 FOR UPDATE')->fetch();
        if (!$state || $state['completed'] || $pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn() > 0) {
            $pdo->rollBack();
            fail('Администратор уже создан. Повторная настройка запрещена.', 409);
        }
        $stmt = $pdo->prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)');
        $stmt->execute([$username, $passwordHash]);
        $pdo->exec('UPDATE setup_state SET completed = 1 WHERE id = 1');
        $pdo->commit();
        respond(['ok' => true], 201);
    }
    if ($action === 'login') {
        throttle();
        $data = body();
        [$username, $password] = credentials($data);
        $stmt = db()->prepare('SELECT id, password_hash FROM admins WHERE username = ?');
        $stmt->execute([$username]);
        $admin = $stmt->fetch();
        // Use a real, per-request dummy hash to avoid skipping password verification for unknown users.
        $hash = $admin ? $admin['password_hash'] : password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT);
        if (!password_verify($password, $hash) || !$admin) fail('Неверный логин или пароль.', 401);
        if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
            $stmt = db()->prepare('UPDATE admins SET password_hash = ? WHERE id = ?');
            $hash = password_hash($password, PASSWORD_DEFAULT);
            $stmt->execute([$hash, $admin['id']]);
        }
        session_regenerate_id(true);
        $_SESSION = ['admin_id' => (int) $admin['id'], 'auth_version' => hash('sha256', $hash), 'signed_in' => time(), 'last_seen' => time(), 'csrf' => bin2hex(random_bytes(32))];
        respond(['admin' => true, 'csrf' => $_SESSION['csrf']]);
    }
    if ($action === 'logout') {
        requireAdmin();
        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond(['admin' => false, 'csrf' => $_SESSION['csrf']]);
    }
    if ($action === 'entries' || $action === 'export') {
        $admin = $action === 'export' ? requireAdmin() : adminId();
        $stmt = db()->query('SELECT entry_date, payload, published, revision FROM diary_entries WHERE deleted_at IS NULL' . ($admin ? '' : ' AND published = 1') . ' ORDER BY entry_date');
        $entries = $revisions = $published = [];
        foreach ($stmt as $row) {
            $entry = json_decode($row['payload'], true, 64, JSON_THROW_ON_ERROR);
            if (!$admin) {
                // Public responses include only the diary's display fields, never arbitrary imported metadata.
                $entry = array_intersect_key($entry, array_flip(['weight', 'sleep', 'base', 'exercise', 'meals', 'note', 'garmin', 'strava']));
                $entry['meals'] = array_map(fn($meal) => array_intersect_key($meal, array_flip(['group', 'name', 'kcal'])), $entry['meals']);
            }
            $date = $row['entry_date'];
            $entries[$date] = $entry;
            if ($admin) { $revisions[$date] = (int) $row['revision']; $published[$date] = (bool) $row['published']; }
        }
        if ($action === 'export') {
            header('Content-Disposition: attachment; filename="nutrition-diary-export.json"');
            respond(['format' => 'nutrition-diary', 'version' => 1, 'exportedAt' => gmdate('c'), 'entries' => (object) $entries, 'published' => (object) $published]);
        }
        respond(['entries' => (object) $entries, 'revisions' => (object) $revisions, 'published' => (object) $published]);
    }
    $admin = requireAdmin(); // Every remaining route mutates diary data.
    $data = body();
    if ($action === 'import') {
        $import = $data['entries'] ?? null;
        if (!is_array($import) || (array_is_list($import) && count($import) !== 0) || count($import) > 5000) fail('Ожидается объект записей (до 5000 дат).', 422);
        $validated = [];
        foreach ($import as $date => $entry) {
            if (!validDate($date)) fail('Некорректная дата в файле.', 422);
            $validated[$date] = validateEntry($entry);
        }
        $pdo = db();
        $pdo->beginTransaction();
        $insert = $pdo->prepare('INSERT INTO diary_entries (entry_date, payload, published) VALUES (?, ?, 0)');
        $added = 0; $skipped = [];
        foreach ($validated as $date => $entry) {
            try { $insert->execute([$date, encodeEntry($entry)]); $added++; }
            catch (PDOException $e) {
                if ((int) ($e->errorInfo[1] ?? 0) !== 1062) throw $e;
                $skipped[] = $date; // Includes soft-deleted dates: never replace existing data.
            }
        }
        $pdo->commit();
        respond(['added' => $added, 'skipped' => $skipped, 'drafts' => true]);
    }
    $date = $data['date'] ?? '';
    if (!validDate($date)) fail('Некорректная дата.', 422);
    $expected = $data['revision'] ?? null;
    if ($expected !== null && (!is_int($expected) || $expected < 1)) fail('Некорректная версия записи.', 422);
    $entry = $action === 'save' ? validateEntry($data['entry'] ?? null) : null;
    if ($action === 'save' && !is_bool($data['published'] ?? null)) fail('Укажите статус публикации.', 422);
    $pdo = db();
    $pdo->beginTransaction();
    $stmt = $pdo->prepare('SELECT * FROM diary_entries WHERE entry_date = ? FOR UPDATE');
    $stmt->execute([$date]);
    $row = $stmt->fetch();
    if (($row && ($row['deleted_at'] !== null || $expected !== (int) $row['revision'])) || (!$row && $expected !== null)) {
        $pdo->rollBack();
        fail('Запись изменилась или была удалена. Обновите страницу; ваши несохранённые поля оставлены в редакторе.', 409);
    }
    if ($action === 'delete') {
        if (!$row) { $pdo->rollBack(); fail('Запись не найдена.', 404); }
        archiveEntry($pdo, $row, 'delete', $admin);
        $stmt = $pdo->prepare('UPDATE diary_entries SET deleted_at = UTC_TIMESTAMP(), published = 0, revision = revision + 1 WHERE entry_date = ?');
        $stmt->execute([$date]);
    } else {
        if ($row) {
            archiveEntry($pdo, $row, 'edit', $admin);
            // Retain legacy and unknown metadata omitted by an editor or older client.
            $entry = array_replace(json_decode($row['payload'], true, 64, JSON_THROW_ON_ERROR), $entry);
            $stmt = $pdo->prepare('UPDATE diary_entries SET payload = ?, published = ?, revision = revision + 1 WHERE entry_date = ?');
        } else {
            $stmt = $pdo->prepare('INSERT INTO diary_entries (payload, published, entry_date) VALUES (?, ?, ?)');
        }
        $stmt->execute([encodeEntry($entry), (int) $data['published'], $date]);
    }
    $pdo->commit();
    respond(['ok' => true]);
} catch (InvalidArgumentException $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    fail($e->getMessage(), 422);
} catch (Throwable $e) {
    if ($e instanceof PDOException && in_array((int) ($e->errorInfo[1] ?? 0), [1062, 1213, 1205], true)) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        fail('Конфликт изменений. Обновите данные и повторите попытку.', 409);
    }
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    // No request contents, database credentials, SQL or passwords in responses/logs.
    error_log('Nutrition diary API error: ' . get_class($e) . ' [' . $e->getCode() . ']');
    fail('Сервис временно недоступен. Проверьте настройки сервера.', 503);
}
