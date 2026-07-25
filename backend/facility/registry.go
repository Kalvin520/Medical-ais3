package facility

import (
	"med-target/simulator"
)

// ============================================================
// 設施註冊表 — 醫療設備教學靶機（各自一台獨立 PLC / Modbus Unit）
//
//   Unit 1  輸液幫浦病房 infusion  (GenericFacility)
//   Unit 2  核磁共振 MRI mri       (GenericFacility)
//
// 皆為資料驅動的模擬設備（暫存器映射 + 物理 + 故障規則 + 攻擊注入），
// 由通用引擎 GenericFacility 執行。僅供隔離教學環境使用。
// ============================================================

// BuildAll 建立全部醫療靶機設施。
func BuildAll() []simulator.Facility {
	return []simulator.Facility{
		simulator.NewInfusionPump(),
		simulator.NewMRISuite(),
	}
}
