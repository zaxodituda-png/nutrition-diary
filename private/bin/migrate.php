<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/bootstrap.php';
try {
    $pdo = db();
    // Serialize concurrent CLI runs; DDL on MySQL commits implicitly.
    if ((int) $pdo->query("SELECT GET_LOCK('nutrition_diary_schema', 30)")->fetchColumn() !== 1) throw new RuntimeException('Migration lock unavailable');
    try {
        foreach (glob(dirname(__DIR__) . '/migrations/*.sql') as $file) {
            $version = pathinfo($file, PATHINFO_FILENAME);
            $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) NOT NULL PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
            $check = $pdo->prepare('SELECT version FROM schema_migrations WHERE version = ?');
            $check->execute([$version]);
            if ($check->fetch()) { echo basename($file) . " already applied\n"; continue; }
            $sql = file_get_contents($file);
            // Migrations contain simple statements, no procedures or semicolons inside literals.
            foreach (preg_split('/;\s*(?:\r?\n|$)/', $sql) as $statement) {
                if (trim($statement) !== '') $pdo->exec($statement);
            }
            $record = $pdo->prepare('INSERT IGNORE INTO schema_migrations (version) VALUES (?)');
            $record->execute([$version]);
            echo basename($file) . " applied (idempotent)\n";
        }
    } finally { $pdo->query("SELECT RELEASE_LOCK('nutrition_diary_schema')"); }
} catch (Throwable $e) {
    fwrite(STDERR, 'Migration failed: ' . get_class($e) . '. Check private configuration and database permissions.' . PHP_EOL);
    exit(1);
}
