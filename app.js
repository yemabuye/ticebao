// ============================================
// 体测宝 - 主应用逻辑
// ============================================

// ====== Supabase 配置 ======
const SUPABASE_URL = 'https://wtjsnuucgpvaowhvwask.supabase.co';
const SUPABASE_KEY = 'sb_publishable_p0T7Z6Ci3_KEGGTTpjf_Lg_xIyvOZLC';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const supabase = sb; // 别名兼容

// ====== 全局状态 ======
let state = {
    user: null,
    activation: null,
    students: [],
    scores: [],
    currentGrade: null,
    currentClass: null,
    currentLaneTimes: {}, // {laneIndex: {time, startTime}}
    timerStartTime: null,
    timerRunning: false,
    timerPausedAt: 0,
    countdownValue: 0,
    countdownInterval: null,
    countValue: 0,
};

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
// 路由/状态管理
// ============================================
function navigate(view) {
    const app = document.getElementById('app');
    app.innerHTML = '';
    window.scrollTo(0, 0);
    
    if (!state.user && view !== 'login') {
        renderLogin();
        return;
    }
    if (state.user && view === 'login') {
        navigate('home');
        return;
    }
    
    switch(view) {
        case 'login': renderLogin(); break;
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
    const meta = window.SCORING_TABLES?.meta || {};
    
    // BMI 需要先算
    if (project === 'BMI') return calcBMI(grade, gender, value);
    
    // 项目到表名的映射
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
    
    let tableName = gender === '女' ? tableKey.女 : tableKey.男;
    let table = tables[tableName];
    
    if (!table) return null;
    
    // 耐力跑 value 可能是分秒格式 "3'45" 或 "3:45"，需转秒
    let numVal = value;
    if (typeof value === 'string' && (value.includes("'") || value.includes(':') || value.includes('’'))) {
        const parts = value.replace(/[:''’]/g, ' ').trim().split(/\s+/);
        if (parts.length === 2) {
            numVal = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        }
    }
    numVal = parseFloat(numVal);
    if (isNaN(numVal)) return null;
    
    // 找年级列
    const gradeCol = grade;
    if (!table[0] || !(gradeCol in table[0])) return null;
    
    // 判断项目类型（时间类越小越好 vs 次数/距离越大越好）
    const smallerIsBetter = ['50米跑', '50米×8往返跑', '耐力跑'].includes(project);
    
    // 找区间
    for (let row of table) {
        let rowVal = parseFloat(row[gradeCol]);
        if (isNaN(rowVal)) continue;
        
        if (smallerIsBetter) {
            // 时间类：找 value <= rowVal 的第一行（表按时间从大到小排）
            if (numVal <= rowVal) {
                return { level: row['等级'], score: parseFloat(row['得分']), value: numVal };
            }
        } else {
            // 次数/距离类：找 value >= rowVal 的第一行（表按次数从小到大排）
            if (numVal >= rowVal) {
                return { level: row['等级'], score: parseFloat(row['得分']), value: numVal };
            }
        }
    }
    
    // 找不到，返回最低
    const lastRow = table[table.length - 1];
    return { level: lastRow['等级'], score: parseFloat(lastRow['得分']), value: numVal };
}

function calcBMI(grade, gender, bmiObj) {
    // bmiObj = {height, weight}
    if (!bmiObj.height || !bmiObj.weight) return null;
    const heightM = bmiObj.height / 100;
    const bmi = bmiObj.weight / (heightM * heightM);
    
    const tables = window.SCORING_TABLES?.tables || {};
    const tableName = gender === '女' ? '表1-2' : '表1-1';
    const table = tables[tableName];
    if (!table) return null;
    
    const gradeCol = grade;
    const thresholds = {
        '男': { 肥胖: '>=', 超重: '<=', 正常: '<=', 低体重: '<=' },
        '女': { 肥胖: '>=', 超重: '<=', 正常: '<=', 低体重: '<=' },
    };
    
    for (let row of table) {
        let thresh = parseFloat(row[gradeCol]);
        if (isNaN(thresh)) continue;
        const op = thresholds[gender]?.[row['等级']] || '<=';
        let match = op === '>=' ? bmi >= thresh : bmi <= thresh;
        if (match && row['等级']) {
            return { level: row['等级'], score: parseFloat(row['得分']), value: Math.round(bmi * 10) / 10, bmi: true };
        }
    }
    return { level: '正常', score: 100, value: Math.round(bmi * 10) / 10, bmi: true };
}

// ============================================
// 登录 / 注册
// ============================================
function renderLogin() {
    document.getElementById('app').innerHTML = `
    <div class="auth-page">
        <div class="auth-card">
            <div class="auth-logo">🏃 体测宝</div>
            <div class="auth-sub">现场计时 · 自动评分 · 一键导出</div>
            <div class="auth-tabs">
                <div class="auth-tab active" onclick="switchAuthTab(this, 'login')">登录</div>
                <div class="auth-tab" onclick="switchAuthTab(this, 'register')">注册</div>
            </div>
            <div id="auth-content">
                <div class="form-group">
                    <label class="label">邮箱</label>
                    <input id="auth-email" class="input" type="email" placeholder="your@email.com">
                </div>
                <div class="form-group">
                    <label class="label">密码</label>
                    <input id="auth-password" class="input" type="password" placeholder="至少6位">
                </div>
                <button class="btn btn-primary btn-block btn-lg" onclick="doLogin()">登录</button>
                <p class="text-center text-muted" style="margin-top:16px;font-size:12px;">
                    首次使用请先"注册"，注册后需要输入激活码
                </p>
            </div>
        </div>
    </div>`;
}

let authMode = 'login';
function switchAuthTab(el, mode) {
    authMode = mode;
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    const content = document.getElementById('auth-content');
    if (mode === 'login') {
        content.innerHTML = `
            <div class="form-group">
                <label class="label">邮箱</label>
                <input id="auth-email" class="input" type="email" placeholder="your@email.com">
            </div>
            <div class="form-group">
                <label class="label">密码</label>
                <input id="auth-password" class="input" type="password" placeholder="至少6位">
            </div>
            <button class="btn btn-primary btn-block btn-lg" onclick="doLogin()">登录</button>`;
    } else {
        content.innerHTML = `
            <div class="form-group">
                <label class="label">邮箱</label>
                <input id="auth-email" class="input" type="email" placeholder="your@email.com">
            </div>
            <div class="form-group">
                <label class="label">密码</label>
                <input id="auth-password" class="input" type="password" placeholder="至少6位">
            </div>
            <button class="btn btn-primary btn-block btn-lg" onclick="doRegister()">注册</button>`;
    }
}

async function doLogin() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) return toast('请输入邮箱和密码', 'error');
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return toast(error.message, 'error');
    
    state.user = data.user;
    toast('登录成功！', 'success');
    await checkActivationAndNavigate();
}

async function doRegister() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || password.length < 6) return toast('请输入有效邮箱和至少6位密码', 'error');
    
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return toast(error.message, 'error');
    
    toast('注册成功！请查收验证邮件，验证后再登录', 'success');
    renderLogin();
}

async function checkActivationAndNavigate() {
    const { data, error } = await supabase.rpc('check_my_activation');
    if (error || !data) {
        navigate('activation');
        return;
    }
    state.activation = data;
    if (data.active) {
        await loadAllData();
        navigate('home');
    } else {
        navigate('activation');
    }
}

// ============================================
// 激活码页面
// ============================================
function renderActivation() {
    document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:60px;">
        <div class="auth-card" style="box-shadow:none;padding:20px 0;">
            ${state.activation?.active ? '' : `
            <div class="activation-banner">
                <div style="font-size:14px;opacity:0.9;">您尚未激活</div>
                <div style="font-size:20px;font-weight:600;margin-top:4px;">请输入激活码开始使用</div>
            </div>`}
            ${state.activation?.active ? `
            <div class="activation-banner success">
                <div style="font-size:14px;opacity:0.9;">已激活</div>
                <div style="font-size:20px;font-weight:600;margin-top:4px;">${state.activation.plan_type} 套餐</div>
                <div style="font-size:12px;opacity:0.8;margin-top:4px;">有效期至：${state.activation.expires_at || '永久'}</div>
            </div>
            <button class="btn btn-primary btn-block btn-lg" onclick="navigate('home')">进入体测宝</button>
            ` : `
            <div class="form-group">
                <label class="label">激活码</label>
                <input id="activation-code" class="input" style="text-transform:uppercase;" placeholder="TCB-TRIAL-20260921-XXXXXX">
            </div>
            <button class="btn btn-primary btn-block btn-lg" onclick="doActivate()">立即激活</button>
            `}
            <div style="margin-top:20px;text-align:center;">
                <button class="btn btn-sm btn-ghost" onclick="doLogout()">退出登录</button>
            </div>
        </div>
    </div>`;
}

async function doActivate() {
    const code = document.getElementById('activation-code').value.trim().toUpperCase();
    if (!code) return toast('请输入激活码', 'error');
    
    const { data, error } = await supabase.rpc('validate_activation_code', { input_code: code });
    if (error) return toast(error.message, 'error');
    
    if (!data.success) return toast(data.message, 'error');
    
    toast('激活成功！', 'success');
    state.activation = { active: true, plan_type: data.plan_type, expires_at: data.expires_at };
    navigate('home');
}

async function doLogout() {
    await supabase.auth.signOut();
    state.user = null;
    state.activation = null;
    navigate('login');
}

// ============================================
// 首页/导航
// ============================================
function renderHome() {
    const nav = renderNav('home');
    const app = document.getElementById('app');
    app.innerHTML = nav + `
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
    </div>`;
}

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
            <button class="btn btn-sm btn-ghost" onclick="doLogout()">退出</button>
        </div>
        <div class="app-nav">
            ${tabs.map(t => `<div class="nav-item ${active===t.id?'active':''}" onclick="navigate('${t.id}')">${t.label}</div>`).join('')}
        </div>
    </div>`;
}

// ============================================
// 数据加载
// ============================================
async function loadAllData() {
    const { data: students, error: e1 } = await supabase.from('students').select('*');
    const { data: scores, error: e2 } = await supabase.from('scores').select('*');
    if (!e1) state.students = students;
    if (!e2) state.scores = scores;
}

async function saveScore(studentId, project, value, unit = '') {
    const { data, error } = await supabase.from('scores').insert({
        student_id: studentId,
        project, value: parseFloat(value), unit
    }).select();
    if (!error && data) {
        state.scores.push(data[0]);
    }
    return { data, error };
}

// ============================================
// 50米跑多跑道秒表
// ============================================
function renderTimer() {
    const nav = renderNav('timer');
    document.getElementById('app').innerHTML = nav + `
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
                <button class="btn btn-primary big-btn" id="timer-start" onclick="timerStart()">▶ 开始</button>
                <button class="btn btn-ghost big-btn" id="timer-pause" onclick="timerPause()" disabled>⏸ 暂停</button>
                <button class="btn btn-danger big-btn" id="timer-reset" onclick="timerReset()">🔄 重置</button>
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
    const students = state.students;
    const lanes = [];
    for (let i = 0; i < count; i++) {
        const laneStudents = students.slice(i * 1, i * 1 + 1);
        lanes.push({ index: i + 1, student: laneStudents[0] || null });
        state.currentLaneTimes[i + 1] = { time: null };
    }
    const grid = document.getElementById('lane-grid');
    if (!grid) return;
    grid.innerHTML = lanes.map(l => `
        <div class="lane-item">
            <div class="lane-header">
                <div>
                    <span class="lane-num">第 ${l.index} 道</span>
                    ${l.student ? `<span class="lane-name">${l.student.name} (${l.student.gender})</span>` : '<span class="lane-name">未分配</span>'}
                </div>
                <div class="flex" style="gap:6px;">
                    <span class="lane-time" id="lane-time-${l.index}">—</span>
                    <button class="btn btn-sm btn-success" onclick="captureLane(${l.index})" id="lane-capture-${l.index}">⏺</button>
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
    document.getElementById('timer-start').disabled = true;
    document.getElementById('timer-pause').disabled = false;
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
    document.getElementById('timer-start').disabled = false;
    document.getElementById('timer-pause').disabled = true;
}

function timerReset() {
    state.timerRunning = false;
    state.timerPausedAt = 0;
    state.timerStartTime = null;
    if (timerRafId) cancelAnimationFrame(timerRafId);
    document.getElementById('timer-display').textContent = '00:00.00';
    document.getElementById('timer-display').classList.remove('running');
    document.getElementById('timer-start').disabled = false;
    document.getElementById('timer-pause').disabled = true;
    // 清空道次时间显示
    Object.keys(state.currentLaneTimes).forEach(k => {
        state.currentLaneTimes[k] = { time: null };
        const el = document.getElementById(`lane-time-${k}`);
        if (el) el.textContent = '—';
        const saveBtn = document.getElementById(`lane-save-${k}`);
        if (saveBtn) saveBtn.disabled = true;
    });
}

function captureLane(laneIndex) {
    if (!state.timerPausedAt && !state.timerRunning) return toast('先开始计时', 'error');
    
    // 如果在运行，先暂停
    if (state.timerRunning) timerPause();
    
    const elapsed = state.timerPausedAt;
    const seconds = elapsed / 1000;
    state.currentLaneTimes[laneIndex] = { time: seconds };
    
    const el = document.getElementById(`lane-time-${laneIndex}`);
    if (el) el.textContent = seconds.toFixed(2) + 's';
    
    const saveBtn = document.getElementById(`lane-save-${laneIndex}`);
    if (saveBtn) saveBtn.disabled = false;
    
    toast(`第 ${laneIndex} 道：${seconds.toFixed(2)}s`, 'success');
}

async function saveLaneScore(laneIndex) {
    const lane = state.currentLaneTimes[laneIndex];
    if (!lane?.time) return;
    
    // 找这道的学生
    const laneStudents = state.students.slice((laneIndex-1), laneIndex);
    const student = laneStudents[0];
    if (!student) return toast('请先导入学生名单', 'error');
    
    await saveScore(student.id, '50米跑', lane.time.toFixed(2), '秒');
    toast('成绩已保存！', 'success');
    const btn = document.getElementById(`lane-save-${laneIndex}`);
    if (btn) btn.textContent = '✓ 已保存';
}

// ============================================
// 跳绳倒计时 + 计数
// ============================================
function renderRope() {
    const nav = renderNav('rope');
    document.getElementById('app').innerHTML = nav + `
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
            <div id="rope-students"></div>
        </div>
    </div>`;
    
    ropeRenderStudents();
}

let ropeCountdown = 60;
function ropeStart() {
    if (state.countdownInterval) return;
    ropeCountdown = 60;
    state.countValue = 0;
    document.getElementById('rope-countdown').textContent = '60';
    document.getElementById('rope-count').textContent = '0';
    
    const timerEl = document.getElementById('rope-countdown');
    
    state.countdownInterval = setInterval(() => {
        ropeCountdown--;
        timerEl.textContent = ropeCountdown;
        if (ropeCountdown <= 10) {
            timerEl.classList.add('countdown');
            beep(440, 150); // 蜂鸣提示
        }
        if (ropeCountdown <= 0) {
            clearInterval(state.countdownInterval);
            state.countdownInterval = null;
            beep(880, 300);
            beep(880, 300);
            beep(880, 500);
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
    if (state.countdownInterval) {
        clearInterval(state.countdownInterval);
        state.countdownInterval = null;
    }
    ropeCountdown = 60;
    state.countValue = 0;
    document.getElementById('rope-countdown').textContent = '60';
    document.getElementById('rope-count').textContent = '0';
    document.getElementById('rope-countdown').classList.remove('countdown');
}

function ropeRenderStudents() {
    const el = document.getElementById('rope-students');
    if (!el) return;
    if (state.students.length === 0) {
        el.innerHTML = '<div class="empty"><div class="empty-icon">👥</div><div>暂无学生，请先导入名单</div><button class="btn btn-sm btn-primary" style="margin-top:12px;" onclick="navigate(\'students\')">去导入 →</button></div>';
        return;
    }
    // 按班级分组显示
    const byClass = {};
    state.students.forEach(s => {
        const key = `${s.grade||''}${s.class_name||'未分班'}`;
        (byClass[key] = byClass[key] || []).push(s);
    });
    el.innerHTML = Object.entries(byClass).map(([cls, list]) => `
        <div class="group-header">${cls}（${list.length}人）</div>
        ${list.map(s => `
            <div class="score-input-row">
                <div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''}</span></div>
                <input class="score-input-box" type="number" placeholder="次数" 
                       onchange="saveScore('${s.id}','一分钟跳绳',this.value,'次'); updateStudentLevel('${s.id}');">
                <div class="score-level" id="level-${s.id}"></div>
            </div>
        `).join('')}
    `).join('');
}

async function updateStudentLevel(studentId) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    const scores = state.scores.filter(sc => sc.student_id === studentId);
    
    let bestLevel = null;
    let levelText = '';
    
    // 检查各个关键项目
    const keyProjects = ['一分钟跳绳', '50米跑', '肺活量', '坐位体前屈', '立定跳远', '一分钟仰卧起坐', '耐力跑'];
    for (let sc of scores) {
        if (keyProjects.includes(sc.project)) {
            const result = getScore(student.grade, student.gender, sc.project, sc.value);
            if (result) {
                const badge = result.level === '优秀' ? 'badge-excellent' :
                              result.level === '良好' ? 'badge-good' :
                              result.level === '及格' ? 'badge-pass' : 'badge-fail';
                levelText += `<span class="badge ${badge}">${sc.project.slice(0,2)}:${result.level}</span> `;
            }
        }
    }
    
    const el = document.getElementById(`level-${studentId}`);
    if (el) el.innerHTML = levelText;
}

// ============================================
// 仰卧起坐（复用跳绳逻辑）
// ============================================
function renderSitup() {
    const nav = renderNav('situp');
    document.getElementById('app').innerHTML = nav + `
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
            <div id="situp-students">${state.students.length === 0 ? '<div class="empty">请先导入学生名单</div>' : state.students.map(s => `
                <div class="score-input-row">
                    <div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''}</span></div>
                    <input class="score-input-box" type="number" placeholder="次数"
                           onchange="saveScore('${s.id}','一分钟仰卧起坐',this.value,'次');">
                </div>
            `).join('')}</div>
        </div>
    </div>`;
    
    situpCountdown = 60;
    state.countValue = 0;
}

let situpCountdown = 60;
let situpInterval = null;

function situpStart() {
    if (situpInterval) return;
    situpCountdown = 60;
    state.countValue = 0;
    document.getElementById('situp-countdown').textContent = '60';
    document.getElementById('situp-count').textContent = '0';
    
    const timerEl = document.getElementById('situp-countdown');
    situpInterval = setInterval(() => {
        situpCountdown--;
        timerEl.textContent = situpCountdown;
        if (situpCountdown <= 10) { timerEl.classList.add('countdown'); beep(440, 150); }
        if (situpCountdown <= 0) {
            clearInterval(situpInterval);
            situpInterval = null;
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
// 耐力跑计时
// ============================================
function renderEndurance() {
    const nav = renderNav('endurance');
    document.getElementById('app').innerHTML = nav + `
    <div class="container">
        <div class="card">
            <div class="flex-between" style="margin-bottom:12px;">
                <div class="h2" style="margin:0;">🏃 耐力跑计时</div>
                <select id="endurance-type" class="input" style="width:120px;">
                    <option value="800">800米（女）</option>
                    <option value="1000">1000米（男）</option>
                </select>
            </div>
            <div class="timer-display" id="endurance-display">00:00.0</div>
            <div class="timer-controls">
                <button class="btn btn-primary big-btn" onclick="enduranceStart()">▶ 开始</button>
                <button class="btn btn-ghost big-btn" onclick="endurancePause()">⏸ 暂停</button>
                <button class="btn btn-danger big-btn" onclick="enduranceReset()">🔄 重置</button>
            </div>
            <p class="text-muted" style="text-align:center;font-size:12px;">每有一个同学冲过终点，点下方对应道次记录时间</p>
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

let enduranceRunning = false;
let enduranceStartTime = null;
let endurancePausedAt = 0;
let enduranceRafId = null;

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
    const tenth = Math.floor((elapsed % 1000) / 100);
    document.getElementById('endurance-display').textContent =
        String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0') + '.' + tenth;
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
// 快速录入（跳远/坐位体前屈/肺活量/身高体重/BMI）
// ============================================
function renderInput() {
    const nav = renderNav('input');
    const app = document.getElementById('app');
    app.innerHTML = nav + `
    <div class="container">
        <div class="card">
            <div class="h2">✏️ 快速录入</div>
            <div class="project-tabs" id="project-tabs">
                ${['身高体重(BMI)','肺活量','立定跳远','坐位体前屈','50米×8往返跑','1分钟跳绳','仰卧起坐'].map((p,i)=>
                    `<div class="project-tab ${i===0?'active':''}" onclick="switchInputProject(this,'${p}')">${p}</div>`).join('')}
            </div>
        </div>
        <div class="card" id="input-card">${renderInputContent('身高体重(BMI)')}</div>
    </div>`;
}

function switchInputProject(el, project) {
    document.querySelectorAll('.project-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('input-card').innerHTML = renderInputContent(project);
}

function renderInputContent(project) {
    if (state.students.length === 0) {
        return '<div class="empty"><div class="empty-icon">👥</div><div>暂无学生，请先导入名单</div></div>';
    }
    
    // 按班级分组
    const byClass = {};
    state.students.forEach(s => {
        const key = `${s.grade||''}${s.class_name||'未分班'}`;
        (byClass[key] = byClass[key] || []).push(s);
    });
    
    return Object.entries(byClass).map(([cls, list]) => `
        <div class="group-header">${cls}</div>
        ${list.map(s => renderInputRow(s, project)).join('')}
    `).join('');
}

function renderInputRow(student, project) {
    let inputs = '';
    
    if (project === '身高体重(BMI)') {
        // 从 scores 取已有值
        const heightSc = state.scores.find(sc => sc.student_id === student.id && sc.project === '身高');
        const weightSc = state.scores.find(sc => sc.student_id === student.id && sc.project === '体重');
        inputs = `
            <input class="score-input-box" type="number" placeholder="身高cm" value="${heightSc?.value||''}" 
                   onchange="saveScore('${student.id}','身高',this.value,'cm'); recalcBMI('${student.id}');" style="width:80px;">
            <input class="score-input-box" type="number" placeholder="体重kg" step="0.1" value="${weightSc?.value||''}"
                   onchange="saveScore('${student.id}','体重',this.value,'kg'); recalcBMI('${student.id}');" style="width:80px;">
            <span class="score-level" id="bmi-${student.id}"></span>
        `;
    } else {
        const projKey = project.replace('1分钟','一分钟').replace('50米×8往返跑','50米×8往返跑');
        const sc = state.scores.find(sc => sc.student_id === student.id && sc.project === projKey);
        inputs = `
            <input class="score-input-box" type="number" step="0.1" placeholder="${project}" value="${sc?.value||''}"
                   onchange="saveScore('${student.id}','${projKey}',this.value); showLevel('${student.id}','${projKey}',this.value);">
            <span class="score-level" id="qlevel-${student.id}-${projKey}"></span>
        `;
    }
    
    return `
        <div class="score-input-row">
            <div class="score-name">${student.name} <span style="font-size:12px;color:var(--text-muted);">${student.gender||''} · ${student.grade||''}</span></div>
            ${inputs}
        </div>
    `;
}

function recalcBMI(studentId) {
    const student = state.students.find(s => s.id === studentId);
    const heightSc = state.scores.find(sc => sc.student_id === studentId && sc.project === '身高');
    const weightSc = state.scores.find(sc => sc.student_id === studentId && sc.project === '体重');
    const el = document.getElementById(`bmi-${studentId}`);
    if (!heightSc || !weightSc || !el) return;
    
    const result = getScore(student.grade, student.gender, 'BMI', { height: heightSc.value, weight: weightSc.value });
    if (result) {
        const badge = result.level === '正常' ? 'badge-good' :
                      result.level === '低体重' ? 'badge-pass' :
                      result.level === '超重' ? 'badge-warning' : 'badge-fail';
        el.innerHTML = `<span class="badge ${badge}">BMI:${result.value}</span>`;
    }
}

function showLevel(studentId, project, value) {
    const student = state.students.find(s => s.id === studentId);
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
// 学生名单管理 + Excel 导入
// ============================================
function renderStudents() {
    const nav = renderNav('students');
    const app = document.getElementById('app');
    app.innerHTML = nav + `
    <div class="container">
        <div class="card">
            <div class="flex-between" style="margin-bottom:12px;">
                <div class="h2" style="margin:0;">👥 学生名单 (${state.students.length})</div>
                <div class="flex" style="gap:8px;">
                    <button class="btn btn-sm btn-ghost" onclick="downloadTemplate()">📥 下载模板</button>
                    <label class="btn btn-sm btn-primary" style="cursor:pointer;">
                        📂 导入 Excel
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
        el.innerHTML = '<div class="card empty"><div class="empty-icon">📋</div><div>还没有学生名单</div><p style="margin-top:8px;font-size:12px;">点"下载模板"获取空白模板，填好后点"导入 Excel"</p></div>';
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
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet');
    XLSX.writeFile(wb, '体测宝_导入模板.xlsx');
    toast('模板已下载', 'success');
}

async function importExcel(file) {
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet);
            
            let count = 0;
            for (let row of rows) {
                const student = {
                    name: String(row['姓名'] || row['name'] || '').trim(),
                    gender: String(row['性别'] || row['gender'] || '').trim(),
                    grade: String(row['年级'] || row['grade'] || '').trim(),
                    class_name: String(row['班级'] || row['班级名称'] || row['class'] || '').trim(),
                    student_id: String(row['学籍号'] || row['学号'] || '').trim(),
                    ethnicity: String(row['民族'] || row['民族代码'] || '').trim(),
                };
                if (!student.name) continue;
                
                const { data, error } = await supabase.from('students').insert(student).select();
                if (!error && data) { state.students.push(data[0]); count++; }
            }
            toast(`成功导入 ${count} 名学生！`, 'success');
            renderStudentsList();
        } catch (err) {
            toast('导入失败：' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

async function deleteStudent(id) {
    if (!confirm('确认删除该学生？')) return;
    await supabase.from('students').delete().eq('id', id);
    state.students = state.students.filter(s => s.id !== id);
    state.scores = state.scores.filter(sc => sc.student_id !== id);
    renderStudentsList();
}

async function deleteClass(clsKey) {
    if (!confirm(`确认删除整个班级 ${clsKey} ？该班所有学生和成绩都会被删除！`)) return;
    const toDelete = state.students.filter(s => `${s.grade||''}${s.class_name||'未分班'}` === clsKey);
    for (let s of toDelete) {
        await supabase.from('students').delete().eq('id', s.id);
    }
    state.students = state.students.filter(s => `${s.grade||''}${s.class_name||'未分班'}` !== clsKey);
    renderStudentsList();
}

// ============================================
// 成绩分析
// ============================================
function renderAnalysis() {
    const nav = renderNav('analysis');
    const app = document.getElementById('app');
    
    // 计算统计
    let totalStudents = state.students.length;
    let scoredStudents = new Set(state.scores.map(sc => sc.student_id)).size;
    
    // 按等级统计
    let levels = { '优秀': 0, '良好': 0, '及格': 0, '不及格': 0 };
    let projectLevels = {}; // {项目: {等级: 人数}}
    
    for (let sc of state.scores) {
        const student = state.students.find(s => s.id === sc.student_id);
        if (!student) continue;
        const result = getScore(student.grade, student.gender, sc.project, sc.value);
        if (result) {
            levels[result.level] = (levels[result.level] || 0) + 1;
            projectLevels[sc.project] = projectLevels[sc.project] || {};
            projectLevels[sc.project][result.level] = (projectLevels[sc.project][result.level] || 0) + 1;
        }
    }
    
    const total = Object.values(levels).reduce((a,b)=>a+b, 0);
    const excellentRate = total > 0 ? (levels['优秀']/total*100).toFixed(1) : 0;
    const passRate = total > 0 ? ((levels['优秀']+levels['良好']+levels['及格'])/total*100).toFixed(1) : 0;
    
    app.innerHTML = nav + `
    <div class="container">
        <div class="card">
            <div class="h2">📊 数据概览</div>
            <div class="stat-grid">
                <div class="stat-card">
                    <div class="stat-value">${totalStudents}</div>
                    <div class="stat-label">学生总数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${scoredStudents}</div>
                    <div class="stat-label">已录入成绩</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${excellentRate}%</div>
                    <div class="stat-label">优秀率</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${passRate}%</div>
                    <div class="stat-label">达标率</div>
                </div>
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
                    <div style="font-weight:600;">${proj} <span class="text-muted" style="font-size:12px;">(共${t}人)</span></div>
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
// 导出（21列国网体测网标准格式）
// ============================================
function renderExport() {
    const nav = renderNav('export');
    const app = document.getElementById('app');
    
    // 按年级编号排序
    const gradeOrder = ['一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级'];
    const sortedStudents = [...state.students].sort((a,b) => {
        const ai = gradeOrder.indexOf(a.grade);
        const bi = gradeOrder.indexOf(b.grade);
        if (ai !== bi) return ai - bi;
        return (a.class_name||'').localeCompare(b.class_name||'');
    });
    
    app.innerHTML = nav + `
    <div class="container">
        <div class="card" style="background:linear-gradient(135deg,#16a34a,#15803d);color:white;text-align:center;">
            <div style="font-size:20px;font-weight:700;margin-bottom:8px;">📤 一键导出国网体测网格式</div>
            <div style="font-size:13px;opacity:0.9;margin-bottom:14px;">${state.students.length} 名学生 · 21 列标准格式 · 可直接上传</div>
            <button class="btn btn-block btn-lg" style="background:rgba(255,255,255,0.2);color:white;" onclick="doExport()">📥 下载 Excel 文件</button>
        </div>
        
        <div class="card">
            <div class="h2" style="font-size:14px;">📋 导出预览（前 5 行）</div>
            <div style="overflow-x:auto;font-size:12px;">
                <table style="width:100%;border-collapse:collapse;">
                    <tr style="background:#f1f5f9;">
                        ${EXPORT_COLUMNS.map(c => `<th style="padding:6px;border:1px solid #e2e8f0;text-align:left;">${c}</th>`).join('')}
                    </tr>
                    ${sortedStudents.slice(0,5).map(s => {
                        const row = buildExportRow(s);
                        return `<tr>
                            ${EXPORT_COLUMNS.map(c => `<td style="padding:4px;border:1px solid #e2e8f0;">${row[c]||''}</td>`).join('')}
                        </tr>`;
                    }).join('')}
                </table>
            </div>
        </div>
        
        <div class="card empty">
            <div class="empty-icon">⚠️</div>
            <div style="margin-bottom:8px;">导出前请确认</div>
            <p style="font-size:12px;color:var(--text-muted);">
                1. 每个学生都填了：姓名、性别、年级、班级<br>
                2. 对应年级的必测项目都已录入实测值<br>
                3. 导出后直接上传"国家学生体质健康标准管理系统"的"体测成绩导入"
            </p>
        </div>
    </div>`;
}

function buildExportRow(student) {
    const gm = GRADE_MAP[student.grade] || { code: 0 };
    const classNum = (student.class_name || '').match(/\d+/)?.[0] || '1';
    const classCode = `${gm.code}${String(classNum).padStart(2,'0')}`;
    
    // 取各项目分数
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
    // 女生 800 米，男生 1000 米，只输出自己测的那个
    if (which === '800' && gender !== '女') return '';
    if (which === '1000' && gender !== '男') return '';
    
    // value 可能是秒数（数字）或分秒字符串
    let seconds = parseFloat(value);
    if (isNaN(seconds)) return value;
    const mm = Math.floor(seconds / 60);
    const ss = Math.floor(seconds % 60);
    return `${mm}'${String(ss).padStart(2,'0')}"`;
}

function doExport() {
    if (state.students.length === 0) return toast('没有学生数据', 'error');
    
    const gradeOrder = ['一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级'];
    const sortedStudents = [...state.students].sort((a,b) => {
        const ai = gradeOrder.indexOf(a.grade);
        const bi = gradeOrder.indexOf(b.grade);
        if (ai !== bi) return ai - bi;
        return (a.class_name||'').localeCompare(b.class_name||'');
    });
    
    const rows = sortedStudents.map(s => {
        const row = buildExportRow(s);
        return EXPORT_COLUMNS.map(c => row[c] || '');
    });
    
    // 加表头
    const aoa = [EXPORT_COLUMNS, ...rows];
    
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = EXPORT_COLUMNS.map(c => ({ wch: 14 }));
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '体测成绩');
    
    const now = new Date();
    const fn = `体测宝_体测成绩_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`;
    XLSX.writeFile(wb, fn);
    
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
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + duration / 1000);
        osc.onended = () => ctx.close();
    } catch(e) {}
}

// ============================================
// PWA Service Worker 注册
// ============================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(()=>{});
    });
}

// ============================================
// 启动
// ============================================
(async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
        state.user = session.user;
        await checkActivationAndNavigate();
    } else {
        navigate('login');
    }
    
    supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user && !state.user) {
            state.user = session.user;
            checkActivationAndNavigate();
        }
    });
})();
