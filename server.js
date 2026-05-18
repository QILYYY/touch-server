const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
console.log('Сервер приватного сопряжения запущен на порту 8080...');

wss.on('connection', (ws) => {
    // При подключении у пользователя ещё нет комнаты
    ws.roomCode = null; 

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. Обработка входа в комнату
            if (data.type === 'join') {
                ws.roomCode = data.room.trim().toLowerCase(); // Приводим к одному регистру
                console.log(`Пользователь вошел в комнату: [${ws.roomCode}]`);
                
                // Считаем, сколько людей сейчас в этой комнате
                let partnersCount = 0;
                wss.clients.forEach(client => {
                    if (client.roomCode === ws.roomCode) partnersCount++;
                });

                ws.send(JSON.stringify({ 
                    type: 'system_status', 
                    text: `Успешно подключено к комнате: ${ws.roomCode}. Участников: ${partnersCount}` 
                }));
                return;
            }

            // 2. Пересылка тачей и чата (ТОЛЬКО внутри той же комнаты)
            if (ws.roomCode) {
                wss.clients.forEach((client) => {
                    // Отправляем всем в этой комнате, кроме самого себя
                    if (client !== ws && client.roomCode === ws.roomCode && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            } else {
                ws.send(JSON.stringify({ type: 'system_status', text: 'Ошибка: Вы не вошли в комнату' }));
            }

        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    });

    ws.on('close', () => {
        console.log('Пользователь отключился');
    });
});
