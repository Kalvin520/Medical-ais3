package simulator

import (
	"encoding/json"
	"math/rand"
	"sync"
	"time"
)

// ============================================================
// 多廠區數位孿生 — 設施抽象層
//
// 每台醫療設備 = 一台獨立 PLC，掛在各自的 Modbus Unit ID 上：
//   Unit 1 輸液幫浦病房 infusion
//   Unit 2 核磁共振 MRI mri
//
// 設備以「資料驅動」的 Profile 描述（暫存器映射 + 物理 + 故障規則 +
// 攻擊注入），由通用引擎 GenericFacility 執行。
// ============================================================

// Device — Modbus 暫存器/線圈最小存取介面（供 modbus 套件路由，與設施邏輯解耦）
type Device interface {
	ReadRegister(addr uint16) uint16
	WriteRegister(addr uint16, value uint16)
	ReadCoil(addr uint16) bool
	WriteCoil(addr uint16, value bool)
	// AnnotateWrite 回報一次寫入是否可疑（level>0 表示需廣播警報）
	AnnotateWrite(addr uint16, value uint16) (level int, msg string)
}

// Facility — 一個被模擬的工業設施（一台 PLC）。
// 由 GenericFacility 實作。
type Facility interface {
	Device
	ID() string
	Name() string
	UnitID() byte
	// Step 推進一個 tick（100ms）並回傳 WebSocket 廣播用 JSON
	// （{type:"status", facility:<id>, status:{...}}）
	Step() []byte
	// StatusJSON 目前狀態 JSON（REST 用），同樣帶 facility 標記
	StatusJSON() []byte
	SimulateAttack(attackType string)
	Reset()
}

// ── 資料驅動 Profile 型別 ──────────────────────────────────

// RegChannel 對應一個 Modbus 保持暫存器的遙測通道。
type RegChannel struct {
	Key      string  // JSON 鍵
	Addr     int     // 保持暫存器位址
	Scale    float64 // 暫存器值 = 工程值 × Scale（例：100 → 2 位小數）
	Default  float64
	Writable bool // true：攻擊標的（RW，外部寫入後鎖定）；false：衍生唯讀輸出
}

// CoilChannel 對應一個布林控制線圈。
type CoilChannel struct {
	Key     string
	Addr    int
	Default bool
}

// FailureRule 門檻持續超限 → 觸發故障/爆炸。
type FailureRule struct {
	Key      string  // 故障 id（前端對應特效），例：beltjam
	Channel  string  // 監看的通道 key
	Limit    float64 //
	Above    bool    // true：值 ≥ Limit 觸發；false：值 ≤ Limit 觸發
	DelaySec float64 // 持續多久才爆
}

// AttackAction 模擬攻擊時要寫入的暫存器/線圈。
type AttackAction struct {
	Type  string
	Regs  map[int]uint16
	Coils map[int]bool
}

// WriteAnnotation 對某暫存器寫入的可疑判定。
type WriteAnnotation struct {
	Addr  int
	Limit float64 // 比較工程值（value/Scale）
	Above bool
	Level int
	Msg   string // 警報文字（不含值，引擎會附帶數值）
	Scale float64
}

// Profile 一個設施的完整資料描述。
type Profile struct {
	ID, Name string
	Unit     byte
	Regs     []RegChannel
	Coils    []CoilChannel
	Failures []FailureRule
	Attacks  []AttackAction
	Annots   []WriteAnnotation
	// Physics：每 tick 推進自然漂移 + 推導衍生遙測。
	// state 帶所有通道值（工程單位），coils 帶線圈狀態，estop 為緊急停機。
	// 直接就地修改 state（衍生通道與寫入通道的微噪聲）。
	Physics func(state map[string]float64, coils map[string]bool, estop bool)
}

// ── 通用設施引擎 ──────────────────────────────────────────

type GenericFacility struct {
	mu      sync.RWMutex
	profile Profile

	regByKey  map[string]RegChannel
	coilByKey map[string]CoilChannel

	state map[string]float64 // 通道工程值（writable + derived）
	coils map[string]bool

	holding  [256]uint16
	coilBits [256]bool
	locked   [256]bool // 被外部 Modbus 寫入鎖定的暫存器

	failStart    map[string]time.Time
	isFailing    bool
	failureType  string
	alertLevel   int
	alertMessage string
}

// NewGenericFacility 由 Profile 建立通用設施引擎。
func NewGenericFacility(p Profile) *GenericFacility {
	f := &GenericFacility{
		profile:     p,
		regByKey:    make(map[string]RegChannel, len(p.Regs)),
		coilByKey:   make(map[string]CoilChannel, len(p.Coils)),
		state:       make(map[string]float64, len(p.Regs)),
		coils:       make(map[string]bool, len(p.Coils)),
		failStart:   make(map[string]time.Time),
		failureType: "none",
	}
	for _, c := range p.Regs {
		f.regByKey[c.Key] = c
		f.state[c.Key] = c.Default
	}
	for _, c := range p.Coils {
		f.coilByKey[c.Key] = c
		f.coils[c.Key] = c.Default
	}
	f.syncToRegisters()
	f.syncCoilsToBits()
	return f
}

func (f *GenericFacility) ID() string   { return f.profile.ID }
func (f *GenericFacility) Name() string { return f.profile.Name }
func (f *GenericFacility) UnitID() byte { return f.profile.Unit }

func (f *GenericFacility) enableKey() string {
	// 約定：名稱為 "emergencyEnable" / "enable" 的線圈為「運轉允許」
	// （true=運轉允許, false=急停）。
	for _, c := range f.profile.Coils {
		if c.Key == "emergencyEnable" || c.Key == "enable" {
			return c.Key
		}
	}
	return ""
}

func (f *GenericFacility) syncToRegisters() {
	for _, c := range f.profile.Regs {
		if c.Addr < 0 || c.Addr >= len(f.holding) {
			continue
		}
		if c.Writable && f.locked[c.Addr] {
			continue // 攻擊鎖定值，保留
		}
		f.holding[c.Addr] = clampReg(f.state[c.Key] * c.Scale)
	}
}

func (f *GenericFacility) syncCoilsToBits() {
	for _, c := range f.profile.Coils {
		if c.Addr >= 0 && c.Addr < len(f.coilBits) {
			f.coilBits[c.Addr] = f.coils[c.Key]
		}
	}
}

func (f *GenericFacility) syncFromRegisters() {
	for _, c := range f.profile.Regs {
		if !c.Writable || c.Addr < 0 || c.Addr >= len(f.holding) {
			continue
		}
		f.state[c.Key] = float64(f.holding[c.Addr]) / c.Scale
	}
	for _, c := range f.profile.Coils {
		if c.Addr >= 0 && c.Addr < len(f.coilBits) {
			f.coils[c.Key] = f.coilBits[c.Addr]
		}
	}
}

// applyLocked 強制把攻擊鎖定的寫入通道回填，避免物理在同 tick 蓋掉攻擊值。
func (f *GenericFacility) applyLocked() {
	for _, c := range f.profile.Regs {
		if c.Writable && c.Addr >= 0 && c.Addr < len(f.holding) && f.locked[c.Addr] {
			f.state[c.Key] = float64(f.holding[c.Addr]) / c.Scale
		}
	}
}

func (f *GenericFacility) checkFailures() {
	now := time.Now()
	estop := false
	if k := f.enableKey(); k != "" {
		estop = !f.coils[k] // 未啟用 = 急停
	}
	for _, r := range f.profile.Failures {
		v := f.state[r.Channel]
		over := (r.Above && v >= r.Limit) || (!r.Above && v <= r.Limit)
		if over && !estop {
			if start, ok := f.failStart[r.Key]; ok {
				if now.Sub(start).Seconds() >= r.DelaySec {
					f.isFailing = true
					f.failureType = r.Key
					f.alertLevel = 4
					f.alertMessage = "偵測到故障: " + r.Key
				}
			} else {
				f.failStart[r.Key] = now
			}
		} else {
			delete(f.failStart, r.Key)
		}
	}
	if !f.isFailing && f.alertLevel > 0 {
		f.alertLevel--
		if f.alertLevel == 0 {
			f.alertMessage = ""
			f.failureType = "none"
		}
	}
}

// Step 推進一個 tick 並回傳 WS JSON。
func (f *GenericFacility) Step() []byte {
	f.mu.Lock()
	f.syncFromRegisters()

	estop := false
	if k := f.enableKey(); k != "" {
		estop = !f.coils[k] // 未啟用 = 急停
	}
	if f.profile.Physics != nil {
		f.profile.Physics(f.state, f.coils, estop)
	}
	f.applyLocked()
	f.checkFailures()
	f.syncToRegisters()

	payload := f.buildStatus()
	f.mu.Unlock()

	msg, _ := json.Marshal(map[string]interface{}{
		"type":     "status",
		"facility": f.profile.ID,
		"status":   payload,
	})
	return msg
}

// buildStatus 組出狀態物件（呼叫者需持有鎖）。
func (f *GenericFacility) buildStatus() map[string]interface{} {
	m := make(map[string]interface{}, len(f.state)+len(f.coils)+4)
	for k, v := range f.state {
		m[k] = round2(v)
	}
	for k, v := range f.coils {
		m[k] = v
	}
	m["isUnderAttack"] = f.isFailing
	m["explosionType"] = f.failureType
	m["alertLevel"] = f.alertLevel
	m["alertMessage"] = f.alertMessage
	return m
}

func (f *GenericFacility) StatusJSON() []byte {
	f.mu.RLock()
	defer f.mu.RUnlock()
	msg, _ := json.Marshal(map[string]interface{}{
		"type":     "status",
		"facility": f.profile.ID,
		"status":   f.buildStatus(),
	})
	return msg
}

func (f *GenericFacility) SimulateAttack(attackType string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range f.profile.Attacks {
		if a.Type != attackType {
			continue
		}
		for addr, val := range a.Regs {
			if addr >= 0 && addr < len(f.holding) {
				f.holding[addr] = val
				f.locked[addr] = true
			}
		}
		for addr, val := range a.Coils {
			if addr >= 0 && addr < len(f.coilBits) {
				f.coilBits[addr] = val
			}
		}
	}
}

func (f *GenericFacility) Reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.profile.Regs {
		f.state[c.Key] = c.Default
	}
	for _, c := range f.profile.Coils {
		f.coils[c.Key] = c.Default
	}
	f.holding = [256]uint16{}
	f.coilBits = [256]bool{}
	f.locked = [256]bool{}
	f.failStart = make(map[string]time.Time)
	f.isFailing = false
	f.failureType = "none"
	f.alertLevel = 0
	f.alertMessage = ""
	f.syncToRegisters()
	f.syncCoilsToBits()
}

// ── Device 介面：Modbus 暫存器/線圈存取 ──

func (f *GenericFacility) ReadRegister(addr uint16) uint16 {
	f.mu.RLock()
	defer f.mu.RUnlock()
	if int(addr) < len(f.holding) {
		return f.holding[addr]
	}
	return 0
}

func (f *GenericFacility) WriteRegister(addr uint16, value uint16) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if int(addr) < len(f.holding) {
		f.holding[addr] = value
		f.locked[addr] = true
	}
}

func (f *GenericFacility) ReadCoil(addr uint16) bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	if int(addr) < len(f.coilBits) {
		return f.coilBits[addr]
	}
	return false
}

func (f *GenericFacility) WriteCoil(addr uint16, value bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if int(addr) < len(f.coilBits) {
		f.coilBits[addr] = value
	}
}

func (f *GenericFacility) AnnotateWrite(addr uint16, value uint16) (int, string) {
	for _, a := range f.profile.Annots {
		if a.Addr != int(addr) {
			continue
		}
		scale := a.Scale
		if scale == 0 {
			scale = 1
		}
		v := float64(value) / scale
		if (a.Above && v > a.Limit) || (!a.Above && v < a.Limit) {
			return a.Level, a.Msg
		}
	}
	return 0, ""
}

// round2 四捨五入到 2 位小數，避免 JSON 出現浮點雜訊。
func round2(v float64) float64 {
	return float64(int64(v*100+0.5*sign(v))) / 100
}
func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

// noiseScaled 提供 profile physics 使用的小幅隨機（避免在 profile 內各自 import rand）。
func noiseScaled(amp float64) float64 {
	return (rand.Float64() - 0.5) * 2 * amp
}
