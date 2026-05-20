const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

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
                    capsules: [] // <-- ТЕПЕРЬ КОМНАТА УМЕЕТ ЗАПОМИНАТЬ КАПСУЛЫ
                };
            }
            
            // Добавляем юзера, если его там еще нет
            if (!rooms[currentRoom].users.includes(ws)) {
                rooms[currentRoom].users.push(ws);
            }

            // Отправляем текущий статус комнат всем в ней
            broadcast(currentRoom, {
                type: 'system_status',
                text: `Пользователей в комнате: ${rooms[currentRoom].users.length}`
            });

            // ВАЖНО: При входе высылаем юзеру ВСЕ накопленные капсулы этой комнаты
            rooms[currentRoom].capsules.forEach(capsule => {
                ws.send(JSON.stringify({ type: 'create_capsule', capsule }));
            });
        }

        // 2. СОЗДАНИЕ КАПСУЛЫ
        else if (data.type === 'create_capsule') {
            if (currentRoom && rooms[currentRoom]) {
                // Сохраняем капсулу в память комнаты на сервере
                rooms[currentRoom].capsules.push(data.capsule);
                
                // Пересылаем её партнёру (если он онлайн)
                broadcast(currentRoom, data, ws); 
            }
        }

        // 3. ЧТЕНИЕ/УДАЛЕНИЕ КАПСУЛЫ
        else if (data.type === 'capsule_read') {
            if (currentRoom && rooms[currentRoom]) {
                // Удаляем капсулу из памяти сервера по координатам
                rooms[currentRoom].capsules = rooms[currentRoom].capsules.filter(c => 
                    !(c.x === data.x && c.y === data.y)
                );
                
                // Синхронизируем удаление у партнёра
                broadcast(currentRoom, data, ws);
            }
        }

        // 4. ВСЕ ОСТАЛЬНЫЕ СИНХРОННЫЕ ДЕЙСТВИЯ (клики, движения, темы)
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

            // Если комната совсем опустела и капсул нет — удаляем её структуру из ОЗУ
            if (rooms[currentRoom].users.length === 0 && rooms[currentRoom].capsules.length === 0) {
                delete rooms[currentRoom];
            }
        }
    });
});

// Функция отправки сообщений внутри комнаты
function broadcast(roomName, data, senderWs = null) {
    if (!rooms[roomName]) return;
    rooms[roomName].users.forEach(client => {
        // Если senderWs передан, отправляем всем кроме автора, если не передан — вообще всем
        if (client.readyState === WebSocket.OPEN && client !== senderWs) {
            client.send(JSON.stringify(data));
        }
    });
}
