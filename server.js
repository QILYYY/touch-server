import { WebSocketServer } from 'ws';

// Render сам передает порт через переменную окружения
const port = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: port });

console.log(`Сервер запущен на порту ${port}...`);

wss.on('connection', (ws) => {
    ws.roomCode = null; 

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'join') {
                ws.roomCode = data.room.trim().toLowerCase();
                console.log(`Пользователь вошел в комнату: [${ws.roomCode}]`);
                
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

            if (ws.roomCode) {
                wss.clients.forEach((client) => {
                    if (client !== ws && client.roomCode === ws.roomCode && client.readyState === 1) {
                        client.send(JSON.stringify(data));
                    }
                });
            }
        } catch (e) {
            console.error(e);
        }
    });
});
