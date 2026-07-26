(() => {
  const ZONE_META = {
    dmz: { title: "DMZ 入口" },
    clinical: { title: "臨床區" },
    integ: { title: "整合區" },
    imaging: { title: "影像區" },
    ot: { title: "OT 機房" },
    mgmt: { title: "管理區" },
  };

  const DETAIL_LABELS = {
    status: "狀態",
    cooling: "冷卻",
    last_scan: "最近掃描",
    studies: "掃描紀錄",
    device_id: "Device ID",
    source: "來源",
    last_write_peer: "最後寫入",
    message_count: "訊息數",
    worklist_count: "Worklist",
    name: "名稱",
    study_count: "Study 數",
    version: "版本",
    fhir_version: "FHIR",
    patient_count: "Patient 數",
    seed_version: "Seed",
    ssh: "SSH Port",
    reachable: "可連線",
    paralyzed: "已癱瘓",
    tools: "協議工具",
    marker: "標記檔",
  };

  const LAYOUT = {
    "vendor-entry": { gx: 1.15, gy: 1.0, h: 50, zone: "dmz", shape: "gate" },
    "biomed-ws": { gx: 3.05, gy: 1.35, h: 54, zone: "clinical", shape: "tower" },
    "ehr-fhir": { gx: 4.5, gy: 0.95, h: 46, zone: "clinical", shape: "server" },
    "hl7-engine": { gx: 2.15, gy: 3.05, h: 48, zone: "integ", shape: "server" },
    "ris-mwl": { gx: 3.65, gy: 3.2, h: 48, zone: "integ", shape: "server" },
    pacs: { gx: 5.65, gy: 2.75, h: 52, zone: "imaging", shape: "server" },
    "mri-sim": { gx: 6.9, gy: 3.55, h: 58, zone: "imaging", shape: "mri" },
    bms: { gx: 5.05, gy: 5.05, h: 44, zone: "ot", shape: "tower" },
    "chiller-sim": { gx: 6.5, gy: 5.4, h: 42, zone: "ot", shape: "chiller" },
    "protocol-runner": { gx: 3.85, gy: 5.2, h: 46, zone: "ot", shape: "server" },
    "reset-controller": { gx: 1.55, gy: 4.6, h: 42, zone: "mgmt", shape: "tower" },
  };

  const ZONE_PADS = [
    { zone: "dmz", gx: 0.35, gy: 0.25, w: 2.35, d: 2.05 },
    { zone: "clinical", gx: 2.4, gy: 0.15, w: 3.05, d: 2.2 },
    { zone: "integ", gx: 1.35, gy: 2.2, w: 3.25, d: 2.05 },
    { zone: "imaging", gx: 4.85, gy: 1.95, w: 3.25, d: 2.45 },
    { zone: "ot", gx: 3.2, gy: 4.2, w: 4.25, d: 2.25 },
    { zone: "mgmt", gx: 0.55, gy: 3.8, w: 2.2, d: 1.85 },
  ];

  const PIPE_PATHS = {
    clinical: [
      ["hl7-engine", "ris-mwl"],
      ["ris-mwl", "mri-sim"],
      ["mri-sim", "pacs"],
      ["pacs", "ehr-fhir"],
    ],
    cooling: [
      ["chiller-sim", "bms"],
      ["bms", "mri-sim"],
    ],
  };

  // Align iso grid with the diamond ground (center ≈ 600, 330).
  // Content centroid is roughly gx≈3.9, gy≈3.3 → offset (33.6, 201.6).
  const ORIGIN = { x: 566, y: 128 };
  const TILE = { w: 56, h: 28 };
  const HW = 27;
  const HD = 14;
  const SCENE_CENTER = { x: 600, y: 340 };

  let facilitiesById = {};
  let selectedId = null;
  let packetAnim = [];

  function iso(gx, gy) {
    return {
      x: ORIGIN.x + (gx - gy) * TILE.w,
      y: ORIGIN.y + (gx + gy) * TILE.h,
    };
  }

  /** After building geometry, nudge groups so bbox sits on the ground center. */
  function recenterContent() {
    const ids = ["zones", "buildings"];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const node = document.getElementById(id);
      if (!node || !node.children.length) continue;
      try {
        const b = node.getBBox();
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      } catch {
        /* ignore empty bbox */
      }
    }
    if (!Number.isFinite(minX)) return;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const dx = SCENE_CENTER.x - cx;
    const dy = SCENE_CENTER.y - cy;
    for (const id of ["zones", "pipes", "buildings", "packets", "fx"]) {
      const g = document.getElementById(id);
      if (g) g.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
    }
  }

  function isoBox(gx, gy, h, hw = HW, hd = HD) {
    const top = iso(gx, gy);
    return {
      origin: top,
      top: [
        [top.x, top.y - h],
        [top.x + hw, top.y - h + hd],
        [top.x, top.y - h + hd * 2],
        [top.x - hw, top.y - h + hd],
      ],
      left: [
        [top.x - hw, top.y - h + hd],
        [top.x, top.y - h + hd * 2],
        [top.x, top.y + hd * 2],
        [top.x - hw, top.y + hd],
      ],
      right: [
        [top.x, top.y - h + hd * 2],
        [top.x + hw, top.y - h + hd],
        [top.x + hw, top.y + hd],
        [top.x, top.y + hd * 2],
      ],
      shadow: [
        [top.x, top.y + hd * 2 + 4],
        [top.x + hw + 8, top.y + hd + 8],
        [top.x, top.y + hd * 2 + 18],
        [top.x - hw - 6, top.y + hd + 10],
      ],
      lamp: { x: top.x, y: top.y - h - 8 },
      label: { x: top.x, y: top.y + hd * 2 + 18 },
      center: { x: top.x, y: top.y - h * 0.45 + hd },
      hw,
      hd,
      h,
    };
  }

  function pts(arr) {
    return arr.map((p) => p.join(",")).join(" ");
  }

  function el(name, attrs = {}, parent = null) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "textContent") node.textContent = v;
      else node.setAttribute(k, String(v));
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function addWindows(group, box, rows = 2, cols = 2) {
    const { origin: o, h, hw, hd } = box;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ty0 = (r + 0.55) / (rows + 0.6);
        const ty1 = ty0 + 0.1 / rows;
        const tx0 = (c + 0.45) / (cols + 0.3);
        const tx1 = tx0 + 0.18 / cols;

        // left face parallelogram
        const l1 = [
          lerp(o.x - hw, o.x, tx0),
          lerp(o.y - h + hd, o.y + hd, ty0),
        ];
        const l2 = [
          lerp(o.x - hw, o.x, tx1),
          lerp(o.y - h + hd, o.y + hd, ty0),
        ];
        const l3 = [
          lerp(o.x - hw, o.x, tx1),
          lerp(o.y - h + hd, o.y + hd, ty1),
        ];
        const l4 = [
          lerp(o.x - hw, o.x, tx0),
          lerp(o.y - h + hd, o.y + hd, ty1),
        ];
        el("polygon", { class: "win", points: pts([l1, l2, l3, l4]) }, group);

        // right face parallelogram
        const r1 = [
          lerp(o.x, o.x + hw, tx0),
          lerp(o.y - h + hd, o.y + hd, ty0),
        ];
        const r2 = [
          lerp(o.x, o.x + hw, tx1),
          lerp(o.y - h + hd, o.y + hd, ty0),
        ];
        const r3 = [
          lerp(o.x, o.x + hw, tx1),
          lerp(o.y - h + hd, o.y + hd, ty1),
        ];
        const r4 = [
          lerp(o.x, o.x + hw, tx0),
          lerp(o.y - h + hd, o.y + hd, ty1),
        ];
        el("polygon", { class: "win", points: pts([r1, r2, r3, r4]), opacity: 0.7 }, group);
      }
    }
  }

  function addRoofAccent(group, box, shape) {
    const { origin: o, h, hw, hd } = box;
    if (shape === "mri") {
      // bore cylinder suggestion on roof
      el("ellipse", {
        class: "detail",
        cx: o.x,
        cy: o.y - h + hd,
        rx: hw * 0.45,
        ry: hd * 0.55,
        fill: "rgba(180, 240, 250, 0.2)",
        stroke: "rgba(180, 240, 250, 0.35)",
        "stroke-width": 1.2,
      }, group);
      el("ellipse", {
        class: "detail",
        cx: o.x,
        cy: o.y - h + hd,
        rx: hw * 0.22,
        ry: hd * 0.28,
        fill: "rgba(4, 20, 30, 0.65)",
      }, group);
    } else if (shape === "chiller") {
      for (let i = -1; i <= 1; i++) {
        el("ellipse", {
          class: "detail",
          cx: o.x + i * 10,
          cy: o.y - h + hd - 2,
          rx: 6,
          ry: 3.5,
          fill: "rgba(100, 200, 210, 0.25)",
          stroke: "rgba(140, 220, 230, 0.4)",
          "stroke-width": 1,
        }, group);
      }
    } else if (shape === "gate") {
      el("polygon", {
        class: "detail",
        points: pts([
          [o.x, o.y - h - 10],
          [o.x + 10, o.y - h + 2],
          [o.x, o.y - h + 8],
          [o.x - 10, o.y - h + 2],
        ]),
        fill: "rgba(100, 210, 220, 0.35)",
      }, group);
    } else if (shape === "server") {
      el("line", {
        class: "roof-line",
        x1: o.x - hw * 0.55,
        y1: o.y - h + hd,
        x2: o.x + hw * 0.55,
        y2: o.y - h + hd,
        stroke: "rgba(180, 240, 250, 0.35)",
        "stroke-width": 1.5,
      }, group);
    }
  }

  function buildZones() {
    const g = document.getElementById("zones");
    g.innerHTML = "";
    const lift = 10;
    for (const z of ZONE_PADS) {
      const a = iso(z.gx, z.gy);
      const b = iso(z.gx + z.w, z.gy);
      const c = iso(z.gx + z.w, z.gy + z.d);
      const d = iso(z.gx, z.gy + z.d);
      const zg = el("g", { class: "zone", "data-zone": z.zone }, g);

      // elevated pad sides
      el("polygon", {
        class: "zone-side-l",
        points: `${d.x},${d.y} ${c.x},${c.y} ${c.x},${c.y + lift} ${d.x},${d.y + lift}`,
      }, zg);
      el("polygon", {
        class: "zone-side-r",
        points: `${b.x},${b.y} ${c.x},${c.y} ${c.x},${c.y + lift} ${b.x},${b.y + lift}`,
      }, zg);
      el("polygon", {
        class: "zone-pad",
        points: `${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`,
      }, zg);

      const mid = iso(z.gx + 0.18, z.gy + 0.18);
      el("rect", {
        class: "zone-label-bg",
        x: mid.x - 4,
        y: mid.y - 14,
        width: ZONE_META[z.zone].title.length * 11 + 16,
        height: 18,
        rx: 2,
      }, zg);
      el("text", {
        class: "zone-label",
        x: mid.x + 4,
        y: mid.y - 1,
        textContent: ZONE_META[z.zone].title,
      }, zg);
    }
  }

  function buildBuildings() {
    const g = document.getElementById("buildings");
    g.innerHTML = "";
    const order = Object.entries(LAYOUT).sort(
      (a, b) => a[1].gx + a[1].gy - (b[1].gx + b[1].gy)
    );

    for (const [id, cfg] of order) {
      const hw = cfg.shape === "mri" ? 32 : cfg.shape === "chiller" ? 24 : HW;
      const hd = cfg.shape === "mri" ? 16 : HD;
      const box = isoBox(cfg.gx, cfg.gy, cfg.h, hw, hd);
      const group = el("g", {
        class: "facility level-offline",
        id: `fac-${id}`,
        "data-id": id,
        tabindex: "0",
        role: "button",
        "aria-label": id,
      }, g);

      el("polygon", {
        class: "detail",
        points: pts(box.shadow),
        fill: "rgba(0,0,0,0.35)",
      }, group);

      el("polygon", { class: "iso-base-l iso-body-l", points: pts(box.left) }, group);
      el("polygon", { class: "iso-base-r iso-body-r", points: pts(box.right) }, group);
      el("polygon", { class: "iso-top", points: pts(box.top) }, group);

      // subtle roof highlight edge
      el("polyline", {
        class: "detail",
        points: `${box.top[3][0]},${box.top[3][1]} ${box.top[0][0]},${box.top[0][1]} ${box.top[1][0]},${box.top[1][1]}`,
        fill: "none",
        stroke: "rgba(200,245,255,0.35)",
        "stroke-width": 1.2,
      }, group);

      addWindows(group, box, cfg.shape === "tower" ? 3 : 2, cfg.shape === "server" ? 3 : 2);
      addRoofAccent(group, box, cfg.shape);

      el("circle", {
        class: "lamp-ring",
        cx: box.lamp.x,
        cy: box.lamp.y,
        r: 9,
      }, group);
      el("circle", {
        class: "lamp",
        cx: box.lamp.x,
        cy: box.lamp.y,
        r: 4.5,
      }, group);

      el("ellipse", {
        class: "ring",
        cx: box.origin.x,
        cy: box.origin.y + box.hd,
        rx: hw + 10,
        ry: hd + 6,
      }, group);

      // larger hit target
      el("ellipse", {
        class: "hit",
        cx: box.origin.x,
        cy: box.origin.y - cfg.h * 0.3 + hd,
        rx: hw + 8,
        ry: cfg.h * 0.55,
      }, group);

      el("text", {
        class: "fac-label",
        x: box.label.x,
        y: box.label.y,
        textContent: id,
      }, group);
      el("text", {
        class: "fac-sub offline",
        id: `sub-${id}`,
        x: box.label.x,
        y: box.label.y + 13,
        textContent: "—",
      }, group);

      const activate = () => selectFacility(id);
      group.addEventListener("click", activate);
      group.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    }
  }

  function pipePath(from, to, kind) {
    const a = LAYOUT[from];
    const b = LAYOUT[to];
    const pa = isoBox(a.gx, a.gy, a.h).center;
    const pb = isoBox(b.gx, b.gy, b.h).center;
    const mid = {
      x: (pa.x + pb.x) / 2 + (kind === "cooling" ? 14 : -10),
      y: (pa.y + pb.y) / 2 + (kind === "cooling" ? -22 : 12),
    };
    return { d: `M ${pa.x} ${pa.y} Q ${mid.x} ${mid.y} ${pb.x} ${pb.y}`, pa, pb, mid };
  }

  function buildPipes() {
    const g = document.getElementById("pipes");
    g.innerHTML = "";
    for (const [kind, pairs] of Object.entries(PIPE_PATHS)) {
      pairs.forEach(([from, to], i) => {
        const { d } = pipePath(from, to, kind);
        el("path", {
          class: `pipe-glow ${kind}`,
          d,
          "data-from": from,
          "data-to": to,
        }, g);
        el("path", {
          class: `pipe ${kind}`,
          id: `pipe-${kind}-${i}`,
          d,
          "data-from": from,
          "data-to": to,
          "data-kind": kind,
        }, g);
      });
    }
  }

  function centerOf(id) {
    const cfg = LAYOUT[id];
    if (!cfg) return { x: 0, y: 0 };
    return isoBox(cfg.gx, cfg.gy, cfg.h).center;
  }

  function initPackets() {
    const g = document.getElementById("packets");
    g.innerHTML = "";
    packetAnim = [];
    let n = 0;
    for (const [kind, pairs] of Object.entries(PIPE_PATHS)) {
      pairs.forEach(([from, to]) => {
        // two particles per pipe for denser flow
        for (let k = 0; k < 2; k++) {
          const circle = el("circle", {
            class: `packet ${kind === "cooling" ? "cool" : ""}`,
            r: k === 0 ? 3.8 : 2.4,
            cx: 0,
            cy: 0,
          }, g);
          packetAnim.push({
            el: circle,
            from,
            to,
            kind,
            t: (Math.random() + k * 0.5) % 1,
            speed: kind === "cooling" ? 0.32 : 0.2,
          });
          n += 1;
        }
      });
    }
  }

  function tickPackets(dt) {
    const coolingAlarm =
      (facilitiesById["chiller-sim"] || {}).level === "alarm" ||
      (facilitiesById["bms"] || {}).level === "alarm";

    for (const p of packetAnim) {
      const aOnline = (facilitiesById[p.from] || {}).online;
      const bOnline = (facilitiesById[p.to] || {}).online;
      const active = aOnline && bOnline;
      p.el.style.display = active ? "block" : "none";
      if (!active) continue;

      const speed = p.kind === "cooling" && coolingAlarm ? p.speed * 2.4 : p.speed;
      p.t = (p.t + dt * speed) % 1;
      const a = centerOf(p.from);
      const b = centerOf(p.to);
      const { mid } = pipePath(p.from, p.to, p.kind);
      const t = p.t;
      // quadratic bezier
      const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mid.x + t * t * b.x;
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * mid.y + t * t * b.y;
      p.el.setAttribute("cx", x);
      p.el.setAttribute("cy", y);
      p.el.classList.toggle("alarm", p.kind === "cooling" && coolingAlarm);
    }
  }

  function subLabel(f) {
    if (!f.online && f.level === "offline") return "OFFLINE";
    const d = f.detail || {};
    if (f.id === "protocol-runner") {
      if (f.level === "alarm" || d.paralyzed || d.status === "PARALYZED") return "PARALYZED";
      return d.status || (f.online ? "ONLINE" : "OFFLINE");
    }
    if (!f.online) return "OFFLINE";
    if (f.id === "mri-sim") return d.status || "OK";
    if (f.id === "chiller-sim" || f.id === "bms") return d.status || d.cooling || "OK";
    if (f.id === "ris-mwl") return `WL ${d.worklist_count ?? 0}`;
    if (f.id === "hl7-engine") return `MSG ${d.message_count ?? 0}`;
    if (f.id === "pacs") return `STU ${d.study_count ?? 0}`;
    if (f.id === "ehr-fhir") return d.patient_count != null ? `PT ${d.patient_count}` : "OK";
    if (f.id === "reset-controller") return d.seed_version || "OK";
    return "ONLINE";
  }

  function setPipeState(selector, coolingAlarm) {
    document.querySelectorAll(selector).forEach((p) => {
      if (p.classList.contains("cooling")) {
        p.classList.toggle("alarm", coolingAlarm);
      }
      const from = p.dataset.from;
      const to = p.dataset.to;
      const on =
        (facilitiesById[from] || {}).online && (facilitiesById[to] || {}).online;
      p.classList.toggle("dim", !on);
    });
  }

  function applySnapshot(data) {
    facilitiesById = {};
    for (const f of data.facilities || []) {
      facilitiesById[f.id] = f;
      const node = document.getElementById(`fac-${f.id}`);
      if (!node) continue;
      node.classList.remove("level-ok", "level-alarm", "level-offline");
      node.classList.add(`level-${f.level || "offline"}`);
      node.classList.toggle("selected", f.id === selectedId);
      const sub = document.getElementById(`sub-${f.id}`);
      if (sub) {
        sub.textContent = subLabel(f);
        sub.className = `fac-sub ${f.level || "offline"}`;
      }
      const label = node.querySelector(".fac-label");
      if (label && f.label) label.textContent = f.label;
    }

    const coolingAlarm =
      (facilitiesById["chiller-sim"] || {}).level === "alarm" ||
      (facilitiesById["bms"] || {}).level === "alarm";

    setPipeState(".pipe, .pipe-glow", coolingAlarm);

    const s = data.summary || {};
    const chip = document.getElementById("liveChip");
    chip.classList.remove("err");
    document.getElementById("liveLink").innerHTML =
      '<span class="pulse-dot"></span> LIVE';
    document.getElementById("liveNodes").textContent =
      `${s.online ?? 0}/${s.total ?? 0}`;

    const coolEl = document.getElementById("liveCooling");
    coolEl.textContent = s.cooling || "—";
    coolEl.className = `hud-v mono ${s.cooling === "ALARM" ? "warn" : s.cooling === "NORMAL" ? "ok" : ""}`;

    const mriEl = document.getElementById("liveMri");
    mriEl.textContent = s.mri_status || "—";
    mriEl.className = `hud-v mono ${s.mri_status === "PROTECTIVE_STOP" ? "warn" : s.mri_status === "READY" ? "ok" : ""}`;

    if (selectedId && facilitiesById[selectedId]) {
      renderPanel(facilitiesById[selectedId]);
    }
  }

  function selectFacility(id) {
    selectedId = id;
    document.querySelectorAll(".facility").forEach((n) => {
      n.classList.toggle("selected", n.dataset.id === id);
    });
    const f = facilitiesById[id] || {
      id,
      label: id,
      zone: LAYOUT[id]?.zone || "",
      online: false,
      level: "offline",
      detail: {},
      links: [],
      ip: "",
    };
    renderPanel(f);
  }

  function setPanelOpen(open) {
    const panel = document.getElementById("panel");
    const backdrop = document.getElementById("panelBackdrop");
    panel.hidden = !open;
    if (backdrop) backdrop.hidden = !open;
    document.body.classList.toggle("panel-open", open);
    if (open) {
      panel.style.animation = "none";
      void panel.offsetWidth;
      panel.style.animation = "";
    }
  }

  function closePanel() {
    setPanelOpen(false);
    selectedId = null;
    document.querySelectorAll(".facility.selected").forEach((n) => {
      n.classList.remove("selected");
    });
  }

  function renderPanel(f) {
    setPanelOpen(true);

    document.getElementById("panelZone").textContent =
      ZONE_META[f.zone]?.title || f.zone || "";
    document.getElementById("panelTitle").textContent = f.label || f.id;

    const st = document.getElementById("panelStatus");
    st.className = `status-pill ${f.level || "offline"}`;
    st.textContent = {
      ok: "狀態正常",
      alarm: f.id === "protocol-runner" ? "協議工具已癱瘓" : "告警／保護停機",
      offline: "離線或無法連線",
    }[f.level] || f.level;

    const meta = document.getElementById("panelMeta");
    meta.innerHTML = "";
    const rows = [
      ["ID", f.id],
      ["IP", f.ip || "—"],
    ];
    const d = f.detail || {};
    for (const [k, v] of Object.entries(d)) {
      if (v == null || v === "") continue;
      rows.push([
        DETAIL_LABELS[k] || k,
        typeof v === "object" ? JSON.stringify(v) : String(v),
      ]);
    }
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      meta.appendChild(dt);
      meta.appendChild(dd);
    }

    const links = document.getElementById("panelLinks");
    links.innerHTML = "";
    for (const link of f.links || []) {
      const a = document.createElement("a");
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = link.label;
      links.appendChild(a);
    }
    if (!(f.links || []).length) {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = "此設施為 SSH 主機。請用對應 Host Port 連線（2221／2222／2223）。";
      links.appendChild(p);
    }
  }

  async function poll() {
    try {
      const r = await fetch("/api/snapshot", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      applySnapshot(await r.json());
    } catch (err) {
      const chip = document.getElementById("liveChip");
      chip.classList.add("err");
      document.getElementById("liveLink").innerHTML =
        '<span class="pulse-dot"></span> ERR';
      console.warn(err);
    }
  }

  function loop(ts) {
    if (!loop.last) loop.last = ts;
    const dt = Math.min(0.05, (ts - loop.last) / 1000);
    loop.last = ts;
    tickPackets(dt);
    requestAnimationFrame(loop);
  }

  document.getElementById("panelClose").addEventListener("click", closePanel);
  const backdrop = document.getElementById("panelBackdrop");
  if (backdrop) backdrop.addEventListener("click", closePanel);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  buildZones();
  buildPipes();
  buildBuildings();
  recenterContent();
  initPackets();
  poll();
  setInterval(poll, 2500);
  requestAnimationFrame(loop);
})();
