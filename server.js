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
            
            if (!rooms[currentRoom]) {
                rooms[currentRoom] = {
                    users: [],
                    capsules: [],
                    moods: {},
                    // ✨ Игровое состояние для «Поймай искру» внутри конкретной комнаты
                    sparkStatus: null, // 'half' или null
                    sparkTimer: null,  // Ссылка на активный таймаут
                    missTimer: null    // Ссылка на таймаут исчезновения
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

        // ✨ 5. МИНИ-ИГРА: СПАВН ИСКРЫ
        else if (data.type === 'game_spawn_spark') {
            if (currentRoom && rooms[currentRoom]) {
                const room = rooms[currentRoom];

                // Сбрасываем старые таймеры этой комнаты, если они были активны
                clearTimeout(room.sparkTimer);
                clearTimeout(room.missTimer);
                room.sparkStatus = null;

                // Рассылаем координаты новой искры ВСЕМ игрокам в комнате (включая отправителя)
                broadcast(currentRoom, { type: 'game_spawn_spark', x: data.x, y: data.y });

                // Если за 4 секунды никто не нажал — гасим искру
                room.missTimer = setTimeout(() => {
                    if (rooms[currentRoom]) {
                        rooms[currentRoom].sparkStatus = null;
                        broadcast(currentRoom, { type: 'game_spark_miss' });
                    }
                }, 4000);
            }
        }

        // ✨ 6. МИНИ-ИГРА: НАЖАТИЕ НА ИСКРУ
        else if (data.type === 'game_click_spark') {
            if (currentRoom && rooms[currentRoom]) {
                const room = rooms[currentRoom];

                if (!room.sparkStatus) {
                    // Первый игрок поймал искру. Переводим комнату в статус 'half'
                    room.sparkStatus = 'half';
                    
                    // Отменяем таймер исчезновения (missTimer)
                    clearTimeout(room.missTimer);

                    // Оповещаем всех, что искра зафиксирована наполовину
                    broadcast(currentRoom, { type: 'game_spark_half' });

                    // Даем ровно 600 миллисекунд второму игроку, чтобы нажать
                    room.sparkTimer = setTimeout(() => {
                        if (rooms[currentRoom]) {
                            rooms[currentRoom].sparkStatus = null;
                            broadcast(currentRoom, { type: 'game_spark_miss' });
                        }
                    }, 600);

                } else if (room.sparkStatus === 'half') {
                    // Победили! Второй игрок успел нажать в окно 600мс
                    clearTimeout(room.sparkTimer);
                    room.sparkStatus = null;

                    // Отправляем пакет победы ВСЕМ в комнате
                    broadcast(currentRoom, { type: 'game_spark_win' });
                }
            }
        }

        // 7. ВСЕ ОСТАЛЬНЫЕ СИНХРОННЫЕ ДЕЙСТВИЯ (клики, движения, рисовашки)
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

            // Если комната опустела — очищаем память и таймеры игры
            if (room.users.length === 0 && room.capsules.length === 0) {
                clearTimeout(room.sparkTimer);
                clearTimeout(room.missTimer);
                delete rooms[currentRoom];
            }
        }
    });
});

function broadcast(roomName, data, senderWs = null) {
    if (!rooms[roomName]) return;
    rooms[roomName].users.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== senderWs) {
            client.send(JSON.stringify(data));
        }
    });
}
