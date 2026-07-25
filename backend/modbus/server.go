package modbus

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"net"
	"sync"

	"med-target/simulator"
	"med-target/websocket"
)

// Modbus 功能碼
const (
	FuncReadCoils          = 0x01
	FuncReadDiscreteInputs = 0x02
	FuncReadHoldingRegs    = 0x03
	FuncReadInputRegs      = 0x04
	FuncWriteSingleCoil    = 0x05
	FuncWriteSingleReg     = 0x06
	FuncWriteMultipleCoils = 0x0F
	FuncWriteMultipleRegs  = 0x10
)

// Server Modbus TCP 伺服器 — 依 Unit ID 路由到不同設施（PLC）。
type Server struct {
	devices     map[byte]simulator.Device // unitID → 設施暫存器存取
	broadcaster *websocket.Broadcaster
	listener    net.Listener
	mu          sync.Mutex
	running     bool
}

// NewServer 建立新的 Modbus 伺服器。devices 以 Modbus Unit ID 為鍵。
func NewServer(devices map[byte]simulator.Device, broadcaster *websocket.Broadcaster) *Server {
	return &Server{
		devices:     devices,
		broadcaster: broadcaster,
	}
}

// Start 啟動伺服器
func (s *Server) Start(addr string) error {
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	s.listener = listener
	s.running = true

	log.Printf("Modbus TCP 伺服器啟動於 %s", addr)

	for s.running {
		conn, err := listener.Accept()
		if err != nil {
			if s.running {
				log.Printf("接受連接錯誤: %v", err)
			}
			continue
		}

		log.Printf("Modbus 客戶端連接: %s", conn.RemoteAddr())
		go s.handleConnection(conn)
	}

	return nil
}

// Stop 停止伺服器
func (s *Server) Stop() {
	s.running = false
	if s.listener != nil {
		s.listener.Close()
	}
}

// handleConnection 處理客戶端連接
func (s *Server) handleConnection(conn net.Conn) {
	defer conn.Close()

	buf := make([]byte, 260) // MBAP header (7) + PDU (max 253)

	for {
		// 讀取 MBAP header (7 bytes)
		_, err := io.ReadFull(conn, buf[:7])
		if err != nil {
			return
		}

		transactionID := binary.BigEndian.Uint16(buf[0:2])
		protocolID := binary.BigEndian.Uint16(buf[2:4])
		length := binary.BigEndian.Uint16(buf[4:6])
		unitID := buf[6]

		if protocolID != 0 {
			log.Printf("無效的協議 ID: %d", protocolID)
			continue
		}

		pduLen := int(length) - 1
		if pduLen <= 0 || pduLen > 253 {
			continue
		}

		_, err = io.ReadFull(conn, buf[7:7+pduLen])
		if err != nil {
			return
		}

		pdu := buf[7 : 7+pduLen]
		funcCode := pdu[0]

		// 依 Unit ID 路由到對應設施；未知 Unit 靜默丟棄
		dev, ok := s.devices[unitID]
		if !ok {
			log.Printf("忽略未知 Unit ID %d 的請求", unitID)
			continue
		}

		response := s.handleRequest(dev, funcCode, pdu[1:])

		respLen := len(response) + 1
		respBuf := make([]byte, 7+len(response))
		binary.BigEndian.PutUint16(respBuf[0:2], transactionID)
		binary.BigEndian.PutUint16(respBuf[2:4], 0)
		binary.BigEndian.PutUint16(respBuf[4:6], uint16(respLen))
		respBuf[6] = unitID
		copy(respBuf[7:], response)

		conn.Write(respBuf)
	}
}

// handleRequest 處理 Modbus 請求（已綁定到指定設施）。
func (s *Server) handleRequest(dev simulator.Device, funcCode byte, data []byte) []byte {
	switch funcCode {
	case FuncReadHoldingRegs:
		return s.handleReadRegs(dev, FuncReadHoldingRegs, data)
	case FuncReadInputRegs:
		return s.handleReadRegs(dev, FuncReadInputRegs, data)
	case FuncWriteSingleReg:
		return s.handleWriteSingleReg(dev, data)
	case FuncWriteMultipleRegs:
		return s.handleWriteMultipleRegs(dev, data)
	case FuncReadCoils:
		return s.handleReadCoils(dev, FuncReadCoils, data)
	case FuncReadDiscreteInputs:
		return s.handleReadCoils(dev, FuncReadDiscreteInputs, data)
	case FuncWriteSingleCoil:
		return s.handleWriteSingleCoil(dev, data)
	case FuncWriteMultipleCoils:
		return s.handleWriteMultipleCoils(dev, data)
	default:
		log.Printf("不支援的功能碼: 0x%02X", funcCode)
		return []byte{funcCode | 0x80, 0x01}
	}
}

// handleReadRegs 讀取保持/輸入寄存器（兩者映射到同一份暫存器）。
func (s *Server) handleReadRegs(dev simulator.Device, fn byte, data []byte) []byte {
	if len(data) < 4 {
		return []byte{fn | 0x80, 0x03}
	}
	startAddr := binary.BigEndian.Uint16(data[0:2])
	quantity := binary.BigEndian.Uint16(data[2:4])
	if quantity == 0 || quantity > 125 {
		return []byte{fn | 0x80, 0x03}
	}

	response := make([]byte, 2+quantity*2)
	response[0] = fn
	response[1] = byte(quantity * 2)
	for i := uint16(0); i < quantity; i++ {
		value := dev.ReadRegister(startAddr + i)
		binary.BigEndian.PutUint16(response[2+i*2:], value)
	}
	return response
}

// handleWriteSingleReg 寫入單個寄存器
func (s *Server) handleWriteSingleReg(dev simulator.Device, data []byte) []byte {
	if len(data) < 4 {
		return []byte{FuncWriteSingleReg | 0x80, 0x03}
	}
	addr := binary.BigEndian.Uint16(data[0:2])
	value := binary.BigEndian.Uint16(data[2:4])

	log.Printf("寫入寄存器: 地址=%d, 值=%d", addr, value)
	s.annotate(dev, addr, value)
	dev.WriteRegister(addr, value)

	response := make([]byte, 5)
	response[0] = FuncWriteSingleReg
	copy(response[1:], data[:4])
	return response
}

// handleWriteMultipleRegs 寫入多個寄存器
func (s *Server) handleWriteMultipleRegs(dev simulator.Device, data []byte) []byte {
	if len(data) < 5 {
		return []byte{FuncWriteMultipleRegs | 0x80, 0x03}
	}
	startAddr := binary.BigEndian.Uint16(data[0:2])
	quantity := binary.BigEndian.Uint16(data[2:4])
	byteCount := data[4]
	if int(byteCount) != int(quantity)*2 || len(data) < 5+int(byteCount) {
		return []byte{FuncWriteMultipleRegs | 0x80, 0x03}
	}

	for i := uint16(0); i < quantity; i++ {
		value := binary.BigEndian.Uint16(data[5+i*2:])
		s.annotate(dev, startAddr+i, value)
		dev.WriteRegister(startAddr+i, value)
	}

	response := make([]byte, 5)
	response[0] = FuncWriteMultipleRegs
	copy(response[1:], data[:4])
	return response
}

// handleReadCoils 讀取線圈/離散輸入
func (s *Server) handleReadCoils(dev simulator.Device, fn byte, data []byte) []byte {
	if len(data) < 4 {
		return []byte{fn | 0x80, 0x03}
	}
	startAddr := binary.BigEndian.Uint16(data[0:2])
	quantity := binary.BigEndian.Uint16(data[2:4])
	if quantity == 0 || quantity > 2000 {
		return []byte{fn | 0x80, 0x03}
	}

	byteCount := (quantity + 7) / 8
	response := make([]byte, 2+byteCount)
	response[0] = fn
	response[1] = byte(byteCount)
	for i := uint16(0); i < quantity; i++ {
		if dev.ReadCoil(startAddr + i) {
			response[2+i/8] |= 1 << (i % 8)
		}
	}
	return response
}

// handleWriteSingleCoil 寫入單個線圈
func (s *Server) handleWriteSingleCoil(dev simulator.Device, data []byte) []byte {
	if len(data) < 4 {
		return []byte{FuncWriteSingleCoil | 0x80, 0x03}
	}
	addr := binary.BigEndian.Uint16(data[0:2])
	value := binary.BigEndian.Uint16(data[2:4])
	coilValue := value == 0xFF00

	log.Printf("寫入線圈: 地址=%d, 值=%v", addr, coilValue)
	dev.WriteCoil(addr, coilValue)

	response := make([]byte, 5)
	response[0] = FuncWriteSingleCoil
	copy(response[1:], data[:4])
	return response
}

// handleWriteMultipleCoils 寫入多個線圈
func (s *Server) handleWriteMultipleCoils(dev simulator.Device, data []byte) []byte {
	if len(data) < 6 {
		return []byte{FuncWriteMultipleCoils | 0x80, 0x03}
	}
	startAddr := binary.BigEndian.Uint16(data[0:2])
	quantity := binary.BigEndian.Uint16(data[2:4])
	byteCount := data[4]

	expectedBytes := (quantity + 7) / 8
	if uint16(byteCount) != expectedBytes || len(data) < 5+int(byteCount) {
		return []byte{FuncWriteMultipleCoils | 0x80, 0x03}
	}

	for i := uint16(0); i < quantity; i++ {
		byteIndex := i / 8
		bitIndex := i % 8
		value := (data[5+byteIndex] >> bitIndex) & 0x01
		dev.WriteCoil(startAddr+i, value == 1)
	}

	response := make([]byte, 5)
	response[0] = FuncWriteMultipleCoils
	copy(response[1:], data[:4])
	return response
}

// annotate 透過設施判斷可疑寫入並廣播警報（JSON 安全編碼）。
func (s *Server) annotate(dev simulator.Device, addr uint16, value uint16) {
	level, msg := dev.AnnotateWrite(addr, value)
	if level <= 0 || msg == "" {
		return
	}
	log.Println(msg)
	payload, _ := json.Marshal(map[string]interface{}{
		"type":    "alert",
		"level":   level,
		"message": msg,
	})
	s.broadcaster.Broadcast(payload)
}
