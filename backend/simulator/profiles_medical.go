package simulator

import "math"

// ============================================================
// 醫療設備 Profile — AIS3 教學靶機（輸液幫浦病房 / 核磁共振 MRI 周邊 PLC）
//
// 每台設備 = 一台獨立 PLC，掛在各自的 Modbus Unit ID：
//   Unit 1  輸液幫浦病房 infusion  — 過量輸注 / 管路阻塞 / 空氣栓塞
//   Unit 2  核磁共振 MRI mri       — 磁體失超(quench) / SAR 超標 / 門禁互鎖失效
//
// 資料驅動（暫存器映射 + 物理 + 故障規則 + 攻擊注入），由通用引擎 GenericFacility 執行。
// 皆為「模擬」設備，僅供隔離教學環境練習模糊測試與 IEC 62443 合規演練。
// ============================================================

func clampF(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

// clampReg 將工程值×Scale 夾到 uint16 暫存器範圍（四捨五入）。
func clampReg(v float64) uint16 {
	if v < 0 {
		return 0
	}
	if v > 65535 {
		return 65535
	}
	return uint16(v + 0.5)
}

// ── Unit 1：輸液幫浦病房 IV Infusion Pump ─────────────────────
func NewInfusionPump() *GenericFacility {
	return NewGenericFacility(Profile{
		ID: "infusion", Name: "輸液幫浦病房", Unit: 1,
		Regs: []RegChannel{
			// 攻擊標的（可寫）
			{Key: "flowRate", Addr: 0, Scale: 1, Default: 100, Writable: true},   // 輸注速率 mL/h
			{Key: "drugConc", Addr: 1, Scale: 100, Default: 1.0, Writable: true}, // 藥物濃度 mg/mL
			{Key: "occlusionLimit", Addr: 2, Scale: 100, Default: 2.0, Writable: true}, // 阻塞警報閾值 bar
			// 衍生（唯讀）
			{Key: "deliveredVolume", Addr: 10, Scale: 1},
			{Key: "linePressure", Addr: 11, Scale: 100},
			{Key: "dropRate", Addr: 12, Scale: 1},
			{Key: "reservoirLevel", Addr: 13, Scale: 10},
			{Key: "doseRateBody", Addr: 14, Scale: 100},
			{Key: "batteryLevel", Addr: 15, Scale: 10},
			{Key: "airInLine", Addr: 16, Scale: 1},
		},
		Coils: []CoilChannel{
			{Key: "emergencyEnable", Addr: 0, Default: true},
			{Key: "pumpRun", Addr: 1, Default: true},
			{Key: "alarmSilence", Addr: 2, Default: false},
		},
		Failures: []FailureRule{
			{Key: "overdose", Channel: "doseRateBody", Limit: 8, Above: true, DelaySec: 3},
			{Key: "occlusion", Channel: "linePressure", Limit: 5, Above: true, DelaySec: 3},
			{Key: "airembolism", Channel: "airInLine", Limit: 50, Above: true, DelaySec: 3},
		},
		Attacks: []AttackAction{
			{Type: "overinfuse", Regs: map[int]uint16{0: 800}},
			{Type: "overconc", Regs: map[int]uint16{1: 1200}},
			{Type: "hidealarm", Regs: map[int]uint16{2: 900}, Coils: map[int]bool{2: true}},
			{Type: "all", Regs: map[int]uint16{0: 800, 1: 1200, 2: 900}, Coils: map[int]bool{1: true, 2: true}},
		},
		Annots: []WriteAnnotation{
			{Addr: 0, Scale: 1, Limit: 600, Above: true, Level: 4, Msg: "危險:輸注速率過高，恐藥物過量致病人危害"},
			{Addr: 1, Scale: 100, Limit: 8, Above: true, Level: 4, Msg: "危險:藥物濃度異常升高，恐劑量過量"},
			{Addr: 2, Scale: 100, Limit: 6, Above: true, Level: 4, Msg: "危險:阻塞警報閾值被調高，恐遮蔽管路阻塞警報"},
		},
		Physics: func(s map[string]float64, c map[string]bool, estop bool) {
			flowSet := s["flowRate"]
			conc := s["drugConc"]
			running := c["pumpRun"] && !estop

			flow := 0.0
			if running {
				flow = flowSet
			}

			// 累計輸注量（每 tick=100ms；flow 為 mL/h → mL/tick = flow/36000）
			s["deliveredVolume"] = clampF(s["deliveredVolume"]+flow/36000.0, 0, 5000)

			// 藥袋餘量：以 500mL 藥袋計，累計量耗盡即見底
			s["reservoirLevel"] = clampF(100-s["deliveredVolume"]/5.0, 0, 100)

			// 管路壓力：流速越高壓力越高（下游阻塞時逼近警報閾值）
			pressure := 0.0
			if running {
				pressure = 0.5 + (flow/100.0)*0.75
			}
			s["linePressure"] = clampF(pressure, 0, 8)

			// 滴速（20 drops/mL）
			s["dropRate"] = flow / 3.0

			// 每公斤劑量（成人 70kg）：過量的關鍵指標
			s["doseRateBody"] = flow * conc / 70.0

			// 空氣栓塞：藥袋見底且持續運轉 → 空氣進入管路
			if running && s["reservoirLevel"] <= 3 {
				s["airInLine"] = clampF(s["airInLine"]+2, 0, 200)
			} else {
				s["airInLine"] = clampF(s["airInLine"]-5, 0, 200)
			}

			// 電池（緩慢下降，僅視覺）
			if s["batteryLevel"] == 0 {
				s["batteryLevel"] = 100
			}
			s["batteryLevel"] = clampF(s["batteryLevel"]-0.002, 5, 100)
		},
	})
}

// ── Unit 2：核磁共振 MRI 周邊 PLC ─────────────────────────────
// MRI 影像走 DICOM；此 PLC 控制磁體冷卻/液氦/梯度/射頻/門禁互鎖等安全周邊。
func NewMRISuite() *GenericFacility {
	return NewGenericFacility(Profile{
		ID: "mri", Name: "核磁共振 MRI", Unit: 2,
		Regs: []RegChannel{
			// 攻擊標的（可寫）
			{Key: "coolingFlow", Addr: 0, Scale: 10, Default: 60, Writable: true}, // 磁體冷卻流量 L/min
			{Key: "rfPower", Addr: 1, Scale: 1, Default: 100, Writable: true},     // 射頻功率 % SAR
			{Key: "gradientDuty", Addr: 2, Scale: 1, Default: 70, Writable: true}, // 梯度線圈負載 %
			// 衍生（唯讀）
			{Key: "magnetTemp", Addr: 10, Scale: 100},
			{Key: "heliumLevel", Addr: 11, Scale: 10},
			{Key: "sarValue", Addr: 12, Scale: 100},
			{Key: "gradientTemp", Addr: 13, Scale: 10},
			{Key: "boreTemp", Addr: 14, Scale: 10},
			{Key: "quenchPressure", Addr: 15, Scale: 100},
			{Key: "fieldStrength", Addr: 16, Scale: 100},
			{Key: "doorBreach", Addr: 17, Scale: 1},
		},
		Coils: []CoilChannel{
			{Key: "emergencyEnable", Addr: 0, Default: true},
			{Key: "cryoCoolerRun", Addr: 1, Default: true},
			{Key: "doorInterlock", Addr: 2, Default: true}, // true=互鎖上鎖(安全)
		},
		Failures: []FailureRule{
			{Key: "quench", Channel: "magnetTemp", Limit: 6.0, Above: true, DelaySec: 3},
			{Key: "sarburn", Channel: "sarValue", Limit: 4.0, Above: true, DelaySec: 3},
			{Key: "projectile", Channel: "doorBreach", Limit: 0.5, Above: true, DelaySec: 3},
		},
		Attacks: []AttackAction{
			{Type: "stopcooling", Regs: map[int]uint16{0: 50}, Coils: map[int]bool{1: false}},
			{Type: "overrf", Regs: map[int]uint16{1: 200}},
			{Type: "unlockdoor", Coils: map[int]bool{2: false}},
			{Type: "all", Regs: map[int]uint16{0: 50, 1: 200}, Coils: map[int]bool{1: false, 2: false}},
		},
		Annots: []WriteAnnotation{
			{Addr: 0, Scale: 10, Limit: 15, Above: false, Level: 4, Msg: "危險:磁體冷卻流量過低，恐磁體失超(quench)"},
			{Addr: 1, Scale: 1, Limit: 150, Above: true, Level: 4, Msg: "危險:射頻功率超標，恐SAR過量致病人組織灼傷"},
			{Addr: 2, Scale: 1, Limit: 120, Above: true, Level: 4, Msg: "危險:梯度線圈負載過高，恐過熱"},
		},
		Physics: func(s map[string]float64, c map[string]bool, estop bool) {
			rf := s["rfPower"]
			grad := s["gradientDuty"]
			cooling := 0.0
			if c["cryoCoolerRun"] && !estop {
				cooling = s["coolingFlow"]
			}

			// 磁體溫度：冷卻不足即上升（額定 4.2K，>6K 失超）
			s["magnetTemp"] = clampF(4.2+math.Max(0, 30-cooling)*0.12+noiseScaled(0.05), 3.8, 20)

			// 液氦液位：磁體過熱時蒸發流失
			if s["magnetTemp"] > 5 {
				s["heliumLevel"] = clampF(s["heliumLevel"]-(s["magnetTemp"]-5)*0.15, 0, 100)
			} else {
				s["heliumLevel"] = clampF(s["heliumLevel"]+0.05, 0, 100)
			}

			// SAR（比吸收率）：射頻功率驅動（額定 2.0，>4 危險）
			s["sarValue"] = clampF(rf/50.0+noiseScaled(0.05), 0, 12)

			// 梯度線圈溫度 / 孔徑溫度
			s["gradientTemp"] = clampF(25+grad*0.4, 20, 120)
			s["boreTemp"] = clampF(22+grad*0.05+rf*0.03, 18, 60)

			// 失超排氣壓 / 磁場強度（失超時洩壓、磁場崩潰）
			s["quenchPressure"] = math.Max(0, (s["magnetTemp"]-6)*3)
			s["fieldStrength"] = clampF(3.0-math.Max(0, s["magnetTemp"]-6)*1.5, 0, 3.0)

			// 門禁互鎖失效 → 鐵磁投射物危害旗標
			if !c["doorInterlock"] {
				s["doorBreach"] = 1
			} else {
				s["doorBreach"] = 0
			}
		},
	})
}
