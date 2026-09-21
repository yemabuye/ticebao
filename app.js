// ============================================
// 体测宝 - 纯前端版（LocalStorage 存储）
// 数据存在浏览器本地，无需注册登录
// ============================================

// ====== 内置试用激活码 ======
const VALID_CODES = [
    { code: 'TCB-TRIAL-20260921-AAAAAA', days: 7, plan: 'TRIAL' },
    { code: 'TCB-TRIAL-20260921-BBBBBB', days: 7, plan: 'TRIAL' },
    { code: 'TCB-TRIAL-20260921-CCCCCC', days: 7, plan: 'TRIAL' },
    { code: 'TCB-TRIAL-20260921-DDDDDD', days: 7, plan: 'TRIAL' },
    { code: 'TCB-TRIAL-20260921-EEEEEE', days: 7, plan: 'TRIAL' },
    { code: 'TCB-PRO-20260921-XXXXXX', days: 365, plan: 'YEARLY' },
];

// ====== LocalStorage 读写 ======
const LS = {
    get(key, def) {
        try { return JSON.parse(localStorage.getItem(key)) ?? def; }
        catch { return def; }
    },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
    del(key) { localStorage.removeItem(key); }
};

// ====== 全局状态 ======
let state = {
    activated: false,
    activationCode: null,
    students: [],
    scores: [],
    currentGrade: null,
    currentClass: null,
    currentLaneTimes: {},
    timerStartTime: null,
    timerRunning: false,
    timerPausedAt: 0,
    countdownInterval: null,
    countValue: 0,
};

// ====== 自动加载 + 检查激活 ======
function loadFromStorage() {
    state.students = LS.get('tb_students', []);
    state.scores = LS.get('tb_scores', []);
    state.activationCode = LS.get('tb_activation', null);
    state.activated = !!state.activationCode;
    
    // 检查激活码是否过期
    if (state.activationCode && state.activationCode.expires) {
        const exp = new Date(state.activationCode.expires);
        if (exp < new Date()) {
            state.activated = false;
            state.activationCode = null;
            LS.del('tb_activation');
        }
    }
}

function saveStudents() { LS.set('tb_students', state.students); }
function saveScores() { LS.set('tb_scores', state.scores); }

// ====== 年级编号映射 ======
const GRADE_MAP = {
    '一年级': { code: 11, projects: ['BMI', '肺活量', '50米跑', '坐位体前屈', '一分钟跳绳'] },
    '二年级': { code: 12, projects: ['BMI', '肺活量', '50米跑', '坐位体前屈', '一分钟跳绳'] },
    '三年级': { code: 13, projects: ['BMI', '肺活量', '50米跑', '坐位体前屈', '一分钟跳绳', '一分钟仰卧起坐'] },
    '四年级': { code: 14, projects: ['BMI', '肺活量', '50米跑', '坐位体前屈', '一分钟跳绳', '一分钟仰卧起坐'] },
    '五年级': { code: 15, projects: ['BMI', '肺活量', '50米跑', '坐位体前屈', '一分钟跳绳', '一分钟仰卧起坐', '50米×8往返跑'] },
    '六年级': { code: 16, projects: ['BMI', '肺活量', '50米跑', '坐位体前屈', '一分钟跳绳', '一分钟仰卧起坐', '50米×8往返跑'] },
    '七年级': { code: 21, projects: ['BMI', '肺活量', '50米跑', '立定跳远', '坐位体前屈', '耐力跑', '仰卧起坐引体'] },
    '八年级': { code: 22, projects: ['BMI', '肺活量', '50米跑', '立定跳远', '坐位体前屈', '耐力跑', '仰卧起坐引体'] },
    '九年级': { code: 23, projects: ['BMI', '肺活量', '50米跑', '立定跳远', '坐位体前屈', '耐力跑', '仰卧起坐引体'] },
};

const EXPORT_COLUMNS = [
    '年级编号','班级编号','班级名称','学籍号','民族代码','姓名','性别','出生日期','家庭住址',
    '身高','体重','肺活量','50米跑','坐位体前屈','一分钟跳绳','一分钟仰卧起坐','50米×8往返跑',
    '立定跳远','800米跑','1000米跑','引体向上'
];

// ============================================
// 路由
// ============================================
function navigate(view) {
    document.getElementById('app').innerHTML = '';
    window.scrollTo(0, 0);
    
    if (!state.activated && view !== 'activation') {
        renderActivation();
        return;
    }
    
    switch(view) {
        case 'activation': renderActivation(); break;
        case 'home': renderHome(); break;
        case 'timer': renderTimer(); break;
        case 'rope': renderRope(); break;
        case 'situp': renderSitup(); break;
        case 'endurance': renderEndurance(); break;
        case 'input': renderInput(); break;
        case 'students': renderStudents(); break;
        case 'export': renderExport(); break;
        case 'analysis': renderAnalysis(); break;
        default: renderHome();
    }
}

function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

// ============================================
// 评分引擎（23张表查表）
// ============================================
function getScore(grade, gender, project, value) {
    if (!value || isNaN(value)) return null;
    const tables = window.SCORING_TABLES?.tables || {};
    
    if (project === 'BMI') return calcBMI(grade, gender, value);
    
    const projectMap = {
        '肺活量': {男: '表1-3', 女: '表1-4'},
        '50米跑': {男: '表1-5', 女: '表1-6'},
        '坐位体前屈': {男: '表1-7', 女: '表1-8'},
        '一分钟跳绳': {男: '表1-9', 女: '表1-10'},
        '立定跳远': {男: '表1-11', 女: '表1-12'},
        '一分钟仰卧起坐': {男: '表1-13', 女: '表1-14'},
        '仰卧起坐引体': {男: '表2-3', 女: '表2-4'},
        '耐力跑': {男: '表2-5', 女: '表26'},
        '50米×8往返跑': {男: '表1-15', 女: '表1-16'},
    };
    
    const tableKey = projectMap[project];
    if (!tableKey) return null;
    
    let table = tables[gender === '女' ? tableKey.女 : tableKey.男];
    if (!table || !table[0]) return null;
    
    const gradeCol = grade;
    const smallerIsBetter = ['50米跑', '50米×8往返跑', '耐力跑'].includes(project);
    
    let numVal = value;
    if (typeof value === 'string' && /['":：]/.test(value)) {
        const parts = value.replace(/['":：]/g, ' ').trim().split(/\s+/);
        if (parts.length === 2) numVal = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    numVal = parseFloat(numVal);
    if (isNaN(numVal)) return null;
    
    for (let row of table) {
        let rowVal = parseFloat(row[gradeCol]);
        if (isNaN(rowVal)) continue;
        let match = smallerIsBetter ? numVal <= rowVal : numVal >= rowVal;
        if (match && row['等级']) {
            return { level: row['等级'], score: parseFloat(row['得分']), value: numVal };
        }
    }
    return null;
}

function calcBMI(grade, gender, bmiObj) {
    if (!bmiObj.height || !bmiObj.weight) return null;
    const heightM = bmiObj.height / 100;
    const bmi = bmiObj.weight / (heightM * heightM);
    const tables = window.SCORING_TABLES?.tables || {};
    const table = tables[gender === '女' ? '表1-2' : '表1-1'];
    if (!table) return null;
    const gradeCol = grade;
    for (let row of table) {
        let thresh = parseFloat(row[gradeCol]);
        if (isNaN(thresh)) continue;
        const op = row['等级'] === '肥胖' ? '>=' : '<=';
        if ((op === '>=' ? bmi >= thresh : bmi <= thresh) && row['等级']) {
            return { level: row['等级'], score: parseFloat(row['得分']), value: Math.round(bmi * 10) / 10, bmi: true };
        }
    }
    return { level: '正常', score: 100, value: Math.round(bmi * 10) / 10, bmi: true };
}

// ============================================
// 激活码页面
// ============================================
function renderActivation() {
    document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:60px;">
        <div class="auth-card" style="box-shadow:none;padding:20px 0;">
            <div class="activation-banner">
                <div style="font-size:14px;opacity:0.9;">欢迎使用体测宝</div>
                <div style="font-size:20px;font-weight:600;margin-top:4px;">请输入激活码开始使用</div>
                <div style="font-size:12px;opacity:0.8;margin-top:8px;">💡 快速试用激活码：TCB-TRIAL-20260921-AAAAAA</div>
            </div>
            <div class="form-group">
                <label class="label">激活码</label>
                <input id="activation-code" class="input" style="text-transform:uppercase;" placeholder="TCB-TRIAL-20260921-XXXXXX">
            </div>
            <button class="btn btn-primary btn-block btn-lg" onclick="doActivate()">立即激活</button>
            <button class="btn btn-ghost btn-block" style="margin-top:12px;" onclick="navigate('home')">跳过 · 先看演示</button>
        </div>
    </div>`;
}

function doActivate() {
    const code = document.getElementById('activation-code').value.trim().toUpperCase();
    if (!code) return toast('请输入激活码', 'error');
    
    const match = VALID_CODES.find(c => c.code === code);
    if (!match) return toast('激活码无效，请检查拼写', 'error');
    
    const expires = match.days === 0 ? null : new Date(Date.now() + match.days * 86400000).toISOString();
    state.activationCode = { code, plan: match.plan, expires };
    state.activated = true;
    LS.set('tb_activation', state.activationCode);
    
    const expText = match.days === 0 ? '永久' : `${match.days}天后过期`;
    toast(`激活成功！${expText}`, 'success');
    navigate('home');
}

// ============================================
// 首页 + 导航
// ============================================
function renderNav(active) {
    const tabs = [
        { id: 'home', label: '🏠 首页' },
        { id: 'timer', label: '⏱️ 计时' },
        { id: 'rope', label: '🪢 跳绳' },
        { id: 'situp', label: '🤸 仰卧起坐' },
        { id: 'endurance', label: '🏃 耐力跑' },
        { id: 'input', label: '✏️ 录入' },
        { id: 'students', label: '👥 名单' },
        { id: 'analysis', label: '📊 分析' },
        { id: 'export', label: '📤 导出' },
    ];
    return `
    <div class="app-header">
        <div class="flex-between" style="margin-bottom:8px;">
            <div class="nav-title">🏃 体测宝</div>
            <div class="flex" style="gap:8px;">
                ${state.activated ? '<span class="badge badge-excellent">✓ 已激活</span>' : '<span class="badge badge-fail">未激活</span>'}
                <button class="btn btn-sm btn-ghost" onclick="clearAll()">🗑️ 清空</button>
            </div>
        </div>
        <div class="app-nav">
            ${tabs.map(t => `<div class="nav-item ${active===t.id?'active':''}" onclick="navigate('${t.id}')">${t.label}</div>`).join('')}
        </div>
    </div>`;
}

function renderHome() {
    const app = document.getElementById('app');
    app.innerHTML = renderNav('home') + `
    <div class="container">
        <div class="h2">📋 快速开始</div>
        
        <div class="card" style="background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white;">
            <div style="font-size:18px;font-weight:600;">⏱️ 50米跑计时</div>
            <div style="font-size:13px;opacity:0.9;margin:6px 0 14px;">多跑道秒表，毫秒精度</div>
            <button class="btn btn-block" style="background:rgba(255,255,255,0.2);color:white;" onclick="navigate('timer')">开始计时 →</button>
        </div>
        
        <div class="grid-2">
            <div class="card" onclick="navigate('rope')" style="cursor:pointer;">
                <div style="font-size:24px;">🪢</div>
                <div style="font-weight:600;margin-top:6px;">跳绳计数</div>
                <div class="text-muted" style="font-size:12px;">60秒倒计时 + 手动点按</div>
            </div>
            <div class="card" onclick="navigate('situp')" style="cursor:pointer;">
                <div style="font-size:24px;">🤸</div>
                <div style="font-weight:600;margin-top:6px;">仰卧起坐</div>
                <div class="text-muted" style="font-size:12px;">60秒计时 + 计数</div>
            </div>
            <div class="card" onclick="navigate('endurance')" style="cursor:pointer;">
                <div style="font-size:24px;">🏃‍♂️</div>
                <div style="font-weight:600;margin-top:6px;">耐力跑</div>
                <div class="text-muted" style="font-size:12px;">800米/1000米计时</div>
            </div>
            <div class="card" onclick="navigate('input')" style="cursor:pointer;">
                <div style="font-size:24px;">✏️</div>
                <div style="font-weight:600;margin-top:6px;">成绩录入</div>
                <div class="text-muted" style="font-size:12px;">跳远/坐位体前屈等</div>
            </div>
        </div>
        
        <div class="h2" style="margin-top:24px;">📚 数据管理</div>
        <div class="card" onclick="navigate('students')" style="cursor:pointer;">
            <div class="flex-between">
                <div>
                    <div style="font-weight:600;">👥 学生名单</div>
                    <div class="text-muted" style="font-size:12px;">共 ${state.students.length} 名学生 · Excel 导入</div>
                </div>
                <span>→</span>
            </div>
        </div>
        <div class="card" onclick="navigate('analysis')" style="cursor:pointer;">
            <div class="flex-between">
                <div>
                    <div style="font-weight:600;">📊 成绩分析</div>
                    <div class="text-muted" style="font-size:12px;">查看评分、统计达标率</div>
                </div>
                <span>→</span>
            </div>
        </div>
        <div class="card" onclick="navigate('export')" style="cursor:pointer;">
            <div class="flex-between">
                <div>
                    <div style="font-weight:600;">📤 导出上报</div>
                    <div class="text-muted" style="font-size:12px;">21列标准 Excel · 直接上传国网体测网</div>
                </div>
                <span>→</span>
            </div>
        </div>
        
        <div class="card text-muted" style="font-size:12px;margin-top:24px;">
            💾 数据存储在本浏览器本地，换设备请用"导出"和"导入"功能迁移
        </div>
    </div>`;
}

// ============================================
// 数据操作（LocalStorage）
// ============================================
function saveLS(collection, data) {
    LS.set('tb_' + collection, data);
}

function addStudent(s) {
    s.id = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    state.students.push(s);
    saveStudents();
}

function deleteStudent(id) {
    state.students = state.students.filter(s => s.id !== id);
    state.scores = state.scores.filter(sc => sc.student_id !== id);
    saveStudents(); saveScores();
}

function saveScore(studentId, project, value, unit = '') {
    // 先删旧的
    state.scores = state.scores.filter(sc => !(sc.student_id === studentId && sc.project === project));
    state.scores.push({
        id: 'sc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        student_id: studentId, project, value: parseFloat(value), unit,
        recorded_at: new Date().toISOString()
    });
    saveScores();
}

function clearAll() {
    if (!confirm('确定要清空所有学生和成绩数据吗？此操作不可恢复！')) return;
    state.students = []; state.scores = [];
    saveStudents(); saveScores();
    toast('已清空', 'success');
    renderHome();
}

// ============================================
// 50米跑多跑道秒表
// ============================================
function renderTimer() {
    document.getElementById('app').innerHTML = renderNav('timer') + `
    <div class="container">
        <div class="card">
            <div class="flex-between" style="margin-bottom:12px;">
                <div class="h2" style="margin:0;">⏱️ 50米跑计时</div>
                <select id="timer-lanes" class="input" style="width:80px;" onchange="initLanes(this.value)">
                    <option value="4">4 道</option>
                    <option value="6" selected>6 道</option>
                    <option value="8">8 道</option>
                </select>
            </div>
            <div class="timer-display" id="timer-display">00:00.00</div>
            <div class="timer-controls">
                <button class="btn btn-primary big-btn" onclick="timerStart()">▶ 开始</button>
                <button class="btn btn-ghost big-btn" onclick="timerPause()">⏸ 暂停</button>
                <button class="btn btn-danger big-btn" onclick="timerReset()">🔄 重置</button>
            </div>
        </div>
        <div class="card">
            <div class="h2" style="margin-bottom:12px;">🏁 道次分配</div>
            <div class="lane-grid" id="lane-grid"></div>
        </div>
    </div>`;
    initLanes(6);
}

function initLanes(count) {
    state.currentLaneTimes = {};
    const grid = document.getElementById('lane-grid');
    if (!grid) return;
    const lanes = [];
    for (let i = 0; i < count; i++) {
        const laneStudents = state.students.slice(i * 1, i * 1 + 1);
        lanes.push({ index: i + 1, student: laneStudents[0] || null });
        state.currentLaneTimes[i + 1] = { time: null };
    }
    grid.innerHTML = lanes.map(l => `
        <div class="lane-item">
            <div class="lane-header">
                <div>
                    <span class="lane-num">第 ${l.index} 道</span>
                    ${l.student ? `<span class="lane-name">${l.student.name} (${l.student.gender})</span>` : '<span class="lane-name">未分配</span>'}
                </div>
                <div class="flex" style="gap:6px;">
                    <span class="lane-time" id="lane-time-${l.index}">—</span>
                    <button class="btn btn-sm btn-success" onclick="captureLane(${l.index})">⏺</button>
                </div>
            </div>
            ${l.student ? `<button class="btn btn-sm btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="saveLaneScore(${l.index})" id="lane-save-${l.index}" disabled>保存成绩</button>` : ''}
        </div>
    `).join('');
}

let timerRafId = null;
function timerStart() {
    if (state.timerRunning) return;
    state.timerRunning = true;
    state.timerStartTime = performance.now() - state.timerPausedAt;
    document.getElementById('timer-display').classList.add('running');
    timerTick();
}
function timerTick() {
    if (!state.timerRunning) return;
    const elapsed = performance.now() - state.timerStartTime;
    const ms = elapsed % 1000;
    const s = Math.floor(elapsed / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    document.getElementById('timer-display').textContent = 
        String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0') + '.' + String(Math.floor(ms/10)).padStart(2,'0');
    timerRafId = requestAnimationFrame(timerTick);
}
function timerPause() {
    state.timerRunning = false;
    if (timerRafId) cancelAnimationFrame(timerRafId);
    state.timerPausedAt = performance.now() - state.timerStartTime;
}
function timerReset() {
    state.timerRunning = false;
    if (timerRafId) cancelAnimationFrame(timerRafId);
    state.timerPausedAt = 0; state.timerStartTime = null;
    document.getElementById('timer-display').textContent = '00:00.00';
    document.getElementById('timer-display').classList.remove('running');
    Object.keys(state.currentLaneTimes).forEach(k => {
        state.currentLaneTimes[k] = { time: null };
        const el = document.getElementById(`lane-time-${k}`);
        if (el) el.textContent = '—';
        const saveBtn = document.getElementById(`lane-save-${k}`);
        if (saveBtn) saveBtn.disabled = true;
    });
}
function captureLane(laneIndex) {
    if (state.timerRunning) timerPause();
    if (!state.timerPausedAt) return toast('先开始计时', 'error');
    const seconds = state.timerPausedAt / 1000;
    state.currentLaneTimes[laneIndex] = { time: seconds };
    const el = document.getElementById(`lane-time-${laneIndex}`);
    if (el) el.textContent = seconds.toFixed(2) + 's';
    const saveBtn = document.getElementById(`lane-save-${laneIndex}`);
    if (saveBtn) saveBtn.disabled = false;
    toast(`第 ${laneIndex} 道：${seconds.toFixed(2)}s`, 'success');
}
function saveLaneScore(laneIndex) {
    const lane = state.currentLaneTimes[laneIndex];
    if (!lane?.time) return;
    const laneStudents = state.students.slice(laneIndex-1, laneIndex);
    const student = laneStudents[0];
    if (!student) return toast('请先导入学生名单', 'error');
    saveScore(student.id, '50米跑', lane.time.toFixed(2), '秒');
    toast('成绩已保存！', 'success');
    const btn = document.getElementById(`lane-save-${laneIndex}`);
    if (btn) btn.textContent = '✓ 已保存';
}

// ============================================
// 跳绳
// ============================================
function renderRope() {
    document.getElementById('app').innerHTML = renderNav('rope') + `
    <div class="container">
        <div class="card text-center">
            <div class="h2">🪢 一分钟跳绳</div>
            <div class="timer-display" id="rope-countdown" style="font-size:56px;">60</div>
            <div class="count-display" id="rope-count">0</div>
            <div class="timer-controls">
                <button class="btn btn-primary big-btn" onclick="ropeStart()">▶ 开始</button>
                <button class="btn btn-danger big-btn" onclick="ropeReset()">🔄 重置</button>
                <button class="btn btn-ghost big-btn" onclick="navigate('home')">← 返回</button>
            </div>
            <div class="count-buttons">
                <button class="count-btn plus" onclick="ropeCount(1)">+1</button>
                <button class="count-btn minus" onclick="ropeCount(-1)">-1</button>
            </div>
            <p class="text-muted" style="margin-top:12px;font-size:12px;">提示：按空格键也可以 +1（电脑浏览器）</p>
        </div>
        <div class="card">
            <div class="h2">快速录入学生成绩</div>
            <div id="rope-students">${renderRopeStudents()}</div>
        </div>
    </div>`;
    document.onkeydown = (e) => { if (e.code === 'Space') { e.preventDefault(); ropeCount(1); } };
}

let ropeCountdown = 60;
function ropeStart() {
    if (state.countdownInterval) return;
    ropeCountdown = 60; state.countValue = 0;
    document.getElementById('rope-countdown').textContent = '60';
    document.getElementById('rope-count').textContent = '0';
    const timerEl = document.getElementById('rope-countdown');
    state.countdownInterval = setInterval(() => {
        ropeCountdown--;
        timerEl.textContent = ropeCountdown;
        if (ropeCountdown <= 10) { timerEl.classList.add('countdown'); beep(440, 150); }
        if (ropeCountdown <= 0) {
            clearInterval(state.countdownInterval); state.countdownInterval = null;
            beep(880, 300); beep(880, 300); beep(880, 500);
            toast(`时间到！共 ${state.countValue} 次`, 'success');
            timerEl.classList.remove('countdown');
        }
    }, 1000);
}
function ropeCount(delta) {
    state.countValue = Math.max(0, state.countValue + delta);
    document.getElementById('rope-count').textContent = state.countValue;
}
function ropeReset() {
    if (state.countdownInterval) { clearInterval(state.countdownInterval); state.countdownInterval = null; }
    ropeCountdown = 60; state.countValue = 0;
    document.getElementById('rope-countdown').textContent = '60';
    document.getElementById('rope-count').textContent = '0';
    document.getElementById('rope-countdown').classList.remove('countdown');
}

function renderRopeStudents() {
    if (state.students.length === 0) {
        return '<div class="empty"><div class="empty-icon">👥</div><div>暂无学生，请先导入名单</div><button class="btn btn-sm btn-primary" style="margin-top:12px;" onclick="navigate(\'students\')">去导入 →</button></div>';
    }
    const byClass = {};
    state.students.forEach(s => {
        const key = `${s.grade||''}${s.class_name||'未分班'}`;
        (byClass[key] = byClass[key] || []).push(s);
    });
    return Object.entries(byClass).map(([cls, list]) => `
        <div class="group-header">${cls}（${list.length}人）</div>
        ${list.map(s => {
            const sc = state.scores.find(sc => sc.student_id === s.id && sc.project === '一分钟跳绳');
            return `
            <div class="score-input-row">
                <div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''}</span></div>
                <input class="score-input-box" type="number" placeholder="次数" value="${sc?.value||''}"
                       onchange="saveScore('${s.id}','一分钟跳绳',this.value,'次'); showLevel('${s.id}','一分钟跳绳',this.value);">
                <div class="score-level" id="qlevel-${s.id}-一分钟跳绳"></div>
            </div>`;
        }).join('')}
    `).join('');
}

function showLevel(studentId, project, value) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    const result = getScore(student.grade, student.gender, project, value);
    if (!result) return;
    const el = document.getElementById(`qlevel-${studentId}-${project}`);
    if (!el) return;
    const badge = result.level === '优秀' ? 'badge-excellent' :
                  result.level === '良好' ? 'badge-good' :
                  result.level === '及格' ? 'badge-pass' : 'badge-fail';
    el.innerHTML = `<span class="badge ${badge}">${result.level} ${result.score}分</span>`;
}

// ============================================
// 仰卧起坐
// ============================================
function renderSitup() {
    document.getElementById('app').innerHTML = renderNav('situp') + `
    <div class="container">
        <div class="card text-center">
            <div class="h2">🤸 一分钟仰卧起坐</div>
            <div class="timer-display" id="situp-countdown" style="font-size:56px;">60</div>
            <div class="count-display" id="situp-count">0</div>
            <div class="timer-controls">
                <button class="btn btn-primary big-btn" onclick="situpStart()">▶ 开始</button>
                <button class="btn btn-danger big-btn" onclick="situpReset()">🔄 重置</button>
                <button class="btn btn-ghost big-btn" onclick="navigate('home')">← 返回</button>
            </div>
            <div class="count-buttons">
                <button class="count-btn plus" onclick="situpCount(1)">+1</button>
                <button class="count-btn minus" onclick="situpCount(-1)">-1</button>
            </div>
        </div>
        <div class="card">
            <div class="h2">快速录入</div>
            ${state.students.length === 0 ? '<div class="empty">请先导入学生名单</div>' : state.students.map(s => {
                const sc = state.scores.find(sc => sc.student_id === s.id && sc.project === '一分钟仰卧起坐');
                return `<div class="score-input-row">
                    <div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''}</span></div>
                    <input class="score-input-box" type="number" placeholder="次数" value="${sc?.value||''}"
                           onchange="saveScore('${s.id}','一分钟仰卧起坐',this.value,'次');">
                </div>`;
            }).join('')}
        </div>
    </div>`;
}
let situpInterval = null, situpCountdown = 60;
function situpStart() {
    if (situpInterval) return;
    situpCountdown = 60; state.countValue = 0;
    document.getElementById('situp-countdown').textContent = '60';
    document.getElementById('situp-count').textContent = '0';
    const timerEl = document.getElementById('situp-countdown');
    situpInterval = setInterval(() => {
        situpCountdown--;
        timerEl.textContent = situpCountdown;
        if (situpCountdown <= 10) { timerEl.classList.add('countdown'); beep(440, 150); }
        if (situpCountdown <= 0) {
            clearInterval(situpInterval); situpInterval = null;
            beep(880, 300); beep(880, 300); beep(880, 500);
            toast(`时间到！共 ${state.countValue} 次`, 'success');
            timerEl.classList.remove('countdown');
        }
    }, 1000);
}
function situpCount(delta) {
    state.countValue = Math.max(0, state.countValue + delta);
    document.getElementById('situp-count').textContent = state.countValue;
}
function situpReset() {
    if (situpInterval) { clearInterval(situpInterval); situpInterval = null; }
    situpCountdown = 60; state.countValue = 0;
    document.getElementById('situp-countdown').textContent = '60';
    document.getElementById('situp-count').textContent = '0';
    document.getElementById('situp-countdown').classList.remove('countdown');
}

// ============================================
// 耐力跑
// ============================================
function renderEndurance() {
    document.getElementById('app').innerHTML = renderNav('endurance') + `
    <div class="container">
        <div class="card">
            <div class="flex-between" style="margin-bottom:12px;">
                <div class="h2" style="margin:0;">🏃 耐力跑计时</div>
            </div>
            <div class="timer-display" id="endurance-display">00:00.0</div>
            <div class="timer-controls">
                <button class="btn btn-primary big-btn" onclick="enduranceStart()">▶ 开始</button>
                <button class="btn btn-ghost big-btn" onclick="endurancePause()">⏸ 暂停</button>
                <button class="btn btn-danger big-btn" onclick="enduranceReset()">🔄 重置</button>
            </div>
        </div>
        <div class="card">
            <div class="h2" style="margin-bottom:12px;">终点冲刺记录</div>
            <div class="grid-3" style="gap:12px;">
                ${Array.from({length:8},(_,i)=>`
                    <div class="lane-item">
                        <div class="flex-between">
                            <span class="lane-num">第${i+1}道</span>
                            <span class="lane-time" id="end-lane-${i+1}">—</span>
                        </div>
                        <button class="btn btn-sm btn-success btn-block" style="margin-top:8px;" onclick="enduranceCapture(${i+1})">终点！</button>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>`;
}
let enduranceRunning = false, enduranceStartTime = null, endurancePausedAt = 0, enduranceRafId = null;
function enduranceStart() {
    if (enduranceRunning) return;
    enduranceRunning = true;
    enduranceStartTime = performance.now() - endurancePausedAt;
    enduranceTick();
}
function enduranceTick() {
    if (!enduranceRunning) return;
    const elapsed = performance.now() - enduranceStartTime;
    const s = Math.floor(elapsed / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    document.getElementById('endurance-display').textContent =
        String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0') + '.' + Math.floor((elapsed % 1000) / 100);
    enduranceRafId = requestAnimationFrame(enduranceTick);
}
function endurancePause() {
    enduranceRunning = false;
    if (enduranceRafId) cancelAnimationFrame(enduranceRafId);
    endurancePausedAt = performance.now() - enduranceStartTime;
}
function enduranceReset() {
    enduranceRunning = false;
    if (enduranceRafId) cancelAnimationFrame(enduranceRafId);
    endurancePausedAt = 0; enduranceStartTime = null;
    document.getElementById('endurance-display').textContent = '00:00.0';
    for (let i = 1; i <= 8; i++) {
        const el = document.getElementById(`end-lane-${i}`);
        if (el) el.textContent = '—';
    }
}
function enduranceCapture(laneIndex) {
    if (enduranceRunning) endurancePause();
    if (!endurancePausedAt) return;
    const seconds = endurancePausedAt / 1000;
    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60);
    const fmt = `${mm}'${String(ss).padStart(2,'0')}"`;
    const el = document.getElementById(`end-lane-${laneIndex}`);
    if (el) el.textContent = fmt;
    toast(`第 ${laneIndex} 道完成：${fmt}`, 'success');
}

// ============================================
// 快速录入
// ============================================
let currentInputProject = '身高体重(BMI)';
function renderInput() {
    document.getElementById('app').innerHTML = renderNav('input') + `
    <div class="container">
        <div class="card">
            <div class="h2">✏️ 快速录入</div>
            <div class="project-tabs">
                ${['身高体重(BMI)','肺活量','立定跳远','坐位体前屈','50米×8往返跑','1分钟跳绳','仰卧起坐'].map((p,i)=>
                    `<div class="project-tab ${p===currentInputProject?'active':''}" onclick="switchInput('${p}')">${p}</div>`).join('')}
            </div>
        </div>
        <div class="card" id="input-card"></div>
    </div>`;
    renderInputContent();
}
function switchInput(p) { currentInputProject = p; renderInput(); }

function renderInputContent() {
    const el = document.getElementById('input-card');
    if (!el) return;
    if (state.students.length === 0) {
        el.innerHTML = '<div class="empty"><div class="empty-icon">👥</div><div>暂无学生，请先导入名单</div><button class="btn btn-sm btn-primary" style="margin-top:12px;" onclick="navigate(\'students\')">去导入 →</button></div>';
        return;
    }
    const byClass = {};
    state.students.forEach(s => {
        const key = `${s.grade||''}${s.class_name||'未分班'}`;
        (byClass[key] = byClass[key] || []).push(s);
    });
    
    el.innerHTML = Object.entries(byClass).map(([cls, list]) => {
        return `<div class="group-header">${cls}</div>${list.map(s => {
            const scHeight = state.scores.find(sc => sc.student_id === s.id && sc.project === '身高');
            const scWeight = state.scores.find(sc => sc.student_id === s.id && sc.project === '体重');
            const projKey = currentInputProject.replace('1分钟','一分钟').replace('仰卧起坐','一分钟仰卧起坐');
            const scProj = state.scores.find(sc => sc.student_id === s.id && sc.project === projKey);
            
            let inputs = '';
            if (currentInputProject === '身高体重(BMI)') {
                inputs = `
                    <input class="score-input-box" type="number" placeholder="身高cm" value="${scHeight?.value||''}" 
                           onchange="saveScore('${s.id}','身高',this.value,'cm'); recalcBMI('${s.id}');" style="width:80px;">
                    <input class="score-input-box" type="number" placeholder="体重kg" step="0.1" value="${scWeight?.value||''}"
                           onchange="saveScore('${s.id}','体重',this.value,'kg'); recalcBMI('${s.id}');" style="width:80px;">
                    <span class="score-level" id="bmi-${s.id}"></span>`;
            } else {
                inputs = `
                    <input class="score-input-box" type="number" step="0.1" placeholder="${currentInputProject}" value="${scProj?.value||''}"
                           onchange="saveScore('${s.id}','${projKey}',this.value); showLevel('${s.id}','${projKey}',this.value);">
                    <span class="score-level" id="qlevel-${s.id}-${projKey}"></span>`;
            }
            return `<div class="score-input-row">
                <div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''} · ${s.grade||''}</span></div>
                ${inputs}
            </div>`;
        }).join('')}`;
    }).join('');
    
    // 已存在的值自动显示等级
    state.students.forEach(s => {
        if (currentInputProject === '身高体重(BMI)') recalcBMI(s.id);
        else {
            const projKey = currentInputProject.replace('1分钟','一分钟').replace('仰卧起坐','一分钟仰卧起坐');
            const sc = state.scores.find(sc => sc.student_id === s.id && sc.project === projKey);
            if (sc) showLevel(s.id, projKey, sc.value);
        }
    });
}

function recalcBMI(studentId) {
    const student = state.students.find(s => s.id === studentId);
    const heightSc = state.scores.find(sc => sc.student_id === studentId && sc.project === '身高');
    const weightSc = state.scores.find(sc => sc.student_id === studentId && sc.project === '体重');
    const el = document.getElementById(`bmi-${studentId}`);
    if (!heightSc || !weightSc || !el) return;
    const result = getScore(student.grade, student.gender, 'BMI', { height: heightSc.value, weight: weightSc.value });
    if (result) {
        const badge = result.level === '正常' ? 'badge-good' : result.level === '低体重' ? 'badge-pass' : result.level === '超重' ? 'badge-warning' : 'badge-fail';
        el.innerHTML = `<span class="badge ${badge}">BMI:${result.value}</span>`;
    }
}

// ============================================
// 学生名单 + Excel 导入导出
// ============================================
function renderStudents() {
    document.getElementById('app').innerHTML = renderNav('students') + `
    <div class="container">
        <div class="card">
            <div class="flex-between" style="margin-bottom:12px;">
                <div class="h2" style="margin:0;">👥 学生名单 (${state.students.length})</div>
                <div class="flex" style="gap:8px;">
                    <button class="btn btn-sm btn-ghost" onclick="downloadTemplate()">📥 模板</button>
                    <label class="btn btn-sm btn-primary" style="cursor:pointer;">
                        📂 导入
                        <input type="file" accept=".xlsx,.xls" onchange="importExcel(this.files[0])" style="display:none;">
                    </label>
                </div>
            </div>
        </div>
        <div id="students-list"></div>
    </div>`;
    renderStudentsList();
}

function renderStudentsList() {
    const el = document.getElementById('students-list');
    if (!el) return;
    if (state.students.length === 0) {
        el.innerHTML = '<div class="card empty"><div class="empty-icon">📋</div><div>还没有学生名单</div><p style="margin-top:8px;font-size:12px;">点"模板"下载空白模板，填好后点"导入"</p></div>';
        return;
    }
    const byClass = {};
    state.students.forEach(s => {
        const key = `${s.grade||''}${s.class_name||'未分班'}`;
        (byClass[key] = byClass[key] || []).push(s);
    });
    el.innerHTML = Object.entries(byClass).map(([cls, list]) => `
        <div class="card">
            <div class="flex-between" style="margin-bottom:8px;">
                <div class="h2" style="margin:0;">${cls} <span style="font-size:14px;color:var(--text-muted);">(${list.length}人)</span></div>
                <button class="btn btn-sm btn-danger" onclick="deleteClass('${cls}')">删除班级</button>
            </div>
            ${list.map(s => `
                <div class="student-row">
                    <div class="student-info">
                        <div class="name">${s.name}</div>
                        <div class="meta">${s.gender||''} ${s.student_id||''}</div>
                    </div>
                    <button class="btn btn-sm btn-ghost" onclick="deleteStudent('${s.id}')">删除</button>
                </div>
            `).join('')}
        </div>
    `).join('');
}

function downloadTemplate() {
    const data = [
        ['姓名','性别','年级','班级','学籍号','民族'],
        ['张三','男','四年级','1','','汉族'],
        ['李四','女','四年级','1','','汉族'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{wch:10},{wch:6},{wch:10},{wch:6},{wch:15},{wch:6}];
    XLSX.writeFile(XLSX.utils.book_new(), '体测宝_导入模板.xlsx');
    toast('模板已下载', 'success');
}

function importExcel(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            let count = 0;
            for (let row of rows) {
                const s = {
                    name: String(row['姓名'] || '').trim(),
                    gender: String(row['性别'] || '').trim(),
                    grade: String(row['年级'] || '').trim(),
                    class_name: String(row['班级'] || row['班级名称'] || '').trim(),
                    student_id: String(row['学籍号'] || '').trim(),
                    ethnicity: String(row['民族'] || '').trim(),
                };
                if (s.name) { addStudent(s); count++; }
            }
            toast(`成功导入 ${count} 名学生！`, 'success');
            renderStudentsList();
        } catch (err) { toast('导入失败：' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(file);
}

function deleteClass(clsKey) {
    if (!confirm(`确认删除整个班级 ${clsKey} ？所有学生和成绩都会被删！`)) return;
    state.students.filter(s => `${s.grade||''}${s.class_name||'未分班'}` === clsKey).forEach(s => deleteStudent(s.id));
}

// ============================================
// 成绩分析
// ============================================
function renderAnalysis() {
    let levels = { '优秀': 0, '良好': 0, '及格': 0, '不及格': 0 };
    let totalScores = 0;
    let projectLevels = {};
    
    for (let sc of state.scores) {
        const student = state.students.find(s => s.id === sc.student_id);
        if (!student) continue;
        let result;
        if (sc.project === '身高' || sc.project === '体重') continue;
        if (sc.project === 'BMI') result = calcBMI(student.grade, student.gender, { height: sc.value, weight: sc.value });
        else result = getScore(student.grade, student.gender, sc.project, sc.value);
        
        if (result) {
            totalScores++;
            if (levels[result.level] !== undefined) levels[result.level]++;
            projectLevels[sc.project] = projectLevels[sc.project] || {};
            projectLevels[sc.project][result.level] = (projectLevels[sc.project][result.level] || 0) + 1;
        }
    }
    
    const total = Object.values(levels).reduce((a,b)=>a+b,0);
    const excellentRate = total > 0 ? (levels['优秀']/total*100).toFixed(1) : 0;
    const passRate = total > 0 ? ((levels['优秀']+levels['良好']+levels['及格'])/total*100).toFixed(1) : 0;
    
    document.getElementById('app').innerHTML = renderNav('analysis') + `
    <div class="container">
        <div class="card">
            <div class="h2">📊 数据概览</div>
            <div class="stat-grid">
                <div class="stat-card"><div class="stat-value">${state.students.length}</div><div class="stat-label">学生总数</div></div>
                <div class="stat-card"><div class="stat-value">${new Set(state.scores.map(sc=>sc.student_id)).size}</div><div class="stat-label">已录入成绩</div></div>
                <div class="stat-card"><div class="stat-value">${excellentRate}%</div><div class="stat-label">优秀率</div></div>
                <div class="stat-card"><div class="stat-value">${passRate}%</div><div class="stat-label">达标率</div></div>
            </div>
        </div>
        <div class="card">
            <div class="h2">🎯 综合等级分布</div>
            <div class="flex" style="gap:12px;flex-wrap:wrap;">
                <span class="badge badge-excellent">优秀 ${levels['优秀']}</span>
                <span class="badge badge-good">良好 ${levels['良好']}</span>
                <span class="badge badge-pass">及格 ${levels['及格']}</span>
                <span class="badge badge-fail">不及格 ${levels['不及格']}</span>
            </div>
        </div>
        <div class="card">
            <div class="h2">📈 各项目统计</div>
            ${Object.entries(projectLevels).map(([proj, lvls]) => {
                const t = Object.values(lvls).reduce((a,b)=>a+b,0);
                return `<div style="padding:10px 0;border-bottom:1px solid var(--border);">
                    <div style="font-weight:600;">${proj} <span class="text-muted" style="font-size:12px;">(共${t}项)</span></div>
                    <div class="flex" style="gap:8px;margin-top:6px;">
                        ${Object.entries(lvls).map(([lv, n]) => {
                            const badge = lv==='优秀'?'badge-excellent':lv==='良好'?'badge-good':lv==='及格'?'badge-pass':'badge-fail';
                            return `<span class="badge ${badge}">${lv} ${n}</span>`;
                        }).join('')}
                    </div>
                </div>`;
            }).join('') || '<div class="empty">还没有成绩数据</div>'}
        </div>
    </div>`;
}

// ============================================
// 导出（21列国网体测网格式）
// ============================================
function renderExport() {
    const gradeOrder = ['一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级'];
    const sortedStudents = [...state.students].sort((a,b) => {
        const ai = gradeOrder.indexOf(a.grade);
        const bi = gradeOrder.indexOf(b.grade);
        if (ai !== bi) return ai - bi;
        return (a.class_name||'').localeCompare(b.class_name||'');
    });
    
    document.getElementById('app').innerHTML = renderNav('export') + `
    <div class="container">
        <div class="card" style="background:linear-gradient(135deg,#16a34a,#15803d);color:white;text-align:center;">
            <div style="font-size:20px;font-weight:700;margin-bottom:8px;">📤 一键导出国网体测网格式</div>
            <div style="font-size:13px;opacity:0.9;margin-bottom:14px;">${state.students.length} 名学生 · 21 列标准格式 · 可直接上传</div>
            <button class="btn btn-block btn-lg" style="background:rgba(255,255,255,0.2);color:white;" onclick="doExport()">📥 下载 Excel 文件</button>
        </div>
        <div class="card">
            <div class="h2" style="font-size:14px;">📋 导出预览（前 5 行）</div>
            <div style="overflow-x:auto;font-size:11px;max-height:300px;">
                <table style="width:100%;border-collapse:collapse;">
                    <tr style="background:#f1f5f9;position:sticky;top:0;">
                        ${EXPORT_COLUMNS.map(c => `<th style="padding:4px;border:1px solid #e2e8f0;text-align:left;white-space:nowrap;">${c}</th>`).join('')}
                    </tr>
                    ${sortedStudents.slice(0,5).map(s => {
                        const row = buildExportRow(s);
                        return `<tr>${EXPORT_COLUMNS.map(c => `<td style="padding:2px 4px;border:1px solid #e2e8f0;">${row[c]||''}</td>`).join('')}</tr>`;
                    }).join('')}
                </table>
            </div>
        </div>
    </div>`;
}

function buildExportRow(student) {
    const gm = GRADE_MAP[student.grade] || { code: 0 };
    const classNum = (student.class_name || '').match(/\d+/)?.[0] || '1';
    const classCode = `${gm.code}${String(classNum).padStart(2,'0')}`;
    const sc = (proj) => {
        const found = state.scores.find(s => s.student_id === student.id && s.project === proj);
        return found?.value ?? '';
    };
    return {
        '年级编号': gm.code,
        '班级编号': classCode,
        '班级名称': `${student.grade||''}${student.class_name||''}`,
        '学籍号': student.student_id || '',
        '民族代码': student.ethnicity || '',
        '姓名': student.name || '',
        '性别': student.gender || '',
        '出生日期': '',
        '家庭住址': '',
        '身高': sc('身高'),
        '体重': sc('体重'),
        '肺活量': sc('肺活量'),
        '50米跑': sc('50米跑'),
        '坐位体前屈': sc('坐位体前屈'),
        '一分钟跳绳': sc('一分钟跳绳'),
        '一分钟仰卧起坐': sc('一分钟仰卧起坐'),
        '50米×8往返跑': sc('50米×8往返跑'),
        '立定跳远': sc('立定跳远'),
        '800米跑': formatEndurance(sc('耐力跑'), student.gender, '800'),
        '1000米跑': formatEndurance(sc('耐力跑'), student.gender, '1000'),
        '引体向上': sc('仰卧起坐引体'),
    };
}

function formatEndurance(value, gender, which) {
    if (!value) return '';
    if (which === '800' && gender !== '女') return '';
    if (which === '1000' && gender !== '男') return '';
    let seconds = parseFloat(value);
    if (isNaN(seconds)) return '';
    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60);
    return `${mm}'${String(ss).padStart(2,'0')}"`;
}

function doExport() {
    if (state.students.length === 0) return toast('没有学生数据', 'error');
    const gradeOrder = ['一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级'];
    const sorted = [...state.students].sort((a,b) => {
        const ai = gradeOrder.indexOf(a.grade), bi = gradeOrder.indexOf(b.grade);
        return ai !== bi ? ai - bi : (a.class_name||'').localeCompare(b.class_name||'');
    });
    const aoa = [EXPORT_COLUMNS, ...sorted.map(s => {
        const row = buildExportRow(s);
        return EXPORT_COLUMNS.map(c => row[c] || '');
    })];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = EXPORT_COLUMNS.map(c => ({ wch: 14 }));
    const now = new Date();
    XLSX.writeFile(XLSX.utils.book_new(), `体测宝_体测成绩_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`);
    toast('导出成功！直接上传国网体测网', 'success');
}

// ============================================
// 蜂鸣器
// ============================================
function beep(freq = 880, duration = 200) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq; osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        osc.start(); osc.stop(ctx.currentTime + duration / 1000);
        osc.onended = () => ctx.close();
    } catch(e) {}
}

// ============================================
// 启动
// ============================================
(function init() {
    loadFromStorage();
    if (!state.activated) {
        renderActivation();
    } else {
        renderHome();
    }
})();
