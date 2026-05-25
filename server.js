import WebSocket, { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

// Хранилище активных комнат
const rooms = {};

wss.on('connection', (ws) => {
    let currentRoom = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        // 1. ЛОГИКА ПОДКЛЮЧЕНИЯ К КОМНАТЕ
        if (data.type === 'join') {
            currentRoom = data.room;
            ws.userId = data.userId; // Привязываем userId к сокету для идентификации в играх
            
            if (!rooms[currentRoom]) {
                rooms[currentRoom] = {
                    users: [],
                    capsules: [],
                    moods: {},
                    // Игровое состояние для «Поймай искру»
                    sparkStatus: null, 
                    sparkTimer: null,  
                    missTimer: null,
                    // Игровое состояние для «Крестиков-Ноликов»
                    tttBoard: Array(9).fill(null),
                    tttPlayers: {}, // Хранилище ролей вида { userId: 'X' }
                    // 🔦 Игровое состояние для «Лабиринта»
                    mazeState: null
                };
            }
            
            if (!rooms[currentRoom].users.includes(ws)) {
                rooms[currentRoom].users.push(ws);
            }

            broadcast(currentRoom, {
                type: 'system_status',
                text: `Пользователей в комнате: ${rooms[currentRoom].users.length}`
            });

            // При входе отправляем юзеру все капсулы комнаты
            rooms[currentRoom].capsules.forEach(capsule => {
                ws.send(JSON.stringify({ type: 'create_capsule', capsule }));
            });

            // Отправляем текущие статусы настроений в комнате
            ws.send(JSON.stringify({
                type: 'mood_sync',
                moods: rooms[currentRoom].moods
            }));
        }

        // 2. ОБРАБОТКА СТАТУСА НАСТРОЕНИЯ
        else if (data.type === 'sync_mood_status') {
            if (currentRoom && rooms[currentRoom]) {
                rooms[currentRoom].moods[data.userId] = data.status;
                broadcast(currentRoom, data, ws);
            }
        }

        // 3. СОЗДАНИЕ КАПСУЛЫ
        else if (data.type === 'create_capsule') {
            if (currentRoom && rooms[currentRoom]) {
                rooms[currentRoom].capsules.push(data.capsule);
                broadcast(currentRoom, data, ws); 
            }
        }

        // 4. ЧТЕНИЕ/УДАЛЕНИЕ КАПСУЛЫ
        else if (data.type === 'capsule_read') {
            if (currentRoom && rooms[currentRoom]) {
                rooms[currentRoom].capsules = rooms[currentRoom].capsules.filter(c => 
                    !(c.x === data.x && c.y === data.y)
                );
                broadcast(currentRoom, data, ws);
            }
        }

        // 5. МИНИ-ИГРА: СПАВН ИСКРЫ
        else if (data.type === 'game_spawn_spark') {
            if (currentRoom && rooms[currentRoom]) {
                const room = rooms[currentRoom];

                clearTimeout(room.sparkTimer);
                clearTimeout(room.missTimer);
                room.sparkStatus = null;

                broadcast(currentRoom, { type: 'game_spawn_spark', x: data.x, y: data.y });

                room.missTimer = setTimeout(() => {
                    if (rooms[currentRoom]) {
                        rooms[currentRoom].sparkStatus = null;
                        broadcast(currentRoom, { type: 'game_spark_miss' });
                    }
                }, 4000);
            }
        }

        // 6. МИНИ-ИГРА: НАЖАТИЕ НА ИСКРУ
        else if (data.type === 'game_click_spark') {
            if (currentRoom && rooms[currentRoom]) {
                const room = rooms[currentRoom];

                if (!room.sparkStatus) {
                    room.sparkStatus = 'half';
                    clearTimeout(room.missTimer);
                    broadcast(currentRoom, { type: 'game_spark_half' });

                    room.sparkTimer = setTimeout(() => {
                        if (rooms[currentRoom]) {
                            rooms[currentRoom].sparkStatus = null;
                            broadcast(currentRoom, { type: 'game_spark_miss' });
                        }
                    }, 600);

                } else if (room.sparkStatus === 'half') {
                    clearTimeout(room.sparkTimer);
                    room.sparkStatus = null;
                    broadcast(currentRoom, { type: 'game_spark_win' });
                }
            }
        }

        // 7. КРЕСТИКИ-НОЛИКИ: ИНИЦИАЛИЗАЦИЯ И СБРОС ИГРЫ
else if (data.type === 'ttt_init') {
    if (currentRoom && rooms[currentRoom]) {
        const room = rooms[currentRoom];
        
        // 1. Сохраняем слепок старых ролей перед очисткой
        const oldPlayersState = room.tttPlayers ? { ...room.tttPlayers } : null;

        // 2. Очищаем доску
        room.tttBoard = Array(9).fill(null);
        room.tttPlayers = {};

        const user0 = room.users[0]?.userId;
        const user1 = room.users[1]?.userId;

        if (user0 && user1) {
            // 3. 🔄 ИНВЕРСИЯ РОЛЕЙ: Если игра уже была, меняем их местами
            if (oldPlayersState && oldPlayersState[user0]) {
                room.tttPlayers[user0] = oldPlayersState[user0] === 'X' ? 'O' : 'X';
                room.tttPlayers[user1] = oldPlayersState[user1] === 'X' ? 'O' : 'X';
            } else {
                // Если это самый первый раунд в комнате — распределяем по дефолту
                room.tttPlayers[user0] = 'X';
                room.tttPlayers[user1] = 'O';
            }
        }

        // 4. Рассылаем пакеты обновленной игры
        room.users.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                const playerRole = room.tttPlayers[client.userId] || 'O';
                client.send(JSON.stringify({
                    type: 'ttt_start',
                    board: room.tttBoard,
                    role: playerRole,
                    isMyTurn: playerRole === 'X' // Крестик всегда ходит первым!
                }));
            }
        });
    }
}

        // 8. КРЕСТИКИ-НОЛИКИ: ОБРАБОТКА ХОДА
        else if (data.type === 'ttt_move') {
            if (currentRoom && rooms[currentRoom]) {
                const room = rooms[currentRoom];
                const cellIndex = data.index;
                const playerRole = room.tttPlayers[ws.userId];

                if (playerRole && room.tttBoard[cellIndex] === null) {
                    room.tttBoard[cellIndex] = playerRole;

                    const winner = checkTTTWinner(room.tttBoard);
                    const isDraw = !room.tttBoard.includes(null) && !winner;

                    room.users.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            const clientRole = room.tttPlayers[client.userId];
                            const nextTurnRole = playerRole === 'X' ? 'O' : 'X';
                            const isMyTurn = clientRole === nextTurnRole && !winner && !isDraw;

                            client.send(JSON.stringify({
                                type: 'ttt_update',
                                board: room.tttBoard,
                                isMyTurn: isMyTurn,
                                winner: winner,
                                isDraw: isDraw
                            }));
                        }
                    });
                }
            }
        }

        // 🔦 9. ЛАБИРИНТ: ИНИЦИАЛИЗАЦИЯ И СБРОС ИГРЫ
        else if (data.type === 'maze_start_request') {
            if (currentRoom && rooms[currentRoom]) {
                const room = rooms[currentRoom];
                if (room.users.length < 2) return; // Нужна пара для игры

                // Генерируем честный лабиринт (9x13)
                const mazeMap = generateServerMaze(9, 13);
                
                room.mazeState = {
                    map: mazeMap,
                    wallSize: 40,
                    startX: 60, startY: 60,
                    finX: 260, finY: 420,
                    playerX: 60, playerY: 60
                };

                // Рандомим роли
                const isFirstLight = Math.random() < 0.5;

                room.users[0].send(JSON.stringify({
                    type: 'maze_start',
                    role: isFirstLight ? 'light' : 'driver',
                    map: mazeMap,
                    startX: room.mazeState.startX, startY: room.mazeState.startY,
                    finX: room.mazeState.finX, finY: room.mazeState.finY
                }));

                if (room.users[1]) {
                    room.users[1].send(JSON.stringify({
                        type: 'maze_start',
                        role: isFirstLight ? 'driver' : 'light',
                        map: mazeMap,
                        startX: room.mazeState.startX, startY: room.mazeState.startY,
                        finX: room.mazeState.finX, finY: room.mazeState.finY
                    }));
                }
            }
        }

        // 🔦 10. ЛАБИРИНТ: СИНХРОНИЗАЦИЯ ДВИЖЕНИЙ И ФИЗИКА
        else if (data.type === 'maze_move') {
            if (currentRoom && rooms[currentRoom]) {
                const room = rooms[currentRoom];
                if (!room.mazeState) return;

                if (data.role === 'light') {
                    // Пересылаем координаты фонарика партнеру без валидации
                    broadcast(currentRoom, { type: 'maze_light_sync', x: data.x, y: data.y }, ws);
                } 
                else if (data.role === 'driver') {
                    // Валидация перемещения фишки на сервере
                    if (!checkServerCollision(data.x, data.y, room.mazeState)) {
                        room.mazeState.playerX = data.x;
                        room.mazeState.playerY = data.y;

                        // Если стена не задета, рассылаем новые координаты обоим юзерам
                        room.users.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'maze_player_sync', x: data.x, y: data.y }));
                            }
                        });

                        // Проверяем триггер триумфального финиша
                        let dist = Math.sqrt(Math.pow(data.x - room.mazeState.finX, 2) + Math.pow(data.y - room.mazeState.finY, 2));
                        if (dist < 25) {
                            room.mazeState = null; // Сбрасываем стейт игры
                            broadcast(currentRoom, { type: 'maze_win' });
                            // Шлем победу в том числе и инициатору, так как широковещатель его игнорирует
                            ws.send(JSON.stringify({ type: 'maze_win' }));
                        }
                    }
                }
            }
        }

        // 11. ВСЕ ОСТАЛЬНЫЕ СИНХРОННЫЕ ДЕЙСТВИЯ (клики, движения, рисование)
        else {
            if (currentRoom) {
                broadcast(currentRoom, data, ws);
            }
        }
    });

    ws.on('close', () => {
        if (currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            room.users = room.users.filter(u => u !== ws);
            
            broadcast(currentRoom, {
                type: 'system_status',
                text: `Пользователей в комнате: ${room.users.length}`
            });

            // Если комната опустела — очищаем память и таймеры
            if (room.users.length === 0 && room.capsules.length === 0) {
                clearTimeout(room.sparkTimer);
                clearTimeout(room.missTimer);
                delete rooms[currentRoom];
            }
        }
    });
});

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

// Алгоритм проверки победных комбинаций крестиков-ноликов
function checkTTTWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    for (let i = 0; i < lines.length; i++) {
        const [a, b, c] = lines[i];
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

// Генератор честных лабиринтов (глубокий DFS обход)
function generateServerMaze(cols, rows) {
    let maze = Array(rows).fill().map(() => Array(cols).fill(1));
    
    function carve(r, c) {
        maze[r][c] = 0;
        let dirs = [[-2,0], [2,0], [0,-2], [0,2]].sort(() => Math.random() - 0.5);
        
        for (let [dr, dc] of dirs) {
            let nr = r + dr, nc = c + dc;
            if (nr > 0 && nr < rows-1 && nc > 0 && nc < cols-1 && maze[nr][nc] === 1) {
                maze[r + dr/2][c + dc/2] = 0;
                carve(nr, nc);
            }
        }
    }
    carve(1, 1);
    
    // Чистим спавн-зоны по углам от возможных косяков генерации
    maze[1][1] = 0; maze[1][2] = 0; maze[2][1] = 0;
    maze[rows-2][cols-2] = 0;
    maze[rows-2][cols-3] = 0;
    return maze;
}

// Серверная валидация столкновения фишки водителя со стеной
function checkServerCollision(x, y, state) {
    let cellX = Math.floor(x / state.wallSize);
    let cellY = Math.floor(y / state.wallSize);
    if (state.map[cellY] && state.map[cellY][cellX] === 1) return true;
    return false;
}

function broadcast(roomName, data, senderWs = null) {
    if (!rooms[roomName]) return;
    rooms[roomName].users.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== senderWs) {
            client.send(JSON.stringify(data));
        }
    });
}
