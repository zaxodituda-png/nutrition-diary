<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/bootstrap.php';
// Read from stdin, never a command-line argument, URL, or repository file.
$username = $argv[1] ?? '';
if (!preg_match('/^[a-zA-Z0-9_.-]{3,64}$/D', $username)) { fwrite(STDERR, "Usage: php reset-password.php USERNAME < protected-input\n"); exit(1); }
$password = rtrim(stream_get_contents(STDIN, 1024), "\r\n");
if (strlen($password) < 12 || strlen($password) > 72 || str_contains($password, "\0")) { fwrite(STDERR, "Password must be 12–72 bytes.\n"); exit(1); }
try {
    $stmt = db()->prepare('UPDATE admins SET password_hash = ? WHERE username = ?');
    $stmt->execute([password_hash($password, PASSWORD_DEFAULT), $username]);
    if (!$stmt->rowCount()) throw new RuntimeException('User not found');
    echo "Password updated. Previous administrator sessions are revoked on their next API request.\n";
} catch (Throwable) { fwrite(STDERR, "Password reset failed. Check username and private configuration.\n"); exit(1); }
