<?php
declare(strict_types=1);
function validateTraining(mixed $data): ?array {
    if ($data === null) return null;
    if (!is_array($data) || array_is_list($data) || array_diff(array_keys($data), ['format', 'version', 'startTime', 'summary', 'samples']) || ($data['format'] ?? '') !== 'diary-fit' || ($data['version'] ?? 0) !== 1) {
        throw new InvalidArgumentException('Некорректный формат данных тренировки.');
    }
    $start = $data['startTime'] ?? null;
    if ($start !== null && (!is_int($start) || $start < 0 || $start > 4102444800)) throw new InvalidArgumentException('Некорректное время тренировки.');
    $bounds = ['distanceKm' => 100000, 'elapsedSeconds' => 604800, 'avgSpeedKmh' => 500, 'maxSpeedKmh' => 500, 'avgHeartRate' => 300, 'maxHeartRate' => 300, 'avgPower' => 10000, 'maxPower' => 10000];
    $summary = $data['summary'] ?? null;
    if (!is_array($summary) || array_diff(array_keys($summary), array_keys($bounds)) || count($summary) !== count($bounds)) throw new InvalidArgumentException('Некорректные итоги тренировки.');
    $number = static function (mixed $value, float $max): bool { return $value === null || ((is_int($value) || is_float($value)) && is_finite((float) $value) && $value >= 0 && $value <= $max); };
    foreach ($bounds as $key => $max) {
        if (!array_key_exists($key, $summary) || !$number($summary[$key], $max)) throw new InvalidArgumentException('Некорректное значение показателя тренировки.');
    }
    $samples = $data['samples'] ?? null;
    if (!is_array($samples) || !array_is_list($samples) || count($samples) < 1 || count($samples) > 100000 || $summary['elapsedSeconds'] === null) throw new InvalidArgumentException('Ожидается от 1 до 100000 измерений.');
    $previous = -1;
    foreach ($samples as $sample) {
        if (!is_array($sample) || !array_is_list($sample) || count($sample) !== 5 || !$number($sample[0], 604800) || $sample[0] === null || $sample[0] <= $previous) throw new InvalidArgumentException('Временные метки измерений должны возрастать.');
        $previous = $sample[0];
        foreach ([1 => 500, 2 => 300, 3 => 10000, 4 => 500] as $index => $max) {
            if (!$number($sample[$index], $max)) throw new InvalidArgumentException('Некорректные данные датчика.');
        }
    }
    if ($previous > $summary['elapsedSeconds']) throw new InvalidArgumentException('Измерения выходят за пределы времени тренировки.');
    $normalized = ['format' => 'diary-fit', 'version' => 1, 'startTime' => $start, 'summary' => $summary, 'samples' => $samples];
    if (strlen(encodeEntry($normalized)) > 9000000) throw new InvalidArgumentException('Данные тренировки слишком большие.');
    return $normalized;
}
function storeTraining(PDO $pdo, string $date, ?array $data): void {
    if ($data === null) {
        $stmt = $pdo->prepare('DELETE FROM training_sessions WHERE entry_date = ?');
        $stmt->execute([$date]);
    } else {
        $stmt = $pdo->prepare('INSERT INTO training_sessions (entry_date, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)');
        $stmt->execute([$date, encodeEntry($data)]);
    }
}
function archiveTraining(PDO $pdo, string $date, int $revision): void {
    $stmt = $pdo->prepare('SELECT data FROM training_sessions WHERE entry_date = ? FOR UPDATE');
    $stmt->execute([$date]);
    $row = $stmt->fetch();
    $stmt = $pdo->prepare('INSERT INTO training_history (entry_date, revision, data) VALUES (?, ?, ?)');
    $stmt->execute([$date, $revision, $row ? $row['data'] : null]);
}
