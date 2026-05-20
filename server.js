const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

const rooms = {}; 

wss.on('connection', (ws) => {
    let currentRoom = null;
    let userUuid = null; // Понадобится, чтобы отличать, чьё именно это настроение

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        // 1. ЛОГИКА ПОДКЛЮЧЕНИЯ К КОМНАТЕ
        if (data.type === 'join') {
            currentRoom = data.room;
            userUuid = data.userId || Math.random().toString(36).substring(7); // ID пользователя
            
            if (!rooms[currentRoom]) {
                rooms[currentRoom] = {
                    users: [],
                    capsules: [],
                    moods: {} // <-- ТЕПЕРЬ СЕРВЕР ЗАПОМИНАЕТ НАСТРОЕНИЯ ХРАНИЛИЩЕМ { "userId": "happy" }
                };
            }
            
            if (!rooms[currentRoom].users.includes(ws)) {
                rooms[currentRoom].users.push(ws);
            }

            broadcast(currentRoom, {
                type: 'system_status',
                text: `Пользователей в комнате: ${rooms[currentRoom].users.length}`
            });

            // Высылаем зашедшему юзеру все капсулы
            rooms[currentRoom].capsules.forEach(capsule => {
                ws.send(JSON.stringify({ type: 'create_capsule', capsule }));
            });

            // ВАЖНО: Высылаем актуальные настроения всех, кто уже есть в комнате
            ws.send(JSON.stringify({
                type: 'mood_sync',
                moods: rooms[currentRoom].moods
            }));
        }

        // 2. ОБНОВЛЕНИЕ НАСТРОЕНИЯ
        else if (data.type === 'mood_update') {
            if (currentRoom && rooms[currentRoom]) {
                // Запоминаем настроение конкретного пользователя на сервере
                rooms[currentRoom].moods[data.userId] = data.mood;

                // Пересылаем статус ВСЕМ в комнате (включая отправителя, если нужно для UI)
                // Если на клиенте UI обновляется сам при клике, оставь тут `, ws` в конце broadcast
                broadcast(currentRoom, {
                    type: 'mood_update',
                    userId: data.userId,
                    mood: data.mood
                }, ws);
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

        // 5. ВСЕ ОСТАЛЬНЫЕ СИНХРОННЫЕ ДЕЙСТВИЯ (клики, движения)
        else {
            if (currentRoom) {
                broadcast(currentRoom, data, ws);
            }
        }
    });

    ws.on('close', () => {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom].users = rooms[currentRoom].users.filter(u => u !== ws);
            
            broadcast(currentRoom, {
                type: 'system_status',
                text: `Пользователей в комнате: ${rooms[currentRoom].users.length}`
            });

            // Если комната пуста — очищаем память
            if (rooms[currentRoom].users.length === 0 && rooms[currentRoom].capsules.length === 0) {
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
