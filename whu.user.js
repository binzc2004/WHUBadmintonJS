// ==UserScript==
// @name         羽毛球预约-原地接管(UI调节延迟版)
// @namespace    http://tampermonkey.net/
// @version      2026-04-04
// @description  杀死原请求+可调睡眠时间+完整UI配置+详细日志监控
// @author       Gemini
// @match        *://gym.whu.edu.cn/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/binzc2004/WHUBadmintonJS/main/whu.user.js
// @updateURL    https://raw.githubusercontent.com/binzc2004/WHUBadmintonJS/main/whu.user.js
// ==/UserScript==
(function() {
    'use strict';

    // --- 1. 核心状态与配置 ---
    let isDevMode = false;
    let globalSleepTime = 1500; // 默认 2000ms
    const timeOrder = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

     // --- 1. 初始化配置与默认值 ---
    const getTomorrowDate = () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
    };

    const tomorrow = getTomorrowDate();
    const targetInfo = {
        appointmentStartDate: `${tomorrow} 19:00`,
        appointmentEndDate: `${tomorrow} 21:00`,
        stadiumsAreaId: "3", // 卓尔
        stadiumsAreaNo: "3"
    };

    // --- 2. 增强型监控小窗 ---
    function showLog(msg, type = 'info') {
        let monitor = document.getElementById('whu-monitor');
        if (!monitor && document.body) {
            monitor = document.createElement('div');
            monitor.id = 'whu-monitor';
            monitor.style = `position:fixed; top:15%; left:50%; transform:translateX(-50%); width:90%; max-height:28%; background:rgba(0,0,0,0.85); color:#00ff00; z-index:2147483647; padding:10px; border-radius:10px; font-size:11px; pointer-events:none; border:1px solid #444; overflow-y:auto; box-shadow:0 0 10px rgba(0,255,0,0.2);`;
            document.body.appendChild(monitor);
        }
        if (monitor) {
            const item = document.createElement('div');
            const colors = { 'info': '#00ff00', 'warn': '#f1c40f', 'error': '#e74c3c', 'success': '#2ecc71' };
            item.style.color = colors[type] || '#00ff00';
            item.style.marginBottom = '2px';
            item.textContent = `[${new Date().toLocaleTimeString().split(' ')[0]}] ${msg}`;
            monitor.appendChild(item);
            monitor.scrollTop = monitor.scrollHeight;
            if (monitor.childNodes.length > 12) monitor.removeChild(monitor.firstChild);
        }
    }

    // --- 3. 核心接管逻辑 ---
    async function startExclusiveHeist(headers, bodyStr) {
        showLog("脚本版本v1.0.0");
        showLog("!!! 原始请求已杀死，脚本接管成功 !!!", "warn");

        let vToken = "";
        try {
            vToken = JSON.parse(bodyStr).VerifyToken;
            showLog(`取得唯一令牌: ${vToken.slice(0,8)}...`);
        } catch(e) { showLog("Token解析异常", "error"); return; }

        if (!isDevMode) {
            const targetTime = new Date();
            targetTime.setHours(17, 59, 59, 0);
            if (new Date() < targetTime) {
                showLog(`定时模式：等待 17:59:59 开闸...`, "warn");
                while (new Date() < targetTime) await sleep(500);
            }
        }

        showLog("正在全速抓取 WDToken...", "warn");
        const wdRes = await pollWDToken(headers);

        if (wdRes) {
            showLog(`WDToken 捕获成功！准备最终提交`, "success");

            // --- 使用 UI 设定的睡眠时间 ---
            showLog(`执行安全睡眠 ${globalSleepTime}ms (自定义延迟)...`, "warn");
            await sleep(globalSleepTime);

            smartOrderFlexible(targetInfo, wdRes.info);
            sendFinalOrder(headers, vToken, wdRes.WDToken);
        }
    }
    function smartOrderFlexible(info, response) {
        const times = response.AppointmentTimes;
        console.log(times);
        if (!times || times.length === 0) {
            showLog("❌ 无可用预约时段数据", "error");
            return;
        }

        // 提取首选时间
        const [prefDate, prefTime] = info.appointmentStartDate.split(" "); // "YYYY-MM-DD" 和 "HH:mm"

        // 先看首选时间是否有空位
        const exactMatch = times.find(t => t.StartTime === prefTime && t.RemainingCapacity > 0);
        if (exactMatch) return; // 有空位，不需要调整

        // 找所有有空位的时段
        const availableTimes = times.filter(t => t.RemainingCapacity > 0);
        if (availableTimes.length === 0) {
            showLog(`❌ 首选时间段 ${prefTime} 无空位，且没有其他可用时间段`, "error");
            return; // 没有空位，直接返回
        }

        // 找最接近首选时间的时段
        const prefMinutes = prefTime.split(":").reduce((h,m)=>h*60+parseInt(m),0);
        let closest = availableTimes[0];
        let minDiff = Math.abs(prefMinutes - closest.StartTime.split(":").reduce((h,m)=>h*60+parseInt(m),0));

        for (let t of availableTimes) {
            const tMinutes = t.StartTime.split(":").reduce((h,m)=>h*60+parseInt(m),0);
            const diff = Math.abs(prefMinutes - tMinutes);
            if (diff < minDiff) {
                closest = t;
                minDiff = diff;
            }
        }

        // 更新 info 为自动调优时间
        info.appointmentStartDate = `${prefDate} ${closest.StartTime}`;
        info.appointmentEndDate = `${prefDate} ${closest.EndTime}`;
        showLog(`首选时段无位，自动调优到: ${closest.StartTime}~${closest.EndTime}`, "warn");
    }
    async function pollWDToken(headers) {
        const url = `https://gym.whu.edu.cn/api/GSStadiums/GetAppointmentDetail?Version=3&StadiumsAreaId=${targetInfo.stadiumsAreaId}&StadiumsAreaNo=${targetInfo.stadiumsAreaNo}&AppointmentDate=${targetInfo.appointmentStartDate.slice(0,10)}`;
        let count = 0;
        let delay=800;
        let minDelay=200;
        let decay=0.6;
        
        while (true) {
            count++;
            try {
                const r = await fetch(url, { headers });
                const d = await r.json();
                if (d.success && d.WDToken) return { WDToken: d.WDToken, info: d.response };
            } catch(e) {}
            showLog(`轮询中(累计 ${count} 次)...`);
            await sleep(delay);
            delay = Math.max(minDelay, delay * decay);
        }
    }

    function sendFinalOrder(headers, vToken, wdToken) {
        const data = {
            version: 4,
            stadiumsAreaId: targetInfo.stadiumsAreaId,
            stadiumsAreaNo: targetInfo.stadiumsAreaNo,
            appointmentStartDate: targetInfo.appointmentStartDate,
            appointmentEndDate: targetInfo.appointmentEndDate,
            source: 20,
            VerifyToken: vToken,
            WDVerifyToken: wdToken,
            f_notify: "https://gym.whu.edu.cn/hsdsqhafive/pages/order/success?type=3"
        };

        const startTime = performance.now(); // 请求发出时间（高精度）
        const startDate = new Date(); // 可打印的时间点
        showLog(`⏱ 请求发出时间: ${startDate.toLocaleTimeString()}.${startDate.getMilliseconds()}`, "info");

        fetch("https://gym.whu.edu.cn/api/GSOrder/Create", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(r => r.json())
            .then(res => {
            const endTime = performance.now(); // 请求返回时间（高精度）
            const endDate = new Date();
            const elapsed = endTime - startTime; // 总耗时，单位 ms

            showLog(`⏱ 响应接收时间: ${endDate.toLocaleTimeString()}.${endDate.getMilliseconds()}`, "info");
            showLog(`⏱ 总耗时: ${elapsed.toFixed(2)} ms`, "info");

            if (res.success) {
                showLog("✅ 预约成功！正在跳转...", "success");
                alert(`抢票成功！\n请尽快完成支付。`);
            } else {
                showLog(`❌ 下单失败: ${res.msg}`, "error");
                alert(`失败原因: ${res.msg}`);
            }
        })
            .catch(err => {
            showLog(`❌ 请求异常: ${err}`, "error");
        });
    }

    // --- 4. UI 模块 (包含 SleepTime 调节) ---
    function injectUI() {
        if (document.getElementById('whu-cfg-btn')) return;

        const style = document.createElement('style');
        style.textContent = `
            #whu-cfg-btn { position: fixed; top: 60px; right: 20px; z-index: 2147483647; padding: 10px 18px; background: #1a73e8; color: #fff; border: 2px solid #fff; border-radius: 8px; font-size: 14px; font-weight: bold; }
            #whu-modal-bg { display: none; position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; }
            #whu-modal { background: #fff; border-radius: 12px; padding: 20px; width: 85%; max-width: 400px; max-height: 90vh; overflow-y: auto; color: #333; }
            .whu-grid { display: grid; gap: 8px; margin-bottom: 15px; }
            .whu-grid-3 { grid-template-columns: repeat(3, 1fr); }
            .whu-grid-6 { grid-template-columns: repeat(6, 1fr); }
            .whu-btn { padding: 8px 2px; border: 1px solid #ddd; border-radius: 6px; background: #f9f9f9; font-size: 12px; }
            .whu-btn.selected { background: #e8f0fe; color: #1a73e8; border: 2px solid #1a73e8; font-weight: bold; }
            .whu-input-group { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; }
            .whu-input-group label { font-size: 12px; color: #666; white-space: nowrap; }
            .whu-input-group input { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 6px; }
            #whu-toast { display: none; position: fixed; bottom: 80px; left: 24px; z-index: 2147483648; padding: 10px 16px; background: #323232; color: #fff; border-radius: 8px; font-size: 13px; }
        `;
        document.head.appendChild(style);

        const btn = document.createElement('button');
        btn.id = 'whu-cfg-btn'; btn.textContent = '⚙ 预约参数配置';
        btn.onclick = openModal; document.body.appendChild(btn);

        const bg = document.createElement('div');
        bg.id = 'whu-modal-bg';
        bg.innerHTML = `
            <div id="whu-modal">
                <h3 style="margin-top:0">抢票参数设置</h3>

                <label style="font-size:12px;color:#666">场馆选择</label>
                <div class="whu-grid whu-grid-3" id="v-grid">
                    <button class="whu-btn" data-id="6">工学部</button><button class="whu-btn" data-id="5">竹园</button>
                    <button class="whu-btn" data-id="4">星湖</button><button class="whu-btn" data-id="3">卓尔</button>
                    <button class="whu-btn" data-id="2">风雨</button><button class="whu-btn" data-id="1">医学</button>
                </div>

                <label style="font-size:12px;color:#666">场地号</label>
                <div class="whu-grid whu-grid-6" id="a-grid"></div>

                <div class="whu-input-group">
                    <label>预约日期:</label>
                    <input type="date" id="whu-date">
                </div>

                <div class="whu-input-group">
                    <label>延迟提交(ms):</label>
                    <input type="number" id="whu-sleep" value="1500" step="100">
                </div>

                <label style="font-size:12px;color:#666">时段选择 (可多选相邻)</label>
                <div class="whu-grid whu-grid-3" id="t-grid">
                    ${timeOrder.map(t => `<button class="whu-btn" data-start="${t}">${t}</button>`).join('')}
                </div>

                <div id="whu-summary" style="background:#f0f0f0; padding:10px; border-radius:6px; font-size:12px; margin-bottom:15px; border-left:4px solid #1a73e8; line-height:1.4;">-</div>
                <button id="whu-save" style="width:100%; padding:12px; background:#1a73e8; color:#fff; border:none; border-radius:6px; font-weight:bold;">锁定配置</button>
            </div>
        `;
        document.body.appendChild(bg);
        const toast = document.createElement('div'); toast.id = 'whu-toast'; document.body.appendChild(toast);

        document.getElementById('whu-save').onclick = confirmConfig;
        bg.onclick = (e) => { if(e.target === bg) closeModal(); };
    }

    let uiTimes = [];
    function openModal() {
        document.getElementById('whu-modal-bg').style.display = 'flex';
        document.getElementById('whu-date').value = targetInfo.appointmentStartDate.slice(0, 10);
        document.getElementById('whu-sleep').value = globalSleepTime;
        const startT = targetInfo.appointmentStartDate.slice(11);
        const endT = targetInfo.appointmentEndDate.slice(11);
        uiTimes = timeOrder.filter(t => t >= startT && t < endT);
        refreshUI();
    }
    function closeModal() { document.getElementById('whu-modal-bg').style.display = 'none'; }

    function refreshUI() {
        document.querySelectorAll('#v-grid .whu-btn').forEach(b => {
            b.classList.toggle('selected', b.dataset.id === targetInfo.stadiumsAreaId);
            b.onclick = () => { targetInfo.stadiumsAreaId = b.dataset.id; targetInfo.stadiumsAreaNo = "1"; refreshUI(); };
        });
        const aGrid = document.getElementById('a-grid'); aGrid.innerHTML = '';
        const max = {6:8, 5:6, 4:6, 3:8, 2:6, 1:6}[targetInfo.stadiumsAreaId] || 6;
        for (let i = 1; i <= max; i++) {
            const b = document.createElement('button'); b.className = 'whu-btn' + (String(i) === targetInfo.stadiumsAreaNo ? ' selected' : '');
            b.textContent = i; b.onclick = () => { targetInfo.stadiumsAreaNo = String(i); refreshUI(); };
            aGrid.appendChild(b);
        }
        document.querySelectorAll('#t-grid .whu-btn').forEach(b => {
            const t = b.dataset.start; b.classList.toggle('selected', uiTimes.includes(t));
            b.onclick = () => {
                if (uiTimes.includes(t)) {
                    if (uiTimes.length > 1) uiTimes = uiTimes.filter(x => x !== t);
                } else {
                    const idx = timeOrder.indexOf(t);
                    if (uiTimes.length >= 2) uiTimes = [t];
                    else if (uiTimes.length === 1 && Math.abs(timeOrder.indexOf(uiTimes[0]) - idx) !== 1) uiTimes = [t];
                    else uiTimes.push(t);
                }
                uiTimes.sort((a,b) => timeOrder.indexOf(a) - timeOrder.indexOf(b));
                refreshUI();
            };
        });
        const endIdx = timeOrder.indexOf(uiTimes[uiTimes.length-1]) + 1;
        const endT = endIdx < timeOrder.length ? timeOrder[endIdx] : "21:00";
        document.getElementById('whu-summary').textContent = `已选：${uiTimes[0]}-${endT} | ${targetInfo.stadiumsAreaId}馆-${targetInfo.stadiumsAreaNo}场`;
    }

    function confirmConfig() {
        const date = document.getElementById('whu-date').value;
        const sleepInput = document.getElementById('whu-sleep').value;
        const sumText = document.getElementById('whu-summary').textContent;
        const match = sumText.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
        const stadiumName = document.querySelector(`#v-grid .whu-btn[data-id="${targetInfo.stadiumsAreaId}"]`).textContent;

        targetInfo.appointmentStartDate = `${date} ${match[1]}`;
        targetInfo.appointmentEndDate = `${date} ${match[2]}`;
        globalSleepTime = parseInt(sleepInput) || 1500;

        closeModal();
        const t = document.getElementById('whu-toast'); t.textContent = "✓ 参数锁定成功"; t.style.display = "block";
        setTimeout(() => t.style.display = "none", 2000);

        // 合成一行详细信息展示
        const fullInfo = `${stadiumName}(ID:${targetInfo.stadiumsAreaId})-${targetInfo.stadiumsAreaNo}号场 | ${date} | ${match[1]}-${match[2]} | 延迟:${globalSleepTime}ms`;
        showLog(`[配置成功] ${fullInfo}`, "success");
    }


    function injectEnvButton() {
        if (document.getElementById('env-switch-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'env-switch-btn'; btn.textContent = '模式：生产 (定时18:00)';
        btn.style = `position:fixed; top:60px; left:20px; z-index:2147483647; padding:10px 16px; background:#c0392b; color:#fff; border:2px solid #fff; border-radius:8px; font-weight:bold; font-size:14px; box-shadow:0 4px 12px rgba(0,0,0,0.4);`;
        btn.onclick = () => {
            isDevMode = !isDevMode;
            btn.textContent = isDevMode ? '模式：开发 (立即抢票)' : '模式：生产 (定时18:00)';
            btn.style.background = isDevMode ? '#27ae60' : '#c0392b';
        };
        document.body.appendChild(btn);
    }

    // --- 5. 暴力劫持 (杀死原请求) ---
    const rawSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        if (this._url && this._url.includes("/api/GSOrder/Create")) {
            const headers = Object.assign({}, this._headers);
            // 只做“通用处理”，不做伪装用途
            delete headers["Sec-Ch-Ua-Platform"];
            delete headers["Sec-Ch-Ua-Mobile"];
            delete headers["Sec-Ch-Ua"];
            headers["X-Requested-With"] = "com.chaoxing.mobile.wuhanuniversity";
            startExclusiveHeist(headers || {}, body);
            this.abort();
            return;
        }
        return rawSend.apply(this, arguments);
    };
    const rawOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, url) { this._url = url; return rawOpen.apply(this, arguments); };
    const rawSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(h, v) { this._headers = this._headers || {}; this._headers[h] = v; return rawSetHeader.apply(this, arguments); };

    const itv = setInterval(() => {
        if (document.body) {
            injectUI();
            injectEnvButton();
            clearInterval(itv);
        }
    }, 500);

})();