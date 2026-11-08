-- Parsed sensor data only: no raw FIT files, GPS, routes, filenames or device IDs.
CREATE TABLE IF NOT EXISTS training_sessions (
    entry_date DATE NOT NULL PRIMARY KEY,
    data LONGTEXT NOT NULL,
    FOREIGN KEY (entry_date) REFERENCES diary_entries(entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS training_history (
    entry_date DATE NOT NULL,
    revision INT UNSIGNED NOT NULL,
    data LONGTEXT NULL,
    PRIMARY KEY (entry_date, revision),
    FOREIGN KEY (entry_date, revision) REFERENCES entry_history(entry_date, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO schema_migrations (version) VALUES ('002_fit_training');
