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
            ws.userId = data.userId; // Привязываем userId к сокету для индентификации в играх
            
            if (!rooms[currentRoom]) {
                rooms[currentRoom] = {
                    users: [],
                    capsules: [],
                    moods: {},
                    // Игровое состояние для «Поймай искру»
                    sparkStatus: null, 
                    sparkTimer: null,  
                    missTimer: null,
                    // ✨ Игровое состояние для «Крестиков-Ноликов»
                    tttBoard: Array(9).fill(null),
                    tttPlayers: {} // Хранилище ролей вида { userId: 'X' }
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

        // ✨ 7. КРЕСТblockИКИ-НОЛИКИ: ИНИЦИАЛИЗАЦИЯ И СБРОС ИГРЫ
        else if (data.type === 'ttt_init') {
            if (currentRoom && rooms[currentRoom]) {
                const room = rooms[currentRoom];
                room.tttBoard = Array(9).fill(null);
                room.tttPlayers = {};

                // Распределяем роли между первыми двумя игроками в комнате
                if (room.users[0] && room.users[0].userId) {
                    room.tttPlayers[room.users[0].userId] = 'X';
                }
                if (room.users[1] && room.users[1].userId) {
                    room.tttPlayers[room.users[1].userId] = 'O';
                }

                // Крестики всегда начинают первыми
                room.users.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        const playerRole = room.tttPlayers[client.userId] || 'O';
                        client.send(JSON.stringify({
                            type: 'ttt_start',
                            board: room.tttBoard,
                            role: playerRole,
                            isMyTurn: playerRole === 'X'
                        }));
                    }
                });
            }
        }

        // ✨ 8. КРЕСТИКИ-НОЛИКИ: ОБРАБОТКА ХОДА
        else if (data.type === 'ttt_move') {
            if (currentRoom && rooms[currentRoom]) {
                const room = rooms[currentRoom];
                const cellIndex = data.index;
                const playerRole = room.tttPlayers[ws.userId];

                // Валидация: ячейка пуста и у игрока есть назначенная роль
                if (playerRole && room.tttBoard[cellIndex] === null) {
                    room.tttBoard[cellIndex] = playerRole;

                    const winner = checkTTTWinner(room.tttBoard);
                    const isDraw = !room.tttBoard.includes(null) && !winner;

                    // Рассылаем обновление состояния каждому клиенту индивидуально
                    room.users.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            const clientRole = room.tttPlayers[client.userId];
                            
                            // Ход переходит к сопернику, если игра продолжается
                            const nextTurnRole = playerRole === 'X' ? 'O' : 'X';
                            const isMyTurn = clientRole === nextTurnRole && !winner && !isDraw;

                            client.send(JSON.stringify({
                                type: 'ttt_update',
                                board: room.tttBoard,
                                isMyTurn: isMyTurn,
                                winner: winner, // 'X', 'O' или null
                                isDraw: isDraw
                            }));
                        }
                    });
                }
            }
        }

        // 9. ВСЕ ОСТАЛЬНЫЕ СИНХРОННЫЕ ДЕЙСТВИЯ (клики, движения, рисование)
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

// ✨ Алгоритм проверки победных комбинаций
function checkTTTWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Горизонтали
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Вертикали
        [0, 4, 8], [2, 4, 6]             // Диагонали
    ];
    for (let i = 0; i < lines.length; i++) {
        const [a, b, c] = lines[i];
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

function broadcast(roomName, data, senderWs = null) {
    if (!rooms[roomName]) return;
    rooms[roomName].users.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== senderWs) {
            client.send(JSON.stringify(data));
        }
    });
}
