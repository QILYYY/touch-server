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
                    moods: {} // Хранилище настроений внутри конкретной комнаты
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
                // Сохраняем настроение пользователя в объект комнаты
                rooms[currentRoom].moods[data.userId] = data.status;
                
                // Транслируем изменение партнёру (исключая отправителя через ws)
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
