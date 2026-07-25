package websocket

import (
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // 允許所有來源 (開發用)
	},
}

// Client 代表一個 WebSocket 客戶端
type Client struct {
	conn *websocket.Conn
	send chan []byte
}

// Broadcaster 管理所有 WebSocket 連接
type Broadcaster struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// NewBroadcaster 建立新的廣播器
func NewBroadcaster() *Broadcaster {
	b := &Broadcaster{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
	go b.run()
	return b
}

// run 執行廣播器主循環
func (b *Broadcaster) run() {
	for {
		select {
		case client := <-b.register:
			b.mu.Lock()
			b.clients[client] = true
			b.mu.Unlock()
			log.Printf("新客戶端連接, 總數: %d", len(b.clients))

		case client := <-b.unregister:
			b.mu.Lock()
			if _, ok := b.clients[client]; ok {
				delete(b.clients, client)
				close(client.send)
			}
			b.mu.Unlock()
			log.Printf("客戶端斷開, 總數: %d", len(b.clients))

		case message := <-b.broadcast:
			b.mu.RLock()
			for client := range b.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(b.clients, client)
				}
			}
			b.mu.RUnlock()
		}
	}
}

// Broadcast 廣播訊息給所有客戶端
func (b *Broadcaster) Broadcast(message []byte) {
	select {
	case b.broadcast <- message:
	default:
		// 緩衝區滿，丟棄訊息
	}
}

// HandleWebSocket 處理 WebSocket 連接
func (b *Broadcaster) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket 升級失敗: %v", err)
		return
	}

	client := &Client{
		conn: conn,
		send: make(chan []byte, 256),
	}

	b.register <- client

	// 處理發送
	go func() {
		defer func() {
			conn.Close()
		}()

		for message := range client.send {
			if err := conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		}
	}()

	// 處理接收 (用於接收客戶端命令)
	go func() {
		defer func() {
			b.unregister <- client
			conn.Close()
		}()

		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket 錯誤: %v", err)
				}
				break
			}

			// 處理客戶端訊息 (可擴展)
			log.Printf("收到客戶端訊息: %s", string(message))
		}
	}()
}

// BroadcastExplosion 廣播爆炸事件
func (b *Broadcaster) BroadcastExplosion(explosionType string, location string) {
	message := []byte(`{"type":"explosion","explosionType":"` + explosionType + `","location":"` + location + `"}`)
	b.Broadcast(message)
}

// BroadcastAlert 廣播警報
func (b *Broadcaster) BroadcastAlert(level int, message string) {
	alertMsg := []byte(`{"type":"alert","level":` + string(rune('0'+level)) + `,"message":"` + message + `"}`)
	b.Broadcast(alertMsg)
}
