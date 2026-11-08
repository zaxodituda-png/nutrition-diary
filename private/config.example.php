<?php
declare(strict_types=1);
// Copy to config.php OUTSIDE the web root; fill in locally, never commit it.
return [
    'site_url' => 'https://diary.example.com', // Include /diary if installed in a subdirectory.
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => '',
        'user' => '',
        'password' => '',
    ],
    // SHA-256 of a random, one-time setup token. Empty disables browser setup.
    'setup_token_hash' => '',
    // Development only: allows HTTP exclusively on loopback. Keep false on hosting.
    'allow_http_localhost' => false,
];
