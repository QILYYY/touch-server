const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Touch Server 2026 is Running\n');
});

const wss = new WebSocket.Server({ server });
const rooms = {}; // Хранилище комнат и пользователей

wss.on('connection', (ws) => {
    let currentRoom = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. Вход в комнату
            if (data.type === 'join') {
                currentRoom = data.room;
                if (!rooms[currentRoom]) rooms[currentRoom] = [];
                
                // Ограничиваем комнату двумя участниками
                if (rooms[currentRoom].length < 2) {
                    rooms[currentRoom].push(ws);
                }
                
                // Уведомляем участников о статусе сети
                broadcastToRoom(currentRoom, { 
                    type: 'system_status', 
                    text: `Участников: ${rooms[currentRoom].length}` 
                });
            }

            // 2. Ретрансляция ВСЕХ типов событий партнеру
            // (подходит для touch, draw_start, draw_move, draw_end, custom_rhythm, combo_match)
            if (currentRoom && rooms[currentRoom]) {
                rooms[currentRoom].forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
            }

        } catch (e) {
            console.error("Ошибка обработки:", e);
        }
    });

    ws.on('close', () => {
        if (currentRoom && rooms[currentRoom]) {
            rooms[currentRoom] = rooms[currentRoom].filter((client) => client !== ws);
            broadcastToRoom(currentRoom, { 
                type: 'system_status', 
                text: `Участников: ${rooms[currentRoom].length}` 
            });
            if (rooms[currentRoom].length === 0) delete rooms[currentRoom];
        }
    });
});

function broadcastToRoom(room, data) {
    if (rooms[room]) {
        rooms[room].forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));                });
            }
        } catch (e) {
            console.error(e);
        }
    });
});
