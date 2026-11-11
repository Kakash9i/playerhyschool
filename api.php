<?php
/**
 * HYSCHOOL PLAYER CLOUD BACKEND - API
 * Multi-Device Management & HWID Licensing
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Admin-Password');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// -------------------------------------------------------------
// ADMIN PASSWORT SCHUTZ
// -------------------------------------------------------------
define('ADMIN_PASSWORD', '123123'); // Admin-Passwort auf 123123 gesetzt

$dbFile = __DIR__ . '/users.json';
if (!file_exists($dbFile)) {
    file_put_contents($dbFile, json_encode([], JSON_PRETTY_PRINT));
}

function getUsers() {
    global $dbFile;
    $raw = @file_get_contents($dbFile);
    $arr = json_decode($raw, true);
    if (!is_array($arr)) return [];
    
    // Normalisiere ältere Einträge auf Multi-HWID Format
    foreach ($arr as &$u) {
        if (!isset($u['hwids']) || !is_array($u['hwids'])) {
            $u['hwids'] = !empty($u['hwid']) ? [$u['hwid']] : [];
        }
        if (!isset($u['max_devices'])) {
            $u['max_devices'] = 1;
        }
    }
    return $arr;
}

function saveUsers($users) {
    global $dbFile;
    return file_put_contents($dbFile, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
}

function verifyAdminAuth() {
    $headers = getallheaders();
    $provided = '';
    if (isset($headers['X-Admin-Password'])) {
        $provided = $headers['X-Admin-Password'];
    } elseif (isset($headers['x-admin-password'])) {
        $provided = $headers['x-admin-password'];
    } elseif (isset($_POST['admin_password'])) {
        $provided = $_POST['admin_password'];
    } elseif (isset($_GET['admin_password'])) {
        $provided = $_GET['admin_password'];
    }
    
    if ($provided !== ADMIN_PASSWORD) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Ungültiges Admin-Passwort']);
        exit();
    }
}

$action = isset($_GET['action']) ? $_GET['action'] : '';

// 0. ADMIN LOGIN TEST
if ($action === 'verify_admin') {
    verifyAdminAuth();
    echo json_encode(['success' => true, 'message' => 'Admin autorisiert']);
    exit();
}

// 1. GET ALL USERS (Admin only)
if ($action === 'get_users') {
    verifyAdminAuth();
    echo json_encode(getUsers());
    exit();
}

// 2. CHECK / GET USER BY HWID (Öffentlich für Player-Start)
if ($action === 'check_user') {
    $hwid = isset($_GET['hwid']) ? trim($_GET['hwid']) : '';
    if (empty($hwid)) {
        echo json_encode(['success' => false, 'error' => 'Keine HWID übergeben']);
        exit();
    }
    
    $users = getUsers();
    foreach ($users as $u) {
        $hwidList = isset($u['hwids']) && is_array($u['hwids']) ? $u['hwids'] : [];
        if (!empty($u['hwid'])) $hwidList[] = $u['hwid'];
        
        $match = false;
        foreach ($hwidList as $h) {
            if (strtolower(trim($h)) === strtolower($hwid)) {
                $match = true;
                break;
            }
        }
        
        if ($match) {
            if (!empty($u['active'])) {
                echo json_encode([
                    'success' => true,
                    'registered' => true,
                    'active' => true,
                    'xtream_url' => isset($u['xtream_url']) ? $u['xtream_url'] : '',
                    'xtream_user' => isset($u['xtream_user']) ? $u['xtream_user'] : '',
                    'xtream_pass' => isset($u['xtream_pass']) ? $u['xtream_pass'] : '',
                    'username' => isset($u['username']) ? $u['username'] : '',
                    'email' => isset($u['email']) ? $u['email'] : '',
                    'max_devices' => isset($u['max_devices']) ? (int)$u['max_devices'] : 1,
                    'devices_count' => count($hwidList)
                ]);
            } else {
                echo json_encode([
                    'success' => false,
                    'registered' => true,
                    'active' => false,
                    'error' => 'Account ist gesperrt oder wartet auf Freischaltung',
                    'username' => isset($u['username']) ? $u['username'] : ''
                ]);
            }
            exit();
        }
    }
    
    echo json_encode(['success' => false, 'registered' => false, 'error' => 'Gerät nicht registriert']);
    exit();
}

// 3. REGISTER NEW USER (Vom Player aus)
if ($action === 'register') {
    $raw = file_get_contents('php://input');
    $payload = json_decode($raw, true);
    
    $hwid = isset($payload['hwid']) ? trim($payload['hwid']) : '';
    $username = isset($payload['username']) ? trim($payload['username']) : '';
    $email = isset($payload['email']) ? trim($payload['email']) : '';
    $password = isset($payload['password']) ? trim($payload['password']) : '';
    
    if (empty($hwid) || empty($username)) {
        echo json_encode(['success' => false, 'error' => 'Benutzername und HWID erforderlich']);
        exit();
    }
    
    $users = getUsers();
    
    // Prüfe ob Email / Benutzername schon existiert
    foreach ($users as $u) {
        if (!empty($email) && isset($u['email']) && strtolower($u['email']) === strtolower($email)) {
            echo json_encode(['success' => false, 'error' => 'Diese E-Mail ist bereits registriert! Bitte "Anmelden" wählen.']);
            exit();
        }
    }
    
    $newUser = [
        'id' => uniqid('usr_'),
        'username' => $username,
        'email' => $email,
        'password' => $password,
        'hwid' => $hwid,
        'hwids' => [$hwid],
        'max_devices' => 1,
        'active' => true,
        'created_at' => date('Y-m-d H:i:s'),
        'xtream_url' => '',
        'xtream_user' => '',
        'xtream_pass' => '',
        'notes' => 'Neu registriert über Player'
    ];
    
    $users[] = $newUser;
    saveUsers($users);
    
    echo json_encode(['success' => true, 'message' => 'Erfolgreich registriert!', 'user' => $newUser]);
    exit();
}

// 4. LOGIN / BIND DEVICE TO EXISTING ACCOUNT (Multi-Device Login)
if ($action === 'login_device') {
    $raw = file_get_contents('php://input');
    $payload = json_decode($raw, true);
    
    $identity = isset($payload['identity']) ? trim($payload['identity']) : '';
    $password = isset($payload['password']) ? trim($payload['password']) : '';
    $hwid = isset($payload['hwid']) ? trim($payload['hwid']) : '';
    
    if (empty($identity) || empty($hwid)) {
        echo json_encode(['success' => false, 'error' => 'Benutzername/E-Mail und HWID erforderlich']);
        exit();
    }
    
    $users = getUsers();
    $targetUser = null;
    $targetIndex = -1;
    
    foreach ($users as $idx => $u) {
        $nameMatch = isset($u['username']) && strtolower($u['username']) === strtolower($identity);
        $emailMatch = isset($u['email']) && strtolower($u['email']) === strtolower($identity);
        if ($nameMatch || $emailMatch) {
            $targetUser = $u;
            $targetIndex = $idx;
            break;
        }
    }
    
    if (!$targetUser) {
        echo json_encode(['success' => false, 'error' => 'Kein Account mit diesem Namen/E-Mail gefunden']);
        exit();
    }
    
    // Passwort prüfen (falls eins vergeben wurde)
    if (!empty($targetUser['password']) && $targetUser['password'] !== $password) {
        echo json_encode(['success' => false, 'error' => 'Falsches Kunden-Passwort']);
        exit();
    }
    
    $hwids = isset($targetUser['hwids']) && is_array($targetUser['hwids']) ? $targetUser['hwids'] : [];
    $maxDevices = isset($targetUser['max_devices']) ? (int)$targetUser['max_devices'] : 1;
    
    // Prüfe ob HWID bereits enthalten ist
    $alreadyBound = false;
    foreach ($hwids as $h) {
        if (strtolower(trim($h)) === strtolower($hwid)) {
            $alreadyBound = true;
            break;
        }
    }
    
    if (!$alreadyBound) {
        if (count($hwids) >= $maxDevices) {
            echo json_encode([
                'success' => false,
                'error' => "Geräte-Limit erreicht! Für diesen Account sind maximal {$maxDevices} Gerät(e) freigeschaltet."
            ]);
            exit();
        }
        $hwids[] = $hwid;
        $users[$targetIndex]['hwids'] = $hwids;
        $users[$targetIndex]['hwid'] = $hwid; // Aktuellstes Gerät
        saveUsers($users);
    }
    
    echo json_encode([
        'success' => true,
        'message' => 'Gerät erfolgreich mit Account verknüpft!',
        'user' => [
            'username' => $targetUser['username'],
            'email' => $targetUser['email'],
            'active' => $targetUser['active'],
            'xtream_url' => $targetUser['xtream_url'],
            'xtream_user' => $targetUser['xtream_user'],
            'xtream_pass' => $targetUser['xtream_pass'],
            'max_devices' => $maxDevices,
            'devices_count' => count($hwids)
        ]
    ]);
    exit();
}

// 5. UPDATE USER XTREAM & MULTI-DEVICE (Admin only)
if ($action === 'update_user') {
    verifyAdminAuth();
    $raw = file_get_contents('php://input');
    $payload = json_decode($raw, true);
    
    $id = isset($payload['id']) ? trim($payload['id']) : '';
    if (empty($id)) {
        echo json_encode(['success' => false, 'error' => 'User ID fehlt']);
        exit();
    }
    
    $users = getUsers();
    $found = false;
    
    foreach ($users as &$u) {
        if (isset($u['id']) && $u['id'] === $id) {
            if (isset($payload['username'])) $u['username'] = trim($payload['username']);
            if (isset($payload['email'])) $u['email'] = trim($payload['email']);
            if (isset($payload['password'])) $u['password'] = trim($payload['password']);
            if (isset($payload['active'])) $u['active'] = (bool)$payload['active'];
            if (isset($payload['max_devices'])) $u['max_devices'] = max(1, (int)$payload['max_devices']);
            if (isset($payload['xtream_url'])) $u['xtream_url'] = trim($payload['xtream_url']);
            if (isset($payload['xtream_user'])) $u['xtream_user'] = trim($payload['xtream_user']);
            if (isset($payload['xtream_pass'])) $u['xtream_pass'] = trim($payload['xtream_pass']);
            if (isset($payload['notes'])) $u['notes'] = trim($payload['notes']);
            
            // HWIDs zurücksetzen falls angefordert
            if (!empty($payload['reset_hwids'])) {
                $u['hwids'] = [];
                $u['hwid'] = '';
            }
            
            $found = true;
            break;
        }
    }
    
    if ($found) {
        saveUsers($users);
        echo json_encode(['success' => true, 'message' => 'Kunde erfolgreich aktualisiert']);
    } else {
        echo json_encode(['success' => false, 'error' => 'Kunde nicht gefunden']);
    }
    exit();
}

// 6. DELETE USER (Admin only)
if ($action === 'delete_user') {
    verifyAdminAuth();
    $raw = file_get_contents('php://input');
    $payload = json_decode($raw, true);
    
    $id = isset($payload['id']) ? trim($payload['id']) : '';
    if (empty($id)) {
        echo json_encode(['success' => false, 'error' => 'User ID fehlt']);
        exit();
    }
    
    $users = getUsers();
    $filtered = array_values(array_filter($users, function($u) use ($id) {
        return !isset($u['id']) || $u['id'] !== $id;
    }));
    
    saveUsers($filtered);
    echo json_encode(['success' => true, 'message' => 'Kunde gelöscht']);
    exit();
}

echo json_encode(['success' => false, 'error' => 'Ungültige Aktion']);
exit();
