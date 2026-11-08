<?php
// Read-only fixture inspection for restore.py; never upload tests/ to the web root.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/private/bootstrap.php';
if (!str_ends_with(config()['db']['name'], '_test')) { fwrite(STDERR, "Disposable *_test database required.\n"); exit(1); }
$date = $argv[1] ?? '';
if (!validDate($date) || !str_starts_with($date, '2030-01-')) exit(1);
$stmt = db()->prepare('SELECT * FROM diary_entries WHERE entry_date = ?');
$stmt->execute([$date]);
$row = $stmt->fetch();
$stmt = db()->prepare('SELECT revision, payload, published, action, admin_id FROM entry_history WHERE entry_date = ? ORDER BY revision');
$stmt->execute([$date]);
echo json_encode(['row' => $row, 'history' => $stmt->fetchAll()], JSON_THROW_ON_ERROR);
