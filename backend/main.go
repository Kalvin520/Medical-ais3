package main

import (
	"encoding/json"
	"flag"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"med-target/facility"
	"med-target/medproto"
	"med-target/modbus"
	"med-target/simulator"
	"med-target/websocket"
)

const maxProxyResponseBytes = 4 << 20

// resolvePort 依優先順序決定監聽位址：1. 旗標  2. 環境變數  3. 預設。
func resolvePort(portFlag, envName, def string) string {
	if portFlag != "" {
		return "0.0.0.0:" + portFlag
	}
	if v := os.Getenv(envName); v != "" {
		return "0.0.0.0:" + v
	}
	return "0.0.0.0:" + def
}

// resolveHTTPAddr 依優先順序決定 HTTP/WebSocket 綁定位址：
// 1. -http-port 命令列旗標  2. HTTP_PORT 環境變數  3. 預設 8090
func resolveHTTPAddr(portFlag string) string {
	if portFlag != "" {
		return "0.0.0.0:" + portFlag
	}
	if envPort := os.Getenv("HTTP_PORT"); envPort != "" {
		return "0.0.0.0:" + envPort
	}
	return "0.0.0.0:8090"
}

// resolveModbusAddr 依優先順序決定 Modbus 綁定位址：
// 1. -modbus-port 旗標  2. MODBUS_PORT 環境變數  3. 自動探測 502→1502
func resolveModbusAddr(portFlag string) string {
	if portFlag != "" {
		return "0.0.0.0:" + portFlag
	}
	if envPort := os.Getenv("MODBUS_PORT"); envPort != "" {
		return "0.0.0.0:" + envPort
	}
	if l, err := net.Listen("tcp", "0.0.0.0:502"); err == nil {
		l.Close()
		return "0.0.0.0:502"
	}
	return "0.0.0.0:1502"
}

func resolveStaticDir() string {
	if envDir := os.Getenv("STATIC_DIR"); envDir != "" {
		if existsIndex(envDir) {
			return envDir
		}
	}

	exePath, err := os.Executable()
	if err == nil {
		exeDir := filepath.Dir(exePath)
		portableWeb := filepath.Join(exeDir, "web")
		if existsIndex(portableWeb) {
			return portableWeb
		}
	}

	devWeb := filepath.Join("..", "frontend", "dist")
	if existsIndex(devWeb) {
		return devWeb
	}

	return ""
}

func existsIndex(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "index.html"))
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func proxyHospitalRequest(client *http.Client, target string, method string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method != method {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), method, target, nil)
		if err != nil {
			http.Error(w, "invalid hospital service target", http.StatusInternalServerError)
			return
		}
		req.Header.Set("Accept", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "hospital service unavailable", http.StatusServiceUnavailable)
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.LimitReader(resp.Body, maxProxyResponseBytes))
	}
}

func spaFileServer(staticDir string) http.HandlerFunc {
	fileServer := http.FileServer(http.Dir(staticDir))

	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") || strings.HasPrefix(r.URL.Path, "/ws") {
			http.NotFound(w, r)
			return
		}

		relPath := strings.TrimPrefix(filepath.Clean(r.URL.Path), string(os.PathSeparator))
		requested := filepath.Join(staticDir, relPath)
		if info, err := os.Stat(requested); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}

		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	}
}

type facilityMeta struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	UnitID byte   `json:"unitId"`
}

func main() {
	modbusPortFlag := flag.String("modbus-port", "", "Modbus TCP `port` (env: MODBUS_PORT; 預設: 自動 502→1502)")
	httpPortFlag := flag.String("http-port", "", "HTTP/WebSocket `port` (env: HTTP_PORT; 預設: 8090)")
	hl7PortFlag := flag.String("hl7-port", "", "HL7 MLLP TCP `port` (env: HL7_PORT; 預設: 2575)")
	dicomPortFlag := flag.String("dicom-port", "", "DICOM TCP `port` (env: DICOM_PORT; 預設: 11112)")
	flag.Parse()

	httpBindAddr := resolveHTTPAddr(*httpPortFlag)
	modbusAddr := resolveModbusAddr(*modbusPortFlag)
	hl7Addr := resolvePort(*hl7PortFlag, "HL7_PORT", "2575")
	dicomAddr := resolvePort(*dicomPortFlag, "DICOM_PORT", "11112")
	_, modbusPort, _ := net.SplitHostPort(modbusAddr)
	hospitalSceneURL := strings.TrimRight(os.Getenv("HOSPITAL_SCENE_URL"), "/")
	if hospitalSceneURL == "" {
		hospitalSceneURL = "http://127.0.0.1:8101"
	}
	hospitalResetURL := strings.TrimRight(os.Getenv("HOSPITAL_RESET_URL"), "/")
	if hospitalResetURL == "" {
		hospitalResetURL = "http://127.0.0.1:8099"
	}
	hospitalClient := &http.Client{Timeout: 8 * time.Second}

	log.Println("醫療設備教學靶機 (AIS3 · 隔離環境專用) 啟動中...")

	// 建立所有設施（各自一台獨立 PLC / Modbus Unit）
	facilities := facility.BuildAll()
	devices := make(map[byte]simulator.Device, len(facilities))
	facByID := make(map[string]simulator.Facility, len(facilities))
	facList := make([]facilityMeta, 0, len(facilities))
	for _, f := range facilities {
		devices[f.UnitID()] = f
		facByID[f.ID()] = f
		facList = append(facList, facilityMeta{f.ID(), f.Name(), f.UnitID()})
		log.Printf("  • Unit %d  %s (%s)", f.UnitID(), f.Name(), f.ID())
	}

	broadcaster := websocket.NewBroadcaster()

	// Modbus TCP 伺服器（依 Unit ID 路由到對應設施）
	modbusServer := modbus.NewServer(devices, broadcaster)
	go func() {
		if err := modbusServer.Start(modbusAddr); err != nil {
			log.Fatalf("Modbus 伺服器啟動失敗 (%s): %v", modbusAddr, err)
		}
	}()

	// 醫療協定皮層（模糊測試靶：HL7/MLLP + 最小 DICOM 上層）——皆為模擬端點
	go func() {
		log.Printf("HL7/MLLP 伺服器啟動於 %s", hl7Addr)
		if err := medproto.StartHL7(hl7Addr); err != nil {
			log.Printf("HL7 伺服器結束: %v", err)
		}
	}()
	go func() {
		log.Printf("DICOM 伺服器啟動於 %s", dicomAddr)
		if err := medproto.StartDICOM(dicomAddr); err != nil {
			log.Printf("DICOM 伺服器結束: %v", err)
		}
	}()

	// 統一模擬循環：每 100ms 推進所有設施並廣播各自狀態
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			for _, f := range facilities {
				broadcaster.Broadcast(f.Step())
			}
		}
	}()

	// 由 ?facility= 取得設施，未指定則回退第一個（輸液幫浦病房）
	resolveFac := func(r *http.Request) simulator.Facility {
		if f, ok := facByID[r.URL.Query().Get("facility")]; ok {
			return f
		}
		return facilities[0]
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", broadcaster.HandleWebSocket)

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write(resolveFac(r).StatusJSON())
	})

	mux.HandleFunc("/api/attack", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == "POST" {
			resolveFac(r).SimulateAttack(r.URL.Query().Get("type"))
			w.Write([]byte(`{"status":"attack simulated"}`))
		}
	})

	mux.HandleFunc("/api/reset", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		resolveFac(r).Reset()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"facility reset"}`))
	})

	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		cfg, _ := json.Marshal(map[string]interface{}{
			"modbusPort": modbusPort,
			"modbusAddr": modbusAddr,
			"facilities": facList,
		})
		w.Write(cfg)
	})

	// 精準寫入解鎖 flag：學員把指定暫存器寫成指定值後，這裡才回傳該設施的 flag。
	mux.HandleFunc("/api/flag", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		fac := resolveFac(r)
		payload, _ := json.Marshal(map[string]interface{}{
			"facility": fac.ID(),
			"flags":    checkFlags(fac, flagRules[fac.ID()]),
		})
		w.Write(payload)
	})

	// 迷你虛擬醫院狀態聚合器與重置控制器。瀏覽器只連統一 Go 入口，
	// 不直接接觸 Docker 內部管理網段或實驗用憑證。
	mux.HandleFunc(
		"/api/hospital/snapshot",
		proxyHospitalRequest(hospitalClient, hospitalSceneURL+"/api/snapshot", http.MethodGet),
	)
	mux.HandleFunc(
		"/api/hospital/health",
		proxyHospitalRequest(hospitalClient, hospitalSceneURL+"/health", http.MethodGet),
	)
	mux.HandleFunc(
		"/api/hospital/reset",
		proxyHospitalRequest(hospitalClient, hospitalResetURL+"/reset", http.MethodPost),
	)

	staticDir := resolveStaticDir()
	if staticDir != "" {
		log.Printf("提供前端靜態檔案: %s", staticDir)
		mux.HandleFunc("/", spaFileServer(staticDir))
	} else {
		log.Println("未找到前端靜態檔，僅啟用 API 與 WebSocket")
	}

	go func() {
		log.Printf("HTTP/WebSocket 伺服器啟動於 %s", httpBindAddr)
		if err := http.ListenAndServe(httpBindAddr, mux); err != nil {
			log.Fatalf("HTTP 伺服器啟動失敗: %v", err)
		}
	}()

	log.Println("系統啟動完成!")
	log.Printf("Modbus TCP: %s (Unit 1-%d)", modbusAddr, len(facilities))
	log.Printf("HL7/MLLP: %s   DICOM: %s", hl7Addr, dicomAddr)
	log.Printf("WebSocket: ws://%s/ws", httpBindAddr)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("系統關閉中...")
	modbusServer.Stop()
}
