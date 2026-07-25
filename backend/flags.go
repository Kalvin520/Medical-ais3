package main

import "med-target/simulator"

// ============================================================
// 精準寫入解鎖 Flag（線圈版）
//
// 學員用 Modbus 把「指定線圈」設成「指定 ON/OFF 組合」，工廠才解鎖並吐出 flag。
// 讀取方式：GET /api/flag?facility=<id> → {"facility":..,"flags":[..]}
//   - rule 的所有條件(conds)當前皆符合 → 該 flag 出現；否則不出現（即時判定）。
//
// 使用「專用解鎖線圈」Coil10 以上（Coil0-2/3 才是物理控制線圈）：
//   - Coil10+ 不受物理影響、預設 OFF、寫入不會引爆。
//   - 條件都要求某線圈=ON（非預設），避免一開始就被誤判為解鎖。
// ============================================================

type flagCond struct {
	coil uint16 // 線圈位址
	want bool   // 期望狀態（本設計皆為 true=ON）
}

type flagRule struct {
	conds []flagCond
	flag  string
}

// facility id → 解鎖規則（醫療靶機）
var flagRules = map[string][]flagRule{
	"infusion": {
		{conds: []flagCond{{10, true}}, flag: "FLAG{coil10_on_infusion_a3f19c}"},
		{conds: []flagCond{{12, true}, {13, true}}, flag: "FLAG{coils_12_13_infusion_5e0b74}"},
	},
	"mri": {
		{conds: []flagCond{{11, true}}, flag: "FLAG{coil11_on_mri_d47a2e}"},
		{conds: []flagCond{{14, true}, {15, true}}, flag: "FLAG{coils_14_15_mri_9c1f83}"},
	},
}

// checkFlags 依當前線圈狀態回傳已解鎖的 flag。
func checkFlags(dev simulator.Device, rules []flagRule) []string {
	out := []string{}
	for _, r := range rules {
		ok := true
		for _, c := range r.conds {
			if dev.ReadCoil(c.coil) != c.want {
				ok = false
				break
			}
		}
		if ok {
			out = append(out, r.flag)
		}
	}
	return out
}
