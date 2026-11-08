<?php
declare(strict_types=1);
const MAX_BODY = 10485760;
const DIARY_START_DATE = '2026-11-07';

function requireDiaryDate(string $date): void {
    if ($date < DIARY_START_DATE) fail('Записи доступны с 7 ноября 2026 года. Более ранние данные сохранены без изменений.', 422);
}

function config(): array {
    static $config;
    if ($config !== null) return $config;
    $path = __DIR__ . '/config.php';
    if (!is_file($path)) throw new RuntimeException('Configuration missing');
    $config = require $path;
    if (!is_array($config)) throw new RuntimeException('Invalid configuration');
    $url = parse_url($config['site_url'] ?? '');
    if (!$url || !isset($url['host']) || isset($url['query']) || isset($url['fragment']) || isset($url['user']) || isset($url['pass'])) {
        throw new RuntimeException('Invalid site_url');
    }
    $local = in_array($url['host'], ['localhost', '127.0.0.1', '[::1]'], true);
    if (($url['scheme'] ?? '') !== 'https' && !(($config['allow_http_localhost'] ?? false) === true && $local && ($url['scheme'] ?? '') === 'http')) {
        throw new RuntimeException('HTTPS required');
    }
    return $config;
}
function db(): PDO {
    static $pdo;
    if ($pdo) return $pdo;
    $db = config()['db'];
    // DSN components are configuration, never request parameters.
    foreach (['host', 'name'] as $key) {
        if (!is_string($db[$key] ?? null) || !preg_match('/^[a-zA-Z0-9_.-]+$/D', $db[$key])) throw new RuntimeException('Invalid DB configuration');
    }
    $port = filter_var($db['port'] ?? 3306, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 65535]]);
    if (!$port) throw new RuntimeException('Invalid DB port');
    $pdo = new PDO("mysql:host={$db['host']};port=$port;dbname={$db['name']};charset=utf8mb4", $db['user'], $db['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}
function respond(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}
function fail(string $message, int $status): never { respond(['error' => $message], $status); }
function startWebSession(): void {
    $cfg = config();
    $url = parse_url($cfg['site_url']);
    $secure = $url['scheme'] === 'https';
    // Do not trust client-supplied forwarded headers. TLS termination must be configured in PHP by the host.
    if ($secure && (!isset($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off' || $_SERVER['HTTPS'] === '')) {
        fail('Для работы требуется HTTPS.', 400);
    }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.gc_maxlifetime', '28800');
    session_name('nutrition_admin');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => rtrim($url['path'] ?? '', '/') . '/',
        'secure' => $secure, 'httponly' => true, 'samesite' => 'Strict',
    ]);
    if (!session_start()) throw new RuntimeException('Session storage unavailable');
    if (isset($_SESSION['admin_id']) && (time() - ($_SESSION['last_seen'] ?? 0) > 1800 || time() - ($_SESSION['signed_in'] ?? 0) > 28800)) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    if (isset($_SESSION['admin_id'])) $_SESSION['last_seen'] = time();
}
function adminId(): ?int {
    if (!isset($_SESSION['admin_id'])) return null;
    $stmt = db()->prepare('SELECT id, password_hash FROM admins WHERE id = ?');
    $stmt->execute([$_SESSION['admin_id']]);
    $admin = $stmt->fetch();
    if (!$admin || !hash_equals(hash('sha256', $admin['password_hash']), $_SESSION['auth_version'] ?? '')) { unset($_SESSION['admin_id']); return null; }
    return (int) $_SESSION['admin_id'];
}
function requireAdmin(): int {
    $id = adminId();
    if (!$id) fail('Войдите как администратор.', 401);
    return $id;
}
function mutationGuard(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('Метод не разрешён.', 405);
    $url = parse_url(config()['site_url']);
    $expected = $url['scheme'] . '://' . $url['host'] . (isset($url['port']) ? ':' . $url['port'] : '');
    if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $expected) fail('Недопустимый источник запроса.', 403);
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') fail('Требуется JSON.', 415);
    if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) fail('Проверка безопасности не пройдена. Обновите страницу.', 403);
}
function body(): array {
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_BODY) fail('Файл слишком большой (до 10 МБ).', 413);
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if ($raw === false || strlen($raw) > MAX_BODY) fail('Файл слишком большой (до 10 МБ).', 413);
    try { $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); }
    catch (JsonException) { fail('Некорректный JSON.', 422); }
    if (!is_array($data) || array_is_list($data)) fail('Ожидается JSON-объект.', 422);
    return $data;
}
function validDate(mixed $date): bool {
    if (!is_string($date) || !preg_match('/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/D', $date)) return false;
    [$y, $m, $d] = array_map('intval', explode('-', $date));
    return checkdate($m, $d, $y);
}
function validateEntry(mixed $entry): array {
    if (!is_array($entry) || array_is_list($entry)) throw new InvalidArgumentException('Запись должна быть объектом.');
    $entry += ['weight' => '', 'sleep' => '', 'base' => 0, 'exercise' => 0, 'meals' => [], 'note' => ''];
    foreach (['weight' => 128, 'sleep' => 256, 'note' => 10000, 'garmin' => 10000, 'strava' => 10000] as $field => $limit) {
        if (isset($entry[$field]) && (!is_string($entry[$field]) || strlen($entry[$field]) > $limit)) throw new InvalidArgumentException("Некорректное поле: $field.");
    }
    foreach (['base', 'exercise'] as $field) {
        if (!is_numeric($entry[$field]) || !is_finite((float) $entry[$field]) || $entry[$field] < 0 || $entry[$field] > 10000000) throw new InvalidArgumentException('Некорректное количество калорий.');
    }
    if (!is_array($entry['meals']) || !array_is_list($entry['meals']) || count($entry['meals']) > 500) throw new InvalidArgumentException('Некорректный список продуктов.');
    foreach ($entry['meals'] as $meal) {
        if (!is_array($meal)) throw new InvalidArgumentException('Некорректный продукт.');
        foreach (['group', 'name'] as $field) {
            if (!isset($meal[$field]) || !is_string($meal[$field]) || strlen($meal[$field]) > 2000) throw new InvalidArgumentException('Некорректное название продукта.');
        }
        if (!isset($meal['kcal']) || !is_numeric($meal['kcal']) || !is_finite((float) $meal['kcal']) || $meal['kcal'] < 0 || $meal['kcal'] > 10000000) throw new InvalidArgumentException('Некорректная калорийность продукта.');
    }
    if (strlen(json_encode($entry, JSON_THROW_ON_ERROR)) > 131072) throw new InvalidArgumentException('Запись слишком большая.');
    return $entry;
}
function encodeEntry(array $entry): string { return json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function archiveEntry(PDO $pdo, array $row, string $action, int $admin): void {
    $stmt = $pdo->prepare('INSERT INTO entry_history (entry_date, revision, payload, published, action, admin_id) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([$row['entry_date'], $row['revision'], $row['payload'], $row['published'], $action, $admin]);
}
function throttle(): void {
    // Ignore X-Forwarded-For: a visitor must not choose their rate-limit bucket.
    $bucket = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $pdo = db();
    $pdo->beginTransaction();
    $stmt = $pdo->prepare('INSERT IGNORE INTO auth_limits (bucket, attempts, window_started) VALUES (?, 0, ?)');
    $stmt->execute([$bucket, time()]);
    $stmt = $pdo->prepare('SELECT attempts, window_started FROM auth_limits WHERE bucket = ? FOR UPDATE');
    $stmt->execute([$bucket]);
    $row = $stmt->fetch();
    $fresh = time() - (int) $row['window_started'] >= 900;
    if (!$fresh && (int) $row['attempts'] >= 10) {
        $pdo->commit();
        header('Retry-After: ' . max(1, 900 - (time() - (int) $row['window_started'])));
        fail('Слишком много попыток. Повторите позже.', 429);
    }
    $stmt = $pdo->prepare('UPDATE auth_limits SET attempts = ?, window_started = ? WHERE bucket = ?');
    $stmt->execute([$fresh ? 1 : (int) $row['attempts'] + 1, $fresh ? time() : $row['window_started'], $bucket]);
    $pdo->commit();
}
function credentials(array $data): array {
    $user = $data['username'] ?? '';
    $password = $data['password'] ?? '';
    if (!is_string($user) || !preg_match('/^[a-zA-Z0-9_.-]{3,64}$/D', $user) || !is_string($password) || strlen($password) < 12 || strlen($password) > 72 || str_contains($password, "\0")) {
        fail('Логин: 3–64 латинских символа, цифры, _, . или -. Пароль: 12–72 байта.', 422);
    }
    return [$user, $password];
}
