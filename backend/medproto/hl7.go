// Package medproto 提供醫療設備教學靶機所用的醫療通訊協定模擬端點。
//
// 本檔案實作一個「模擬的」HL7 v2 over MLLP (Minimal Lower Layer Protocol)
// 介面伺服器，供 AIS3 學員在「隔離實驗室」中練習經授權的 ICS / 通訊協定
// 模糊測試 (fuzzing)。
//
// 重要聲明：
//   - 這是刻意寫得寬鬆、容錯的「教學用模糊測試靶標」，不是真正的臨床系統。
//   - 它不連接任何真實醫療設備、不處理任何真實病患資料 (PHI)。
//   - 它「故意」接受各種畸形 / 惡意輸入而不崩潰，好讓學員觀察 fuzz payload
//     是否命中；請「僅限」於隔離教學環境中使用，切勿部署於任何生產或臨床網路。
//
// HL7/MLLP 框架格式：一則訊息為  0x0B <HL7 payload> 0x1C 0x0D。
// HL7 payload 為 pipe (`|`) 分隔欄位、CR (`\r`) 分隔 segment，首個 segment 應為 MSH。
package medproto

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"strings"
	"time"
)

// MLLP 框架位元組。
const (
	mllpStartBlock = 0x0B // <VT>  訊息起始
	mllpEndBlock   = 0x1C // <FS>  訊息結束（後接 <CR>）
	mllpCarriage   = 0x0D // <CR>  訊息結束的第二位元組
)

const (
	maxMessageBytes = 64 * 1024        // 單則訊息上限 64 KiB，超過即放棄該連線
	idleTimeout     = 60 * time.Second // 閒置逾時，回收殭屍連線
	snippetMaxLen   = 120              // log 中原始 payload 片段的最大長度
)

// StartHL7 啟動一個阻塞式的 HL7-over-MLLP TCP 伺服器並監聽 addr（例如 "0.0.0.0:2575"）。
// 僅在 listener 發生錯誤時回傳；設計上應由 main 以 goroutine 執行。
func StartHL7(addr string) error {
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	defer listener.Close()

	log.Printf("HL7/MLLP 模擬伺服器啟動於 %s (教學靶機 · 隔離環境專用)", addr)

	for {
		conn, err := listener.Accept()
		if err != nil {
			// 監聽器錯誤（例如被關閉）即結束伺服器。
			return err
		}
		go handleHL7Conn(conn)
	}
}

// handleHL7Conn 處理單一 HL7/MLLP 連線；每則訊息回覆一個 ACK。
// 這是模糊測試靶標：以 recover 確保任何畸形輸入都不會讓程序崩潰。
func handleHL7Conn(conn net.Conn) {
	defer func() {
		if r := recover(); r != nil {
			// 絕不讓單一連線的 panic 拖垮整個伺服器。
			log.Printf("HL7 連線處理 panic 已被攔截 (%s): %v", conn.RemoteAddr(), r)
		}
		conn.Close()
	}()

	remote := conn.RemoteAddr()
	log.Printf("HL7 客戶端連接: %s", remote)

	reader := bufio.NewReader(conn)

	for {
		// 每則訊息重設閒置讀取逾時，殭屍連線會在 idleTimeout 後被回收。
		conn.SetReadDeadline(time.Now().Add(idleTimeout))

		payload, err := readMLLPMessage(reader)
		if err != nil {
			// io.EOF、逾時、或訊息過大等：結束此連線。
			if len(payload) > 0 {
				log.Printf("HL7 連線 %s 讀取中止 (%v)，已丟棄 %d bytes 未完成訊息", remote, err, len(payload))
			}
			return
		}

		msh := parseHL7(payload)
		log.Printf("HL7 訊息 [%s] sendingApp=%q type=%q controlID=%q len=%d payload=%q",
			remote, msh.sendingApp, msh.messageType, msh.controlID, len(payload), safeSnippet(payload))

		ack := buildACK(msh)
		if _, err := conn.Write(wrapMLLP(ack)); err != nil {
			log.Printf("HL7 回覆 ACK 給 %s 失敗: %v", remote, err)
			return
		}
	}
}

// readMLLPMessage 從 reader 讀出一則 MLLP 訊息的 HL7 payload（不含框架位元組）。
//
// 容錯設計：
//   - 起始若非 0x0B，跳過雜訊位元組直到找到起始塊（容忍缺少 0x0B 前的垃圾）。
//   - 累積內容直到看見結束塊 0x1C 0x0D。
//   - 單則訊息超過 maxMessageBytes 即放棄（回傳錯誤，呼叫端會關閉連線）。
func readMLLPMessage(reader *bufio.Reader) ([]byte, error) {
	// 1) 尋找起始塊 0x0B，途中的雜訊位元組一律丟棄。
	for {
		b, err := reader.ReadByte()
		if err != nil {
			return nil, err
		}
		if b == mllpStartBlock {
			break
		}
		// 非起始位元組：視為雜訊略過（缺 0x0B 時的容錯）。
	}

	// 2) 累積 payload 直到 0x1C（<FS>）；其後若為 0x0D 則吞掉作為框架結尾。
	buf := make([]byte, 0, 512)
	for {
		b, err := reader.ReadByte()
		if err != nil {
			return buf, err
		}
		if b == mllpEndBlock {
			// 結束塊：嘗試吃掉緊接的 0x0D（若無也容忍）。
			if next, err := reader.ReadByte(); err == nil && next != mllpCarriage {
				reader.UnreadByte()
			}
			return buf, nil
		}
		buf = append(buf, b)
		if len(buf) > maxMessageBytes {
			return buf, fmt.Errorf("訊息超過上限 %d bytes", maxMessageBytes)
		}
	}
}

// mshInfo 為從 MSH segment 擷取出的欄位；缺漏欄位以空字串表示。
type mshInfo struct {
	sendingApp  string // MSH-3
	messageType string // MSH-9
	controlID   string // MSH-10
}

// parseHL7 寬鬆解析 HL7 payload，抽取 MSH-3 / MSH-9 / MSH-10。
// 任何缺漏 / 畸形皆不 panic，盡力而為地回傳能取得的欄位。
func parseHL7(payload []byte) mshInfo {
	var info mshInfo

	// 取第一個 segment（以 CR 分隔；也容忍 LF）。
	text := string(payload)
	text = strings.ReplaceAll(text, "\n", "\r")
	segEnd := strings.IndexByte(text, '\r')
	first := text
	if segEnd >= 0 {
		first = text[:segEnd]
	}

	if !strings.HasPrefix(first, "MSH") {
		// 首段非 MSH：容忍，回傳空欄位。
		return info
	}

	// MSH 特殊：欄位分隔符為 MSH 之後的第一個字元（通常是 '|'）。
	if len(first) < 4 {
		return info
	}
	sep := first[3]
	fields := strings.Split(first, string(sep))
	// fields[0] = "MSH"，MSH-1 概念上是分隔符本身；
	// 依 HL7 慣例 fields[n] 對應 MSH-(n+1)。因此：
	//   MSH-3  → fields[2]，MSH-9 → fields[8]，MSH-10 → fields[9]。
	info.sendingApp = fieldAt(fields, 2)
	info.messageType = fieldAt(fields, 8)
	info.controlID = fieldAt(fields, 9)
	return info
}

// fieldAt 安全取用切片元素，越界回傳空字串。
func fieldAt(fields []string, i int) string {
	if i >= 0 && i < len(fields) {
		return fields[i]
	}
	return ""
}

// buildACK 依原始訊息資訊組出 HL7 ACK (MSH + MSA)。
func buildACK(msh mshInfo) []byte {
	ts := time.Now().Format("20060102150405")
	// 以時間戳作為新的 message control ID，唯一即可。
	newID := "ACK" + ts

	origApp := msh.sendingApp
	origControlID := msh.controlID

	// MSH|^~\&|CYBERRANGE|MRI|<origApp>||<ts>||ACK^A01|<newID>|P|2.5
	// MSA|AA|<origControlID>
	var b strings.Builder
	b.WriteString("MSH|^~\\&|CYBERRANGE|MRI|")
	b.WriteString(origApp)
	b.WriteString("||")
	b.WriteString(ts)
	b.WriteString("||ACK^A01|")
	b.WriteString(newID)
	b.WriteString("|P|2.5\r")
	b.WriteString("MSA|AA|")
	b.WriteString(origControlID)
	b.WriteString("\r")
	return []byte(b.String())
}

// wrapMLLP 以 MLLP 框架包裝 payload：0x0B <payload> 0x1C 0x0D。
func wrapMLLP(payload []byte) []byte {
	out := make([]byte, 0, len(payload)+3)
	out = append(out, mllpStartBlock)
	out = append(out, payload...)
	out = append(out, mllpEndBlock, mllpCarriage)
	return out
}

// safeSnippet 將原始 payload 轉為可安全記錄的片段：
// 去除控制字元、非可列印位元組以 '.' 取代，並限制長度。
func safeSnippet(payload []byte) string {
	limit := len(payload)
	truncated := false
	if limit > snippetMaxLen {
		limit = snippetMaxLen
		truncated = true
	}
	var b strings.Builder
	b.Grow(limit)
	for _, c := range payload[:limit] {
		if c >= 0x20 && c < 0x7F {
			b.WriteByte(c)
		} else {
			b.WriteByte('.')
		}
	}
	if truncated {
		b.WriteString("…")
	}
	return b.String()
}
