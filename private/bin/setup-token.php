<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$token = bin2hex(random_bytes(32));
echo "One-time token (keep private; paste ONLY into your HTTPS setup page):\n$token\n\n";
echo "setup_token_hash (copy into private/config.php):\n" . hash('sha256', $token) . "\n";
