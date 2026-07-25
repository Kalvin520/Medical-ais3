// Package medproto —— 醫療通訊協定「模擬靶機」。
//
// 本檔提供一個「模擬」的 DICOM Upper Layer（上層協定）端點，作為 AIS3 教學
// 用的封閉式（isolated）網路靶場，讓學員在「被授權」的前提下練習 ICS／通訊
// 協定的模糊測試（fuzzing）。設計刻意「極簡且寬鬆」，方便被丟各種畸形封包：
//
//   - 這不是真正的 PACS／影像設備（modality），只是模仿 MRI 的 DICOM 驗證
//     服務（C-ECHO / Verification）的外觀，讓封包收送流程看起來像真的。
//   - 僅實作足夠的 DICOM UL PDU 處理，能接受 A-ASSOCIATE 並回覆 C-ECHO-RSP，
//     其餘一律寬容處理，絕不因畸形輸入而使行程崩潰。
//   - 僅供教學／防禦研究使用；請勿部署於任何生產或醫療環境。
//
// 線路格式（DICOM PS3.8 Upper Layer PDU）：
//
//	1 byte  PDU 類型
//	1 byte  保留
//	4 bytes 大端序長度
//	N bytes PDU 內容（N = 上述長度）
package medproto

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"time"
)

// DICOM Upper Layer PDU 類型
const (
	dcmPDUAssociateRQ = 0x01 // A-ASSOCIATE-RQ
	dcmPDUAssociateAC = 0x02 // A-ASSOCIATE-AC
	dcmPDUAssociateRJ = 0x03 // A-ASSOCIATE-RJ
	dcmPDUDataTF      = 0x04 // P-DATA-TF（承載 DIMSE，如 C-ECHO-RQ）
	dcmPDUReleaseRQ   = 0x05 // A-RELEASE-RQ
	dcmPDUReleaseRP   = 0x06 // A-RELEASE-RP
	dcmPDUAbort       = 0x07 // A-ABORT
)

const (
	// dcmMaxPDULen 為單一 PDU 內容長度上限（1 MiB）。超過此值視為敵意／畸形
	// 輸入，直接優雅地中斷連線，避免記憶體被撐爆。
	dcmMaxPDULen = 1 << 20
	// dcmIdleTimeout 為讀取閒置逾時，避免連線長時間占用資源。
	dcmIdleTimeout = 60 * time.Second
	// dcmWriteTimeout 為單次回應寫入逾時。
	dcmWriteTimeout = 15 * time.Second
)

// StartDICOM 啟動一個阻塞式的極簡 DICOM Upper Layer TCP 伺服器並監聽 addr
// （例如 "0.0.0.0:11112"）。僅在監聽器發生錯誤時回傳；一般由 main 以 goroutine
// 方式執行。每條連線各開一個 goroutine 處理，彼此互不影響。
func StartDICOM(addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	defer ln.Close()

	log.Printf("DICOM Upper Layer 伺服器啟動於 %s（模擬 MRI DICOM 驗證服務 / C-ECHO）", addr)

	for {
		conn, err := ln.Accept()
		if err != nil {
			return err
		}
		go dcmHandleConn(conn)
	}
}

// dcmHandleConn 處理單一連線。整段包在 recover 內，任何畸形封包導致的 panic
// 都只會結束「這條連線」，不會拖垮整個行程。
func dcmHandleConn(conn net.Conn) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("DICOM 連線處理已從 panic 復原 (%s): %v", conn.RemoteAddr(), r)
		}
	}()
	defer conn.Close()

	remote := conn.RemoteAddr()
	log.Printf("DICOM 新連線: %s", remote)

	for {
		conn.SetReadDeadline(time.Now().Add(dcmIdleTimeout))

		pduType, body, err := dcmReadPDU(conn)
		if err != nil {
			if err != io.EOF {
				log.Printf("DICOM 連線結束 (%s): %v", remote, err)
			}
			return
		}

		log.Printf("DICOM PDU type=0x%02X len=%d body=%s", pduType, len(body), dcmSafeSnippet(body))

		switch pduType {
		case dcmPDUAssociateRQ:
			called, calling := dcmParseAETitles(body)
			log.Printf("DICOM A-ASSOCIATE-RQ (%s) called-AE=%q calling-AE=%q → 回覆 A-ASSOCIATE-AC", remote, called, calling)
			if !dcmWrite(conn, dcmBuildAssociateAC(body)) {
				return
			}

		case dcmPDUDataTF:
			log.Printf("DICOM P-DATA-TF (%s) → 回覆 C-ECHO-RSP (status 0x0000 success)", remote)
			if !dcmWrite(conn, dcmBuildEchoResponse(body)) {
				return
			}

		case dcmPDUReleaseRQ:
			log.Printf("DICOM A-RELEASE-RQ (%s) → 回覆 A-RELEASE-RP", remote)
			dcmWrite(conn, dcmBuildReleaseRP())
			return

		case dcmPDUAbort:
			log.Printf("DICOM A-ABORT (%s) → 關閉連線", remote)
			return

		default:
			log.Printf("DICOM 未知/畸形 PDU type=0x%02X (%s) → 送出 A-ABORT 並關閉", pduType, remote)
			dcmWrite(conn, dcmBuildAbort())
			return
		}
	}
}

// dcmReadPDU 讀取一個完整 PDU（6 bytes 標頭 + 內容）。長度受 dcmMaxPDULen 約束；
// 超過上限則回傳錯誤讓呼叫端優雅收線。可容忍截斷的標頭與零長度內容。
func dcmReadPDU(conn net.Conn) (byte, []byte, error) {
	var hdr [6]byte
	if _, err := io.ReadFull(conn, hdr[:]); err != nil {
		return 0, nil, err
	}

	pduType := hdr[0]
	length := binary.BigEndian.Uint32(hdr[2:6])

	if length > dcmMaxPDULen {
		return pduType, nil, fmt.Errorf("PDU 長度 %d 超過上限 %d，中斷連線", length, dcmMaxPDULen)
	}

	body := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(conn, body); err != nil {
			return pduType, nil, err
		}
	}
	return pduType, body, nil
}

// dcmWrite 設定寫入逾時後送出一個 PDU；失敗回傳 false（呼叫端據以收線）。
func dcmWrite(conn net.Conn, pdu []byte) bool {
	conn.SetWriteDeadline(time.Now().Add(dcmWriteTimeout))
	_, err := conn.Write(pdu)
	return err == nil
}

// dcmSafeSnippet 將封包內容轉為「截斷的十六進位」字串，讓學員在日誌看到自己送
// 進來的模糊測試輸入，同時避免原始位元組污染日誌。
func dcmSafeSnippet(b []byte) string {
	const max = 48
	if len(b) == 0 {
		return "(空)"
	}
	n := len(b)
	truncated := false
	if n > max {
		n = max
		truncated = true
	}
	s := hex.EncodeToString(b[:n])
	if truncated {
		s += "…"
	}
	return s
}

// dcmParseAETitles 從 A-ASSOCIATE-RQ 內容寬容地取出 Called / Calling AE Title。
// 版面：bytes[4:20] = Called AE、bytes[20:36] = Calling AE（各 16 bytes、空白填補）。
// 長度不足時回傳空字串，不會越界。
func dcmParseAETitles(body []byte) (called, calling string) {
	if len(body) >= 20 {
		called = dcmSanitizeAE(body[4:20])
	}
	if len(body) >= 36 {
		calling = dcmSanitizeAE(body[20:36])
	}
	return called, calling
}

// dcmSanitizeAE 淨化 AE Title：非可列印字元一律以 '.' 取代，再去除前後空白，
// 避免惡意位元組造成日誌注入。
func dcmSanitizeAE(b []byte) string {
	out := make([]byte, len(b))
	for i, c := range b {
		if c >= 0x20 && c < 0x7f {
			out[i] = c
		} else {
			out[i] = '.'
		}
	}
	return strings.TrimSpace(string(out))
}

// dcmWrapPDU 把 PDU 內容包上 6 bytes 標頭（類型 + 保留 + 大端序長度）。
func dcmWrapPDU(pduType byte, data []byte) []byte {
	out := make([]byte, 6+len(data))
	out[0] = pduType
	out[1] = 0x00
	binary.BigEndian.PutUint32(out[2:6], uint32(len(data)))
	copy(out[6:], data)
	return out
}

// dcmItem 組出一個 DICOM UL 可變項目 / 子項目：類型(1) + 保留(1) + 長度(2, 大端) + 內容。
func dcmItem(itemType byte, payload []byte) []byte {
	out := make([]byte, 4+len(payload))
	out[0] = itemType
	out[1] = 0x00
	binary.BigEndian.PutUint16(out[2:4], uint16(len(payload)))
	copy(out[4:], payload)
	return out
}

// dcmAEField 取回 RQ 中位於 off 的 16-byte AE Title 欄位；不足時以 16 個空白回填。
func dcmAEField(rq []byte, off int) []byte {
	field := bytes.Repeat([]byte{' '}, 16)
	if len(rq) >= off+16 {
		copy(field, rq[off:off+16])
	}
	return field
}

// dcmExtractPresentationContextID 從 A-ASSOCIATE-RQ 的可變項目中，寬容地取出
// 第一個 Presentation Context（項目類型 0x20）的 Context ID；找不到則回傳 1。
func dcmExtractPresentationContextID(rq []byte) byte {
	pos := 68 // 可變項目起始位移（版本2 + 保留2 + 兩個AE各16 + 保留32）
	for pos+4 <= len(rq) {
		itemType := rq[pos]
		itemLen := int(binary.BigEndian.Uint16(rq[pos+2 : pos+4]))
		if itemType == 0x20 && pos+4 < len(rq) {
			return rq[pos+4]
		}
		pos += 4 + itemLen
	}
	return 1
}

// dcmBuildAssociateAC 依收到的 A-ASSOCIATE-RQ 組出一個「結構合理」的
// A-ASSOCIATE-AC PDU：回抄 AE Title、接受第一個 Presentation Context、附上最小
// 的 Application Context 與 User Information。並非完全符合規範，但足以讓學員的
// 客戶端認為關聯（association）已建立，好接著送更多 PDU。
func dcmBuildAssociateAC(rq []byte) []byte {
	pcID := dcmExtractPresentationContextID(rq)

	data := &bytes.Buffer{}
	data.Write([]byte{0x00, 0x01}) // Protocol Version = 1
	data.Write([]byte{0x00, 0x00}) // 保留
	data.Write(dcmAEField(rq, 4))  // Called AE Title（回抄）
	data.Write(dcmAEField(rq, 20)) // Calling AE Title（回抄）
	data.Write(make([]byte, 32))   // 32 bytes 保留

	// Application Context Item (0x10) — DICOM Application Context Name。
	data.Write(dcmItem(0x10, dcmPadUID("1.2.840.10008.3.1.1.1")))

	// Presentation Context Item (AC, 0x21)：
	//   ctxID(1) + 保留(1) + result=0接受(1) + 保留(1) + Transfer Syntax 子項目(0x40)
	tsItem := dcmItem(0x40, dcmPadUID("1.2.840.10008.1.2")) // Implicit VR Little Endian
	pcPayload := append([]byte{pcID, 0x00, 0x00, 0x00}, tsItem...)
	data.Write(dcmItem(0x21, pcPayload))

	// User Information Item (0x50)：內含 Maximum Length 子項目 (0x51)。
	maxLen := make([]byte, 4)
	binary.BigEndian.PutUint32(maxLen, 16384)
	data.Write(dcmItem(0x50, dcmItem(0x51, maxLen)))

	return dcmWrapPDU(dcmPDUAssociateAC, data.Bytes())
}

// dcmBuildReleaseRP 組出 A-RELEASE-RP（內容為 4 bytes 保留）。
func dcmBuildReleaseRP() []byte {
	return dcmWrapPDU(dcmPDUReleaseRP, make([]byte, 4))
}

// dcmBuildAbort 組出 A-ABORT：保留(1)+保留(1)+來源(1)+原因(1)。來源/原因皆填 0。
func dcmBuildAbort() []byte {
	return dcmWrapPDU(dcmPDUAbort, []byte{0x00, 0x00, 0x00, 0x00})
}

// dcmBuildEchoResponse 依收到的 P-DATA-TF 組出承載 C-ECHO-RSP 的 P-DATA-TF。
// 會寬容地沿用來訊的 Presentation Context ID 與 Message ID。
func dcmBuildEchoResponse(body []byte) []byte {
	pcID, msgID := dcmParseEchoRequest(body)
	command := dcmBuildCEchoRSPCommand(msgID)
	return dcmBuildPDataTF(pcID, command)
}

// dcmParseEchoRequest 從 P-DATA-TF 內容寬容地取出第一個 PDV 的 Context ID，並嘗試
// 從 DIMSE 命令片段找出 Message ID (0000,0110)。任何欄位缺漏都回退為預設值。
func dcmParseEchoRequest(body []byte) (pcID byte, msgID uint16) {
	pcID = 1
	msgID = 1
	if len(body) < 6 {
		return pcID, msgID
	}
	// PDV：長度(4, 大端) + Context ID(1) + Message Control Header(1) + 命令片段
	pdvLen := binary.BigEndian.Uint32(body[0:4])
	pcID = body[4]

	end := 4 + int(pdvLen)
	if end > len(body) || end < 6 {
		end = len(body)
	}
	fragment := body[6:end]
	if id, ok := dcmExtractMessageID(fragment); ok {
		msgID = id
	}
	return pcID, msgID
}

// dcmExtractMessageID 在 Implicit VR Little Endian 的 DIMSE 命令片段中，寬容掃描
// 資料元素，找出 Message ID (0000,0110) 的 US 值。找不到或截斷則回傳 false。
func dcmExtractMessageID(frag []byte) (uint16, bool) {
	pos := 0
	for pos+8 <= len(frag) {
		group := binary.LittleEndian.Uint16(frag[pos : pos+2])
		elem := binary.LittleEndian.Uint16(frag[pos+2 : pos+4])
		vlen := int(binary.LittleEndian.Uint32(frag[pos+4 : pos+8]))
		valStart := pos + 8
		valEnd := valStart + vlen
		if vlen < 0 || valEnd > len(frag) {
			break
		}
		if group == 0x0000 && elem == 0x0110 && vlen >= 2 {
			return binary.LittleEndian.Uint16(frag[valStart : valStart+2]), true
		}
		pos = valEnd
	}
	return 0, false
}

// dcmBuildPDataTF 把 DIMSE 命令片段包成一個 P-DATA-TF PDU（單一 PDV，命令 + 最後片段）。
func dcmBuildPDataTF(pcID byte, command []byte) []byte {
	pdv := &bytes.Buffer{}
	var lenBuf [4]byte
	// PDV 長度 = Context ID(1) + Message Control Header(1) + 命令片段
	binary.BigEndian.PutUint32(lenBuf[:], uint32(2+len(command)))
	pdv.Write(lenBuf[:])
	pdv.WriteByte(pcID)
	pdv.WriteByte(0x03) // Message Control Header：bit0=命令、bit1=最後片段
	pdv.Write(command)
	return dcmWrapPDU(dcmPDUDataTF, pdv.Bytes())
}

// dcmBuildCEchoRSPCommand 組出一個最小的 C-ECHO-RSP DIMSE 命令群組
// （Implicit VR Little Endian，status 0x0000 = success）。
func dcmBuildCEchoRSPCommand(msgID uint16) []byte {
	elems := &bytes.Buffer{}
	// (0000,0002) Affected SOP Class UID = Verification SOP Class
	dcmWriteImplicitElem(elems, 0x0000, 0x0002, dcmPadUID("1.2.840.10008.1.1"))
	// (0000,0100) Command Field, US = 0x8030 (C-ECHO-RSP)
	dcmWriteImplicitElem(elems, 0x0000, 0x0100, dcmU16LE(0x8030))
	// (0000,0120) Message ID Being Responded To, US
	dcmWriteImplicitElem(elems, 0x0000, 0x0120, dcmU16LE(msgID))
	// (0000,0800) Command Data Set Type, US = 0x0101 (無資料集)
	dcmWriteImplicitElem(elems, 0x0000, 0x0800, dcmU16LE(0x0101))
	// (0000,0900) Status, US = 0x0000 (success)
	dcmWriteImplicitElem(elems, 0x0000, 0x0900, dcmU16LE(0x0000))

	// 前置 (0000,0000) Command Group Length, UL = 其後所有元素的位元組數。
	out := &bytes.Buffer{}
	dcmWriteImplicitElem(out, 0x0000, 0x0000, dcmU32LE(uint32(elems.Len())))
	out.Write(elems.Bytes())
	return out.Bytes()
}

// dcmWriteImplicitElem 以 Implicit VR Little Endian 寫入一個資料元素：
// group(2, LE) + element(2, LE) + 長度(4, LE) + 值。
func dcmWriteImplicitElem(buf *bytes.Buffer, group, elem uint16, value []byte) {
	var tag [8]byte
	binary.LittleEndian.PutUint16(tag[0:2], group)
	binary.LittleEndian.PutUint16(tag[2:4], elem)
	binary.LittleEndian.PutUint32(tag[4:8], uint32(len(value)))
	buf.Write(tag[:])
	buf.Write(value)
}

// dcmU16LE 回傳 uint16 的小端序 2 bytes。
func dcmU16LE(v uint16) []byte {
	b := make([]byte, 2)
	binary.LittleEndian.PutUint16(b, v)
	return b
}

// dcmU32LE 回傳 uint32 的小端序 4 bytes。
func dcmU32LE(v uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, v)
	return b
}

// dcmPadUID 把 UID 補到偶數長度（DICOM 規定 UID 以 0x00 補齊為偶數位元組）。
func dcmPadUID(s string) []byte {
	b := []byte(s)
	if len(b)%2 != 0 {
		b = append(b, 0x00)
	}
	return b
}
