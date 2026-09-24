// ============================================
// 体测宝 - 授权流程 v2
// - 全局试用到期日：2027-01-31（全平台统一）
// - 注册：邮箱验证码 → 设置密码
// - 到期后功能灰化，可看不能用
// - 永久码：绕过全局到期
// ============================================

// ====== 全局硬编码 ======
const TRIAL_END = new Date('2027-01-31T23:59:59Z');
function trialDaysLeft() { return Math.ceil((TRIAL_END - new Date()) / 86400000); }
function isTrialExpired() { return new Date() > TRIAL_END; }

// ====== 全局状态 ======
let state = {
    authed: false,
    userEmail: null,
    userPlan: null,
    planExpires: null,     // 永久码为 null，体验码有值
    signupStep: 0,         // 0=未开始 1=已发验证码 2=待设密码
    signupEmail: null,
    students: [],
    scores: [],
    absences: [],
    currentGrade: null,
    currentClass: null,
    timerStartTime: null,
    timerRunning: false,
    timerPausedAt: 0,
    countdownInterval: null,
    countValue: 0,
};

// ====== LocalStorage 读写 ======
const LS = {
    get(key, def) {
        try { return JSON.parse(localStorage.getItem(key)) ?? def; }
        catch { return def; }
    },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
    del(key) { localStorage.removeItem(key); }
};

// ====== 自动加载 + 检查授权 ======
function loadFromStorage() {
    state.students = LS.get('tb_students', []);
    state.scores = LS.get('tb_scores', []);
    state.absences = LS.get('tb_absences', []);
    
    const auth = LS.get('tb_auth', null);
    if (auth) {
        state.authed = true;
        state.userEmail = auth.email;
        state.userPlan = auth.plan;
        state.planExpires = auth.expires;
        
        // 判断是否过期（两层：全局到期日 + 体验码到期日）
        if (auth.plan === 'PERMANENT') {
            state.userPlan = 'PERMANENT'; // 永不过期
        } else if (auth.expires && new Date(auth.expires) < new Date()) {
            // 体验码（如 1 天）过期
            state.userPlan = 'EXPIRED';
        } else if (isTrialExpired() && auth.plan !== 'PERMANENT') {
            // 全局到期日
            state.userPlan = 'EXPIRED';
        }
    }
}

function saveStudents() { 
    LS.set('tb_students', state.students); 
    // 异步推送到云端（连不上就跳过，不阻塞主流程）
    if (window.SB && SB.ready()) SB.syncStudents(state.students).catch(() => {});
}
function saveScores() {
    LS.set('tb_scores', state.scores);
    if (window.SB && SB.ready()) SB.syncScores(state.scores).catch(() => {});
}

// ====== 请假记录（独立存储，不混入成绩，避免污染统计） ======
function saveAbsences() {
    LS.set('tb_absences', state.absences);
    if (window.SB && SB.ready()) SB.syncAbsences(state.absences).catch(() => {});
}
function getAbsence(studentId, project) { return state.absences.find(a => a.student_id === studentId && a.project === project); }
function toggleAbsence(studentId, project, navId) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    const existing = getAbsence(studentId, project);
    if (existing) {
        state.absences = state.absences.filter(a => a !== existing);
        saveAbsences();
        toast(`${student.name} 已取消「${project}」请假`, 'success');
    } else {
        const note = prompt(`给 ${student.name} 记「${project}」请假\n原因（可留空，直接点确定）：`);
        if (note === null) return; // 点了取消
        state.absences.push({ id: genUUID(), student_id: studentId, project, date: new Date().toISOString().slice(0, 10), note: note.trim() });
        saveAbsences();
        toast(`${student.name} 已记「${project}」请假`, 'success');
    }
    navigate(navId);
}
// 行内请假按钮（已请假显示红标记 + 撤销按钮）
function _absenceCell(studentId, project, navId) {
    const abs = getAbsence(studentId, project);
    if (abs) {
        const tip = abs.note ? `（${abs.note}）` : '';
        return `<span class="badge badge-fail" style="font-size:11px;margin:0 4px;" title="${tip}">请假${abs.note ? '·' + abs.note : ''}</span><button class="btn btn-sm btn-ghost" style="padding:4px 8px;font-size:12px;" onclick="toggleAbsence('${studentId}','${project}','${navId}')">↩ 撤销</button>`;
    }
    return `<button class="btn btn-sm btn-ghost" style="padding:4px 8px;font-size:12px;color:#dc2626;" onclick="toggleAbsence('${studentId}','${project}','${navId}')">🚫 请假</button>`;
}
// 导出请假名单 Excel（project 不传 = 导出全部项目）
function exportAbsences(project) {
    const list = project ? state.absences.filter(a => a.project === project) : state.absences;
    if (list.length === 0) return toast('没有请假记录', 'error');
    const stu = id => state.students.find(s => s.id === id);
    const aoa = [['姓名', '班级', '性别', '请假项目', '请假日期', '原因备注']];
    list.forEach(a => {
        const s = stu(a.student_id);
        aoa.push([s?.name || '(学生已删除)', s ? `${s.grade || ''}${s.class_name || ''}` : '', s?.gender || '', a.project, a.date, a.note || '']);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 6 }, { wch: 16 }, { wch: 12 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '请假名单');
    const now = new Date();
    const tag = project ? `_${project}` : '';
    XLSX.writeFile(wb, `体测宝_请假名单${tag}_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`);
    toast('请假名单导出成功！', 'success');
}

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

// ====== 班级筛选（全局，所有录入页面共用） ======
window._classFilter = '全部';
function _getAllClasses() {
    const set = new Set();
    state.students.forEach(s => set.add(`${s.grade||''}${s.class_name||'未分班'}`));
    return Array.from(set).sort();
}
function _getFilteredStudents() {
    if (window._classFilter === '全部') return state.students;
    return state.students.filter(s => `${s.grade||''}${s.class_name||'未分班'}` === window._classFilter);
}
function _classFilterBar() {
    const classes = _getAllClasses();
    if (classes.length <= 1) return ''; // 只有一个班级不显示筛选器
    const opts = ['全部', ...classes];
    return `<div class="card" style="padding:10px 16px;margin-bottom:12px;background:#eff6ff;border-color:#bfdbfe;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-size:13px;color:#1e40af;font-weight:600;">🏫 班级筛选：</span>
            <select class="input" style="padding:4px 10px;font-size:13px;width:auto;" 
                onchange="window._classFilter=this.value;document.querySelectorAll('.filter-reload').forEach(fn=>fn());renderHome();">
                ${opts.map(c => `<option value="${c}" ${c===window._classFilter?'selected':''}>${c}</option>`).join('')}
            </select>
            <span style="font-size:12px;color:#64748b;">当前 ${_getFilteredStudents().length} / ${state.students.length} 人</span>
        </div>
    </div>`;
}

// ====== 语音播报（Web Speech API，纯前端） ======
window._speechQueue = [];
window._speechPlaying = false;
function _speak(text) {
    if (!('speechSynthesis' in window)) return; // 浏览器不支持
    try {
        // 停掉当前播报，立即播新的
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = 1.0;
        u.pitch = 1.0;
        u.volume = 1.0;
        speechSynthesis.speak(u);
    } catch(e) { /* 忽略 */ }
}
function _stopSpeak() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// ============================================
// 路由
// ============================================
function navigate(view) {
    document.getElementById('app').innerHTML = '';
    window.scrollTo(0, 0);
    
    // 未登录 → 强制去登录页
    if (!state.authed && view !== 'auth') {
        renderAuth();
        return;
    }
    
    switch(view) {
        case 'auth': renderAuth(); break;
        case 'home': renderHome(); break;
        case 'timer': renderTimer(); break;
        case 'rope': renderRope(); break;
        case 'situp': renderSitup(); break;
        case 'endurance': renderEndurance(); break;
        case 'height': renderHeightEntry(); break;
        case 'vital': renderSingleEntry('肺活量','vital','ml'); break;
        case 'longjump': renderSingleEntry('立定跳远','longjump','cm'); break;
        case 'sitflex': renderSingleEntry('坐位体前屈','sitflex','cm'); break;
        case 'rollcall': renderRollCall(); break;
        case 'students': renderStudents(); break;
        case 'export': renderExport(); break;
        case 'analysis': renderAnalysis(); break;
        case 'admin': renderAdmin(); break;
        default: renderHome();
    }
    
    // 到期 → 在页面顶部叠加灰色遮罩（功能灰化）
    if (state.authed && state.userPlan === 'EXPIRED') {
        setTimeout(addExpiredOverlay, 50);
    }
}

function addExpiredOverlay() {
    // 去掉旧的
    document.getElementById('expired-overlay')?.remove();
    
    const banner = document.createElement('div');
    banner.id = 'expired-overlay';
    banner.innerHTML = `
    <div style="position:fixed;top:0;left:0;right:0;background:linear-gradient(90deg,#991b1b,#dc2626);color:white;padding:12px 16px;z-index:9999;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
        ⏰ 试用已结束（${TRIAL_END.toLocaleDateString('zh-CN')} 到期），当前为只读模式。
        <a href="javascript:void(0)" onclick="navigate('home'); setTimeout(addUpgradeModal,100)" style="color:#fef3c7;text-decoration:underline;margin-left:10px;">👉 购买永久版解锁全部功能</a>
        <button onclick="this.parentElement.remove()" style="float:right;background:rgba(255,255,255,0.2);border:none;color:white;padding:2px 8px;border-radius:4px;cursor:pointer;">✕</button>
    </div>`;
    document.body.appendChild(banner);
    document.body.style.paddingTop = '0'; // fixed banner
}

function addUpgradeModal() {
    if (state.userPlan !== 'EXPIRED') return;
    document.getElementById('upgrade-modal')?.remove();
    
    const modal = document.createElement('div');
    modal.id = 'upgrade-modal';
    modal.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;">
        <div style="background:white;border-radius:16px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="text-align:center;font-size:40px;">👑</div>
            <div style="text-align:center;font-size:20px;font-weight:700;margin-top:8px;">升级永久版</div>
            <div style="text-align:center;font-size:13px;color:#888;margin:8px 0 20px;">解锁所有功能 · 永久使用 · 免费升级</div>
            <div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:10px;padding:16px;margin-bottom:16px;">
                <div style="font-weight:700;color:#92400e;margin-bottom:8px;">💰 购买方式</div>
                <div style="font-size:13px;color:#78350f;line-height:1.7;">
                    添加微信咨询购买：<br>
                    <b style="display:inline-block;background:#7c2d12;color:#fef3c7;padding:4px 14px;border-radius:6px;font-size:16px;margin-top:6px;">pp33721</b>
                </div>
            </div>
            <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;margin-bottom:16px;">
                <div style="font-weight:600;color:#166534;margin-bottom:8px;">🔑 输入激活码</div>
                <input id="upgrade-code" class="input" style="text-transform:uppercase;margin-bottom:10px;" placeholder="TCB-PERMANENT-XXXXXX">
                <button class="btn btn-primary btn-block" onclick="doRedeemFromModal()">✅ 激活</button>
            </div>
            <button class="btn btn-block btn-ghost" onclick="document.getElementById('upgrade-modal').remove()">稍后再说</button>
        </div>
    </div>`;
    document.body.appendChild(modal);
}

async function doRedeemFromModal() {
    const code = document.getElementById('upgrade-code').value.trim().toUpperCase();
    if (!code) return toast('请输入激活码', 'error');
    
    toast('⏳ 验证中...', 'info');
    let ok = false, result = null;
    if (window.SB && SB.ready()) {
        result = await SB.verifyCode(code);
        if (result && result.ok) ok = true;
    }
    if (!ok) return toast('激活码无效或已使用', 'error');
    
    // 激活（区分永久码/体验码）
    const plan = result.plan || 'PERMANENT';
    const days = result.days ?? 99999;
    const expires = days >= 99999 ? null : new Date(Date.now() + days * 86400000).toISOString();
    
    state.userPlan = plan;
    state.planExpires = expires;
    LS.set('tb_auth', { email: state.userEmail, plan, expires });
    
    toast(`🎉 ${plan === 'PERMANENT' ? '永久版' : days + '天体验'}激活成功！`, 'success');
    document.getElementById('upgrade-modal')?.remove();
    document.getElementById('expired-overlay')?.remove();
    renderHome();
}

function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

// ============================================
// 评分引擎
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
// 登录 / 注册（OTP 邮箱验证码 + 设置密码）
// ============================================
let authMode = 'login';

function renderAuth() {
    document.getElementById('app').innerHTML = `
    <div class="container" style="padding-top:60px;">
        <div class="auth-card" style="box-shadow:none;padding:20px 0;">
            <div class="activation-banner">
                <div style="font-size:14px;opacity:0.9;">🏃 体测宝 · 学校体育测试工具</div>
                <div style="font-size:20px;font-weight:600;margin-top:4px;">${state.signupStep === 2 ? '设置您的密码' : (authMode === 'signup' ? '邮箱验证码注册' : '登录您的账号')}</div>
                ${state.signupStep === 0 && authMode === 'signup' ? `<div style="font-size:12px;opacity:0.8;margin-top:8px;">✅ 注册即可免费使用到 ${TRIAL_END.toLocaleDateString('zh-CN')}</div>` : ''}
            </div>
            ${state.signupStep === 0 ? `
            <div style="display:flex;gap:0;margin-bottom:16px;border-radius:8px;overflow:hidden;">
                <div class="auth-tab ${authMode==='signup'?'active':''}" onclick="authMode='signup';renderAuth();">📝 注册</div>
                <div class="auth-tab ${authMode==='login'?'active':''}" onclick="authMode='login';renderAuth();">🔑 登录</div>
            </div>
            ${authMode === 'signup' ? renderSignupStep1() : renderLoginForm()}
            ` : state.signupStep === 1 ? renderSignupStep2() : renderSignupStep3()}
            ${renderAnnouncement()}
        </div>
    </div>`;
}

function renderSignupStep1() {
    return `
    <div class="form-group">
        <label class="label">邮箱</label>
        <input id="auth-email" class="input" type="email" placeholder="example@school.com">
    </div>
    <button class="btn btn-primary btn-block btn-lg" onclick="sendOtp()">📧 发送验证码</button>
    <div style="text-align:center;margin-top:10px;font-size:12px;color:#888;">我们将发送验证码到您的邮箱</div>`;
}

function renderSignupStep2() {
    return `
    <div style="text-align:center;margin-bottom:12px;font-size:13px;color:#888;">验证码已发送至 <b>${state.signupEmail}</b></div>
    <div class="form-group">
        <label class="label">邮箱验证码（6 位数字）</label>
        <input id="auth-otp" class="input" type="text" placeholder="请输入 6 位验证码" autocomplete="one-time-code" inputmode="numeric" maxlength="6">
    </div>
    <button class="btn btn-primary btn-block btn-lg" onclick="verifyOtp()">✅ 验证并继续</button>
    <button class="btn btn-block btn-ghost" onclick="resendOtp()">📨 重新发送</button>
    <button class="btn btn-block btn-ghost" onclick="state.signupStep=0;renderAuth();">← 返回</button>`;
}

function renderSignupStep3() {
    return `
    <div style="text-align:center;margin-bottom:12px;font-size:13px;color:#888;">邮箱 <b>${state.signupEmail}</b> 已验证，请设置密码</div>
    <div class="form-group">
        <label class="label">密码（至少 6 位）</label>
        <input id="auth-password" class="input" type="password" placeholder="******">
    </div>
    <div class="form-group">
        <label class="label">确认密码</label>
        <input id="auth-password2" class="input" type="password" placeholder="******">
    </div>
    <button class="btn btn-primary btn-block btn-lg" onclick="finishSignup()">🎉 完成注册</button>`;
}

function renderLoginForm() {
    return `
    <div class="form-group">
        <label class="label">邮箱</label>
        <input id="auth-email" class="input" type="email" placeholder="example@school.com">
    </div>
    <div class="form-group">
        <label class="label">密码</label>
        <input id="auth-password" class="input" type="password" placeholder="******">
    </div>
    <button class="btn btn-primary btn-block btn-lg" onclick="doSignIn()">🔑 登录</button>
    <div style="text-align:right;margin:8px 0;">
        <a style="color:#2563eb;font-size:13px;cursor:pointer;" onclick="forgotPassword()">忘记密码？</a>
    </div>
    <button class="btn btn-block btn-ghost" onclick="authMode='signup';renderAuth();">📝 没有账号？注册</button>`;
}

// === 验证码流程 ===
async function sendOtp() {
    const email = document.getElementById('auth-email').value.trim();
    if (!email || !email.includes('@')) return toast('请输入有效邮箱', 'error');
    
    toast('⏳ 发送验证码中...', 'info');
    try {
        if (window.SB && SB.ready() && window.supabase) {
            const { error } = await supabase.auth.signInWithOtp({ email, shouldCreateUser: true });
            if (error) throw error;
        }
        state.signupEmail = email;
        state.signupStep = 1;
        toast('✅ 验证码已发送，请查收邮箱', 'success');
        renderAuth();
    } catch (e) {
        toast('发送失败: ' + e.message, 'error');
    }
}

async function verifyOtp() {
    const otp = document.getElementById('auth-otp').value.trim();
    if (!otp || otp.length < 4) return toast('请输入有效验证码', 'error');
    
    toast('⏳ 验证中...', 'info');
    try {
        if (window.SB && SB.ready() && window.supabase) {
            // 用 type: 'email' —— signInWithOtp 创建的 session 只能用 'email' 类型验证
            const { data, error } = await supabase.auth.verifyOtp({
                email: state.signupEmail,
                token: otp,
                type: 'email'
            });
            if (error) throw error;
            console.log('[体测宝] OTP 验证成功:', data);
        }
        state.signupStep = 2;
        toast('✅ 邮箱验证成功', 'success');
        renderAuth();
    } catch (e) {
        console.error('[体测宝] OTP 验证失败:', e);
        toast('验证码错误或已过期，请重试', 'error');
    }
}

async function resendOtp() {
    if (!state.signupEmail) { state.signupStep = 0; renderAuth(); return; }
    toast('⏳ 重新发送中...', 'info');
    try {
        if (window.SB && SB.ready() && window.supabase) {
            const { error } = await supabase.auth.signInWithOtp({ email: state.signupEmail, shouldCreateUser: true });
            if (error) throw error;
        }
        toast('✅ 已重新发送，请查收邮箱', 'success');
    } catch (e) {
        toast('发送失败: ' + e.message, 'error');
    }
}

async function finishSignup() {
    const p1 = document.getElementById('auth-password').value;
    const p2 = document.getElementById('auth-password2').value;
    if (p1.length < 6) return toast('密码至少 6 位', 'error');
    if (p1 !== p2) return toast('两次密码不一致', 'error');
    
    toast('⏳ 创建账号中...', 'info');
    try {
        // 必须确保 Supabase 就绪
        if (!window.SB || !SB.ready() || !window.supabase) {
            return toast('❌ 云端未连接，无法设置密码。请刷新页面重试。', 'error');
        }
        if (!state.signupEmail) {
            return toast('❌ 注册信息丢失，请重新注册。', 'error');
        }
        
        // 强制设置密码（必须成功！）
        const { error } = await supabase.auth.updateUser({ password: p1 });
        if (error) {
            console.error('[体测宝] 设置密码失败:', error);
            return toast('❌ 设置密码失败: ' + error.message, 'error');
        }
        console.log('[体测宝] ✅ 密码设置成功！', state.signupEmail);
        
        const email = state.signupEmail;
        state.authed = true;
        state.userEmail = email;
        state.userPlan = isTrialExpired() ? 'EXPIRED' : 'TRIAL';
        state.planExpires = null;
        LS.set('tb_auth', { email, plan: state.userPlan, expires: null });
        
        state.signupStep = 0;
        state.signupEmail = null;
        
        toast(`🎉 注册成功！${isTrialExpired() ? '试用已结束' : `免费使用到 ${TRIAL_END.toLocaleDateString('zh-CN')}`}`, 'success');
        navigate('home');
    } catch (e) {
        console.error('[体测宝] finishSignup 异常:', e);
        toast('注册失败: ' + e.message, 'error');
    }
}

// === 登录 ===
async function doSignIn() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) return toast('请填写完整', 'error');
    
    toast('⏳ 登录中...', 'info');
    try {
        let found = false, finalAuth = null;
        
        // Supabase Auth
        if (window.SB && SB.ready() && window.supabase) {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (!error && data.user) {
                found = true;
                finalAuth = { email: data.user.email, plan: 'TRIAL', expires: null };
            }
        }
        
        // 本地降级
        if (!found) {
            const auth = LS.get('tb_auth', null);
            if (auth && auth.email === email) {
                finalAuth = auth;
                found = true;
            }
        }
        
        if (!found) return toast('邮箱或密码错误', 'error');
        
        state.authed = true;
        state.userEmail = finalAuth.email;
        state.userPlan = finalAuth.plan;
        state.planExpires = finalAuth.expires;
        
        // 重新判断是否到期
        if (finalAuth.plan === 'PERMANENT') {
            // 永不到期
        } else if (finalAuth.expires && new Date(finalAuth.expires) < new Date()) {
            state.userPlan = 'EXPIRED';
        } else if (isTrialExpired() && finalAuth.plan !== 'PERMANENT') {
            state.userPlan = 'EXPIRED';
        }
        
        toast('✅ 登录成功', 'success');
        navigate('home');
    } catch (e) {
        toast('登录失败', 'error');
    }
}

// === 忘记密码 ===
async function forgotPassword() {
    const email = prompt('📧 请输入您的注册邮箱，我们会发送重置密码链接：');
    if (!email || !email.includes('@')) return;
    
    toast('⏳ 发送中...', 'info');
    try {
        if (!window.supabase) throw new Error('云端未连接');
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin
        });
        if (error) throw error;
        toast('✅ 重置密码邮件已发送，请查收', 'success');
    } catch (e) {
        toast('发送失败: ' + e.message, 'error');
    }
}

function doSignOut() {
    LS.del('tb_auth');
    state.authed = false;
    state.userEmail = null;
    state.userPlan = null;
    state.planExpires = null;
    state.signupStep = 0;
    state.signupEmail = null;
    if (window.supabase) supabase.auth.signOut().catch(() => {});
    toast('已退出登录', 'success');
    navigate('auth');
}

// ============================================
// 首页 + 导航
// ============================================
function renderPlanBadge() {
    if (!state.authed) return '<span class="badge badge-fail">未登录</span>';
    if (state.userPlan === 'PERMANENT') return '<span class="badge badge-excellent">👑 永久版</span>';
    if (state.userPlan === 'EXPIRED') return '<span class="badge badge-fail" style="cursor:pointer" onclick="addUpgradeModal()">⏰ 试用已结束 · 点击升级</span>';
    // TRIAL
    const days = trialDaysLeft();
    if (state.planExpires) {
        // 体验码（如 1 天）
        const exp = new Date(state.planExpires);
        const left = Math.max(0, Math.ceil((exp - new Date()) / 86400000));
        return `<span class="badge" style="background:#fef3c7;color:#92400e;">⏱ 体验还剩 ${left} 天</span>`;
    }
    return `<span class="badge" style="background:#fef3c7;color:#92400e;">⏱ 免费至 ${TRIAL_END.toLocaleDateString('zh-CN')}（剩 ${days} 天）</span>`;
}

function renderNav(active) {
    const cloudOnline = window.SB && SB.ready();
    const cloudStatus = cloudOnline 
        ? '<span class="badge badge-excellent" style="font-size:10px;">☁️ 云端</span>' 
        : '<span class="badge badge-pass" style="font-size:10px;">💻 本机</span>';
    const tabs = [
        { id: 'home', label: '🏠 首页' },
        { id: 'timer', label: '⏱️ 计时' },
        { id: 'rope', label: '🪢 跳绳' },
        { id: 'situp', label: '🤸 仰卧起坐' },
        { id: 'endurance', label: '🏃 耐力跑' },
        { id: 'height', label: '📏 身高体重' },
        { id: 'vital', label: '💨 肺活量' },
        { id: 'longjump', label: '🦘 跳远' },
        { id: 'sitflex', label: '📐 体前屈' },
        { id: 'rollcall', label: '📢 点名' },
        { id: 'students', label: '👥 名单' },
        { id: 'analysis', label: '📊 分析' },
        { id: 'export', label: '📤 导出' },
    ];
    return `
    <div class="app-header">
        <div class="flex-between" style="margin-bottom:8px;">
            <div class="nav-title">🏃 体测宝 ${cloudStatus}</div>
            <div class="flex" style="gap:8px;">
                ${renderPlanBadge()}
                ${cloudOnline ? `<button class="btn btn-sm btn-ghost" onclick="manualSync()">☁️ 同步</button>` : ''}
                <button class="btn btn-sm btn-ghost" onclick="doSignOut()" title="退出登录">👤</button>
                <button class="btn btn-sm btn-ghost" onclick="navigate('admin')" title="管理员后台">⚙️</button>
            </div>
        </div>
        <div class="app-nav">
            ${tabs.map(t => `<div class="nav-item ${active===t.id?'active':''}" onclick="navigate('${t.id}')">${t.label}</div>`).join('')}
        </div>
    </div>`;
}

// ============================================
// 公告栏
// ============================================
function renderAnnouncement() {
    const signupTip = state.authed && state.userPlan === 'TRIAL'
        ? `⏱ 免费使用至 <b>${TRIAL_END.toLocaleDateString('zh-CN')}</b>（剩余 ${trialDaysLeft()} 天）`
        : `✅ 注册即享免费试用至 <b>${TRIAL_END.toLocaleDateString('zh-CN')}</b>`;
    const expiredTip = state.userPlan === 'EXPIRED'
        ? `<span style="color:#b91c1c;">⏰ 您的试用已结束，请购买永久版解锁全部功能</span><br>`
        : '';
    return `
    <div class="announcement-bar" style="background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#7c2d12;padding:14px 18px;border-radius:10px;font-size:13px;line-height:1.7;">
        <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;">📢 公告</div>
        ${expiredTip}
        ${signupTip}<br>
        💰 <b>购买永久版 / 技术支持</b>，请添加微信：<b style="font-size:15px;background:#7c2d12;color:#fef3c7;padding:2px 10px;border-radius:4px;display:inline-block;margin-top:2px;">pp33721</b>
    </div>`;
}

// 手动触发云端同步
async function manualSync() {
    if (!window.SB || !SB.ready()) return toast('当前离线，无法同步', 'error');
    toast('⏳ 正在同步到云端...', 'info');
    const studentResult = await SB.syncStudents(state.students);
    const scoreResult = await SB.syncScores(state.scores);
    const absResult = await SB.syncAbsences(state.absences);
    const total = (studentResult.count || 0) + (scoreResult.count || 0) + (absResult.count || 0);
    toast(`☁️ 同步完成！共 ${total} 条数据`, 'success');
    renderNav(document.querySelector('.nav-item.active')?.getAttribute('onclick')?.match(/'(\w+)'/)?.[1] || 'home');
}

function renderHome() {
    document.getElementById('app').innerHTML = renderNav('home') + `
    <div class="container">
        ${renderAnnouncement()}
        <div class="h2">📋 快速开始</div>
        <div class="card" style="background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white;">
            <div style="font-size:18px;font-weight:600;">⏱️ 50米跑计时</div>
            <div style="font-size:13px;opacity:0.9;margin:6px 0 14px;">多跑道秒表，毫秒精度</div>
            <button class="btn btn-block" style="background:rgba(255,255,255,0.2);color:white;" onclick="navigate('timer')">开始计时 →</button>
        </div>
        <div class="grid-2">
            <div class="card" onclick="navigate('rope')" style="cursor:pointer;"><div style="font-size:24px;">🪢</div><div style="font-weight:600;margin-top:6px;">跳绳计数</div><div class="text-muted" style="font-size:12px;">60秒倒计时 + 手动点按</div></div>
            <div class="card" onclick="navigate('situp')" style="cursor:pointer;"><div style="font-size:24px;">🤸</div><div style="font-weight:600;margin-top:6px;">仰卧起坐</div><div class="text-muted" style="font-size:12px;">60秒计时 + 计数</div></div>
            <div class="card" onclick="navigate('endurance')" style="cursor:pointer;"><div style="font-size:24px;">🏃‍♂️</div><div style="font-weight:600;margin-top:6px;">耐力跑</div><div class="text-muted" style="font-size:12px;">800米/1000米计时</div></div>
            <div class="card" onclick="navigate('height')" style="cursor:pointer;"><div style="font-size:24px;">📏</div><div style="font-weight:600;margin-top:6px;">身高体重</div><div class="text-muted" style="font-size:12px;">自动计算 BMI</div></div>
            <div class="card" onclick="navigate('vital')" style="cursor:pointer;"><div style="font-size:24px;">💨</div><div style="font-weight:600;margin-top:6px;">肺活量</div><div class="text-muted" style="font-size:12px;">成绩录入</div></div>
            <div class="card" onclick="navigate('longjump')" style="cursor:pointer;"><div style="font-size:24px;">🦘</div><div style="font-weight:600;margin-top:6px;">立定跳远</div><div class="text-muted" style="font-size:12px;">成绩录入</div></div>
            <div class="card" onclick="navigate('sitflex')" style="cursor:pointer;"><div style="font-size:24px;">📐</div><div style="font-weight:600;margin-top:6px;">坐位体前屈</div><div class="text-muted" style="font-size:12px;">成绩录入</div></div>
            <div class="card" onclick="navigate('rollcall')" style="cursor:pointer;"><div style="font-size:24px;">📢</div><div style="font-weight:600;margin-top:6px;">排队点名</div><div class="text-muted" style="font-size:12px;">语音播报名字</div></div>
        </div>
        <div class="h2" style="margin-top:24px;">📚 数据管理</div>
        <div class="card" onclick="navigate('students')" style="cursor:pointer;"><div class="flex-between"><div><div style="font-weight:600;">👥 学生名单</div><div class="text-muted" style="font-size:12px;">共 ${state.students.length} 名学生 · Excel 导入</div></div><span>→</span></div></div>
        <div class="card" onclick="navigate('analysis')" style="cursor:pointer;"><div class="flex-between"><div><div style="font-weight:600;">📊 成绩分析</div><div class="text-muted" style="font-size:12px;">查看评分、统计达标率</div></div><span>→</span></div></div>
        <div class="card" onclick="navigate('export')" style="cursor:pointer;"><div class="flex-between"><div><div style="font-weight:600;">📤 导出上报</div><div class="text-muted" style="font-size:12px;">21列标准 Excel · 直接上传国网体测网</div></div><span>→</span></div></div>
        <div class="card text-muted" style="font-size:12px;margin-top:24px;">💾 数据存储在本浏览器本地，换设备请用"导出"和"导入"功能迁移</div>
    </div>`;
}

function saveLS(collection, data) { LS.set('tb_' + collection, data); }
// 生成标准 UUID（匹配 Supabase 数据库的 uuid 类型）
function genUUID() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // 回退方案
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function addStudent(s) { s.id = genUUID(); state.students.push(s); saveStudents(); }
function deleteStudent(id) { state.students = state.students.filter(s => s.id !== id); state.scores = state.scores.filter(sc => sc.student_id !== id); state.absences = state.absences.filter(a => a.student_id !== id); saveStudents(); saveScores(); saveAbsences(); }
function saveScore(studentId, project, value, unit = '') {
    state.scores = state.scores.filter(sc => !(sc.student_id === studentId && sc.project === project));
    state.scores.push({ id: genUUID(), student_id: studentId, project, value: parseFloat(value), unit, recorded_at: new Date().toISOString() });
    saveScores();
}
function clearAll() { if (!confirm('确定要清空所有学生和成绩数据吗？此操作不可恢复！')) return; state.students = []; state.scores = []; state.absences = []; saveStudents(); saveScores(); saveAbsences(); toast('已清空', 'success'); renderHome(); }

// ============================================
// 50米跑多跑道秒表
// ============================================
// ====== 50米跑独立计时器状态 ======
let timerQueue = [];          // 时间队列
let timerPhase = 'running';   // 'running' | 'claiming'
let targetLaneCount = 6;      // 目标道次数（4/6/8）
let timerRafId = null;

// ====== 50米跑 UI（两阶段：计时中 → 认领中） ======
function renderTimer() {
    const isClaim = timerPhase === 'claiming';
    const displayEl = document.getElementById('timer-display');
    document.getElementById('app').innerHTML = renderNav('timer') + `
    <div class="container">
        <div class="card">
            <div class="flex-between" style="margin-bottom:8px;">
                <div class="h2" style="margin:0;">⏱️ 50米跑计时</div>
                <select id="timer-lanes" class="input" style="width:80px;" onchange="changeLaneCount(this.value)">
                    <option value="4" ${targetLaneCount==4?'selected':''}>4 道</option>
                    <option value="6" ${targetLaneCount==6?'selected':''}>6 道</option>
                    <option value="8" ${targetLaneCount==8?'selected':''}>8 道</option>
                </select>
            </div>
            <div class="timer-display ${state.timerRunning?'running':''}" id="timer-display">00:00.00</div>
            ${!isClaim ? `
            <div class="timer-controls" style="grid-template-columns:1fr 1fr;">
                <button class="btn btn-primary big-btn" onclick="timerStart()" ${state.timerRunning?'disabled':''}>▶ 开始</button>
                <button class="btn btn-danger big-btn" onclick="timerPause()" ${!state.timerRunning?'disabled':''}>⏸ 暂停</button>
            </div>
            <div style="margin-top:16px;text-align:center;">
                <button class="end-capture-btn" onclick="timerCaptureQueue()" ${!state.timerRunning?'disabled':''}>
                    ⏺ 冲线！
                    <div style="font-size:14px;font-weight:400;margin-top:2px;">已记录 ${timerQueue.length} / ${targetLaneCount} 次</div>
                </button>
            </div>
            <div class="card" style="margin-top:16px;margin-bottom:0;background:#f0fdf4;border:1px solid #86efac;">
                <div style="font-size:13px;color:#15803d;font-weight:600;">✅ 时间队列</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">
                    ${timerQueue.length === 0 ? `<span style="font-size:12px;color:#94a3b8;">点击大按钮记录（电脑空格键也可以）。按够 ${targetLaneCount} 次自动暂停</span>` : timerQueue.map((q,i) => `<span class="badge badge-good" style="font-size:12px;">#${i+1} ${q.display}</span>`).join('')}
                </div>
            </div>
            ` : `
            <div style="background:#fef3c7;border:1px solid #fbbf24;padding:12px;border-radius:8px;margin-bottom:12px;">
                <div style="font-size:14px;font-weight:700;color:#92400e;">🎯 认领模式</div>
                <div style="font-size:12px;color:#92400e;margin-top:4px;">点每个学生后面的 ⏺，自动分配队列里的下一个时间给他。想给谁就给谁！</div>
            </div>
            <div class="flex" style="gap:6px;margin-bottom:12px;">
                <button class="btn btn-sm btn-ghost" onclick="timerBackToRun()">↩ 返回继续计时</button>
                <button class="btn btn-sm btn-success" onclick="timerFinishAll()">✅ 完成保存</button>
                <button class="btn btn-sm btn-danger" onclick="timerResetAll()">🔄 全部清空</button>
            </div>
            <div style="background:#f0fdf4;border:1px solid #86efac;padding:10px;border-radius:8px;margin-bottom:12px;">
                <div style="font-size:12px;color:#15803d;font-weight:600;">📋 时间队列（${timerQueue.length}个）· 点击学生⏺消耗下一个</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
                    ${timerQueue.map((q,i) => { const used = i < getTimerSavedCount(); return `<span class="badge ${used?'badge-pass':'badge-good'}" style="font-size:12px;">#${i+1} ${q.display}${used?' ✓':''}</span>`; }).join('')}
                </div>
            </div>
            `}
        </div>
        ${!isClaim ? '' : `<div class="card"><div class="h2" style="margin-bottom:8px;">🎯 认领名单（点⏺分配时间）</div>${renderTimerClaimList()}</div>`}
    </div>`;
    document.onkeydown = (e) => { if (e.code === 'Space') { e.preventDefault(); if (!isClaim && state.timerRunning) timerCaptureQueue(); } };
}

function changeLaneCount(val) {
    const newCount = parseInt(val);
    if (timerQueue.length > 0 && !confirm(`改成 ${newCount} 道，当前队列 ${timerQueue.length} 个时间会保留。确定继续？`)) {
        renderTimer();
        return;
    }
    targetLaneCount = newCount;
    renderTimer();
}

function getTimerSavedCount() { return state.scores.filter(sc => sc.project === '50米跑').length; }

function renderTimerClaimList() {
    if (state.students.length === 0) return '<div class="empty">请先导入学生名单</div>';
    const savedMap = {};
    state.scores.filter(sc => sc.project === '50米跑').forEach(sc => { savedMap[sc.student_id] = sc; });
    const usedCount = Object.keys(savedMap).length;
    
    const byClass = {};
    _getFilteredStudents().forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    
    return Object.entries(byClass).map(([cls, list]) => `
        <div class="group-header" style="font-size:13px;">${cls} (${list.length}人)</div>
        ${list.map(s => {
            const saved = savedMap[s.id];
            const canClaim = usedCount < timerQueue.length;
            return `<div class="end-row">
                <div class="end-name">
                    <span style="font-weight:600;">${s.name}</span>
                    <span style="font-size:11px;color:var(--text-muted);margin-left:4px;">${s.gender||''}</span>
                    ${saved ? `<span class="badge badge-pass" style="margin-left:6px;font-size:11px;">已认领</span>` : ''}
                    ${_absenceCell(s.id,'50米跑','timer')}
                </div>
                ${saved ? `<span style="font-family:monospace;font-weight:700;color:#059669;font-size:13px;">${saved.value.toFixed(2)}s</span>` : `<button class="btn btn-sm btn-success" style="padding:6px 10px;font-size:13px;" onclick="timerClaimToStudent('${s.id}')" ${!canClaim?'disabled':''}>⏺ 认领</button>`}
            </div>`;
        }).join('')}
    `).join('');
}

function timerClaimToStudent(studentId) {
    const savedCount = getTimerSavedCount();
    if (savedCount >= timerQueue.length) return toast('队列时间不够了！', 'error');
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    const q = timerQueue[savedCount];
    saveScore(studentId, '50米跑', q.seconds.toFixed(2), '秒');
    toast(`队列#${savedCount+1} ${q.display} → ${student.name} ✓`, 'success');
    renderTimer();
}

function timerStart() {
    if (state.timerRunning) return;
    // 如果之前暂停过，从暂停处继续；否则重新开始
    if (!state.timerStartTime) { state.timerStartTime = performance.now(); state.timerPausedAt = 0; }
    else { state.timerStartTime = performance.now() - state.timerPausedAt; }
    state.timerRunning = true;
    // 开始新一轮计时时，清空旧队列
    timerQueue = [];
    renderTimer();  // ⚠️ 关键：刷新按钮disabled状态（参照 enduranceStart 的写法）
    timerTick();
    beep(880, 250);
}

function timerTick() {
    if (!state.timerRunning) return;
    const elapsed = performance.now() - state.timerStartTime;
    const ms = elapsed % 1000, s = Math.floor(elapsed / 1000), mm = Math.floor(s / 60), ss = s % 60;
    const el = document.getElementById('timer-display');
    if (el) el.textContent = String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0') + '.' + String(Math.floor(ms/10)).padStart(2,'0');
    timerRafId = requestAnimationFrame(timerTick);
}

function getCurrentTimerSeconds() {
    if (state.timerRunning) return (performance.now() - state.timerStartTime) / 1000;
    return state.timerPausedAt / 1000;
}

function timerPause() {
    state.timerRunning = false;
    if (timerRafId) cancelAnimationFrame(timerRafId);
    state.timerPausedAt = performance.now() - state.timerStartTime;
    // 如果有队列时间，自动进入认领模式
    if (timerQueue.length === 0) {
        renderTimer();
        return;
    }
    timerPhase = 'claiming';
    toast(`计时结束！共 ${timerQueue.length} 个冲线时间 → 请认领给学生`, 'success');
    renderTimer();
}

function timerReset() {
    state.timerRunning = false;
    if (timerRafId) cancelAnimationFrame(timerRafId);
    state.timerPausedAt = 0;
    state.timerStartTime = null;
    timerQueue = [];
    const el = document.getElementById('timer-display');
    if (el) { el.textContent = '00:00.00'; el.classList.remove('running'); }
}

function timerCaptureQueue() {
    if (!state.timerRunning) return toast('先点"开始"！', 'error');
    const secs = getCurrentTimerSeconds();
    if (secs <= 0) return;
    const display = `${secs.toFixed(2)}s`;
    timerQueue.push({ seconds: secs, display });
    beep(800, 100);
    
    // 按够目标次数，自动暂停并进入认领模式
    if (timerQueue.length >= targetLaneCount) {
        toast(`已记录 ${timerQueue.length} 次（${targetLaneCount} 道已满），自动暂停！`, 'success');
        timerPause();
    } else {
        renderTimer();
    }
}

function timerBackToRun() {
    timerPhase = 'running';
    renderTimer();
}

function timerResetAll() {
    if (!confirm('确定要清空所有计时和50米跑成绩吗？此操作不可恢复！')) return;
    state.scores = state.scores.filter(sc => sc.project !== '50米跑');
    state.absences = state.absences.filter(a => a.project !== '50米跑');
    saveScores(); saveAbsences();
    state.timerRunning = false;
    if (timerRafId) cancelAnimationFrame(timerRafId);
    state.timerPausedAt = 0;
    state.timerStartTime = null;
    timerQueue = [];
    timerPhase = 'running';
    const el = document.getElementById('timer-display');
    if (el) { el.textContent = '00:00.00'; el.classList.remove('running'); }
    renderTimer();
    toast('已清空', 'success');
}

function timerFinishAll() {
    const savedCount = getTimerSavedCount();
    if (savedCount === 0) return toast('还没有认领任何成绩', 'error');
    if (savedCount < timerQueue.length && !confirm(`还有 ${timerQueue.length - savedCount} 个时间未分配，确定要结束吗？`)) return;
    toast(`✅ 完成！已保存 ${savedCount} 条50米跑成绩`, 'success');
    timerQueue = [];
    timerPhase = 'running';
    state.timerPausedAt = 0;
    state.timerStartTime = null;
    const el = document.getElementById('timer-display');
    if (el) { el.textContent = '00:00.00'; el.classList.remove('running'); }
    renderTimer();
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
            <p class="text-muted" style="margin-top:12px;font-size:12px;">提示：按空格键也可以 +1</p>
        </div>
        <div class="card">
            <div class="h2">快速录入学生成绩</div>
            <div id="rope-students"></div>
        </div>
    </div>`;
    document.onkeydown = (e) => { if (e.code === 'Space') { e.preventDefault(); ropeCount(1); } };
    document.getElementById('rope-students').innerHTML = renderRopeStudents();
}
let ropeCountdown = 60;
function ropeStart() {
    if (state.countdownInterval) return;
    ropeCountdown = 60; state.countValue = 0;
    document.getElementById('rope-countdown').textContent = '60';
    document.getElementById('rope-count').textContent = '0';
    const timerEl = document.getElementById('rope-countdown');
    state.countdownInterval = setInterval(() => {
        ropeCountdown--; timerEl.textContent = ropeCountdown;
        if (ropeCountdown <= 10) { timerEl.classList.add('countdown'); beep(440, 150); }
        if (ropeCountdown <= 0) { clearInterval(state.countdownInterval); state.countdownInterval = null; beep(880, 300); beep(880, 300); beep(880, 500); toast(`时间到！共 ${state.countValue} 次`, 'success'); timerEl.classList.remove('countdown'); }
    }, 1000);
}
function ropeCount(delta) { state.countValue = Math.max(0, state.countValue + delta); document.getElementById('rope-count').textContent = state.countValue; }
function ropeReset() { if (state.countdownInterval) { clearInterval(state.countdownInterval); state.countdownInterval = null; } ropeCountdown = 60; state.countValue = 0; document.getElementById('rope-countdown').textContent = '60'; document.getElementById('rope-count').textContent = '0'; document.getElementById('rope-countdown').classList.remove('countdown'); }
function renderRopeStudents() {
    if (state.students.length === 0) return '<div class="empty">暂无学生，请先导入名单</div>';
    const byClass = {};
    _getFilteredStudents().forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    return Object.entries(byClass).map(([cls, list]) => `<div class="group-header">${cls}（${list.length}人）</div>${list.map(s => { const sc = state.scores.find(sc => sc.student_id === s.id && sc.project === '一分钟跳绳'); return `<div class="score-input-row"><div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''}</span></div>${_absenceCell(s.id,'一分钟跳绳','rope')}<input class="score-input-box" type="number" placeholder="次数" value="${sc?.value||''}" onchange="saveScore('${s.id}','一分钟跳绳',this.value,'次'); showLevel('${s.id}','一分钟跳绳',this.value);"><div class="score-level" id="qlevel-${s.id}-一分钟跳绳"></div></div>`; }).join('')}`).join('');
}
function showLevel(studentId, project, value, suppressDOM) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return null;
    const result = getScore(student.grade, student.gender, project, value);
    if (!result) return null;
    if (!suppressDOM) {
        const el = document.getElementById(`qlevel-${studentId}-${project}`);
        if (!el) return result.level;
        const badge = result.level === '优秀' ? 'badge-excellent' : result.level === '良好' ? 'badge-good' : result.level === '及格' ? 'badge-pass' : 'badge-fail';
        el.innerHTML = `<span class="badge ${badge}">${result.level} ${result.score}分</span>`;
    }
    return result.level;
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
        <div class="card"><div class="h2">快速录入</div>${state.students.length === 0 ? '<div class="empty">请先导入名单</div>' : state.students.map(s => `<div class="score-input-row"><div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''}</span></div>${_absenceCell(s.id,'一分钟仰卧起坐','situp')}<input class="score-input-box" type="number" placeholder="次数" onchange="saveScore('${s.id}','一分钟仰卧起坐',this.value,'次');"></div>`).join('')}</div>
    </div>`;
}
let situpInterval = null, situpCountdown = 60;
function situpStart() {
    if (situpInterval) return;
    situpCountdown = 60; state.countValue = 0;
    document.getElementById('situp-countdown').textContent = '60';
    document.getElementById('situp-count').textContent = '0';
    const timerEl = document.getElementById('situp-countdown');
    situpInterval = setInterval(() => { situpCountdown--; timerEl.textContent = situpCountdown; if (situpCountdown <= 10) { timerEl.classList.add('countdown'); beep(440, 150); } if (situpCountdown <= 0) { clearInterval(situpInterval); situpInterval = null; beep(880, 300); beep(880, 300); beep(880, 500); toast(`时间到！共 ${state.countValue} 次`, 'success'); timerEl.classList.remove('countdown'); } }, 1000);
}
function situpCount(delta) { state.countValue = Math.max(0, state.countValue + delta); document.getElementById('situp-count').textContent = state.countValue; }
function situpReset() { if (situpInterval) { clearInterval(situpInterval); situpInterval = null; } situpCountdown = 60; state.countValue = 0; document.getElementById('situp-countdown').textContent = '60'; document.getElementById('situp-count').textContent = '0'; document.getElementById('situp-countdown').classList.remove('countdown'); }

// ============================================
// 耐力跑（⏺大按钮连按 + 认领模式）
// ============================================
let enduranceQueue = []; let endurancePhase = 'running'; let enduranceType = '800米跑';
let enduranceRunning = false, enduranceStartTime = null, endurancePausedAt = 0, enduranceRafId = null;

// 耐力跑成绩统一存 '耐力跑'（导出时按性别自动分到 800/1000 列）
const ENDURANCE_PROJECT = '耐力跑';

function renderEndurance() {
    const isClaim = endurancePhase === 'claiming';
    document.getElementById('app').innerHTML = renderNav('endurance') + `
    <div class="container">
        <div class="card">
            <div class="flex-between" style="margin-bottom:8px;">
                <div class="h2" style="margin:0;">🏃 耐力跑计时</div>
                <select class="input" style="padding:6px;font-size:13px;" onchange="enduranceType=this.value;renderEndurance();">
                    <option value="800米跑" ${enduranceType==='800米跑'?'selected':''}>800米(女生)</option>
                    <option value="1000米跑" ${enduranceType==='1000米跑'?'selected':''}>1000米(男生)</option>
                </select>
            </div>
            <div class="timer-display ${enduranceRunning?'running':''}" id="endurance-display">00:00.00</div>
            ${!isClaim ? `
            <div class="timer-controls" style="grid-template-columns:1fr 1fr;">
                <button class="btn btn-primary big-btn" onclick="enduranceStart()" ${enduranceRunning?'disabled':''}>▶ 开始</button>
                <button class="btn btn-danger big-btn" onclick="endurancePause()" ${!enduranceRunning?'disabled':''}>⏸ 暂停</button>
            </div>
            <div style="margin-top:16px;text-align:center;">
                <button class="end-capture-btn" onclick="enduranceCaptureQueue()" ${!enduranceRunning?'disabled':''}>
                    ⏺ 冲线！
                    <div style="font-size:14px;font-weight:400;margin-top:2px;">已记录 ${enduranceQueue.length} 个</div>
                </button>
            </div>
            <div class="card" style="margin-top:16px;margin-bottom:0;background:#f0fdf4;border:1px solid #86efac;">
                <div style="font-size:13px;color:#15803d;font-weight:600;">✅ 时间队列</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">
                    ${enduranceQueue.length === 0 ? '<span style="font-size:12px;color:#94a3b8;">点击大按钮记录（电脑空格键也可以）</span>' : enduranceQueue.map((q,i) => `<span class="badge badge-good" style="font-size:12px;">#${i+1} ${q.display}</span>`).join('')}
                </div>
                ${enduranceQueue.length > 0 ? `<button class="btn btn-ghost btn-block btn-sm" style="margin-top:10px;" onclick="endurancePause()">⏸ 暂停 → 进入认领模式</button>` : ''}
            </div>
            ` : `
            <div style="background:#fef3c7;border:1px solid #fbbf24;padding:12px;border-radius:8px;margin-bottom:12px;">
                <div style="font-size:14px;font-weight:700;color:#92400e;">🎯 认领模式</div>
                <div style="font-size:12px;color:#92400e;margin-top:4px;">点每个学生后面的 ⏺，自动分配队列里的下一个时间给他。想给谁就给谁！</div>
            </div>
            <div class="flex" style="gap:6px;margin-bottom:12px;">
                <button class="btn btn-sm btn-ghost" onclick="enduranceBackToRun()">↩ 返回继续计时</button>
                <button class="btn btn-sm btn-success" onclick="enduranceFinishAll()">✅ 完成保存</button>
                <button class="btn btn-sm btn-danger" onclick="enduranceResetAll()">🔄 全部清空</button>
            </div>
            <div style="background:#f0fdf4;border:1px solid #86efac;padding:10px;border-radius:8px;margin-bottom:12px;">
                <div style="font-size:12px;color:#15803d;font-weight:600;">📋 时间队列（${enduranceQueue.length}个）· 点击学生⏺消耗下一个</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
                    ${enduranceQueue.map((q,i) => { const used = i < enduranceQueue.used; return `<span class="badge ${used?'badge-pass':'badge-good'}" style="font-size:12px;">#${i+1} ${q.display}${used?' ✓':''}</span>`; }).join('')}
                </div>
            </div>
            `}
        </div>
        ${!isClaim ? '' : `<div class="card"><div class="h2" style="margin-bottom:8px;">🎯 认领名单（点⏺分配时间）</div>${renderClaimStudentList()}</div>`}
    </div>`;
    document.onkeydown = (e) => { if (e.code === 'Space') { e.preventDefault(); if (!isClaim && enduranceRunning) enduranceCaptureQueue(); } };
}

function getSavedCount() { return state.scores.filter(sc => sc.project === ENDURANCE_PROJECT).length; }

function renderClaimStudentList() {
    if (state.students.length === 0) return '<div class="empty">请先导入学生名单</div>';
    const savedMap = {};
    state.scores.filter(sc => sc.project === ENDURANCE_PROJECT).forEach(sc => { savedMap[sc.student_id] = sc; });
    const usedCount = Object.keys(savedMap).length;
    
    const byClass = {};
    _getFilteredStudents().forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    
    return Object.entries(byClass).map(([cls, list]) => `
        <div class="group-header" style="font-size:13px;">${cls} (${list.length}人)</div>
        ${list.map(s => {
            const saved = savedMap[s.id];
            const canClaim = usedCount < enduranceQueue.length;
            return `<div class="end-row">
                <div class="end-name">
                    <span style="font-weight:600;">${s.name}</span>
                    <span style="font-size:11px;color:var(--text-muted);margin-left:4px;">${s.gender||''}</span>
                    ${saved ? `<span class="badge badge-pass" style="margin-left:6px;font-size:11px;">已认领</span>` : ''}
                    ${_absenceCell(s.id,'耐力跑','endurance')}
                </div>
                ${saved ? (() => { const mm = Math.floor(saved.value/60), ss = Math.floor(saved.value%60); return `<span style="font-family:monospace;font-weight:700;color:#059669;font-size:13px;">${mm}'${String(ss).padStart(2,'0')}"</span>`; })() : `<button class="btn btn-sm btn-success" style="padding:6px 10px;font-size:13px;" onclick="claimToStudent('${s.id}')" ${!canClaim?'disabled':''}>⏺ 认领</button>`}
            </div>`;
        }).join('')}
    `).join('');
}

function claimToStudent(studentId) {
    const savedCount = getSavedCount();
    if (savedCount >= enduranceQueue.length) return toast('队列时间不够了！', 'error');
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    const q = enduranceQueue[savedCount];
    saveScore(studentId, ENDURANCE_PROJECT, q.seconds.toFixed(2), '秒');
    toast(`队列#${savedCount+1} ${q.display} → ${student.name} ✓`, 'success');
    renderEndurance();
}

function enduranceBackToRun() { endurancePhase = 'running'; renderEndurance(); }

function enduranceResetAll() {
    if (!confirm('确定要清空所有计时和耐力跑成绩吗？此操作不可恢复！')) return;
    state.scores = state.scores.filter(sc => sc.project !== ENDURANCE_PROJECT);
    state.absences = state.absences.filter(a => a.project !== '耐力跑');
    saveScores(); saveAbsences();
    enduranceRunning = false;
    if (enduranceRafId) cancelAnimationFrame(enduranceRafId);
    endurancePausedAt = 0; enduranceStartTime = null;
    enduranceQueue = []; endurancePhase = 'running';
    renderEndurance();
    toast('已清空', 'success');
}

function enduranceStart() {
    if (enduranceRunning) return;
    if (!enduranceStartTime) { enduranceStartTime = performance.now(); endurancePausedAt = 0; }
    else { enduranceStartTime = performance.now() - endurancePausedAt; }
    enduranceRunning = true;
    enduranceQueue = [];
    renderEndurance();
    enduranceTick();
    beep(880, 250);
}
function enduranceTick() {
    if (!enduranceRunning) return;
    const elapsed = performance.now() - enduranceStartTime;
    const ms = elapsed % 1000, s = Math.floor(elapsed / 1000), mm = Math.floor(s / 60), ss = s % 60;
    const el = document.getElementById('endurance-display');
    if (el) el.textContent = String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0') + '.' + String(Math.floor(ms/10)).padStart(2,'0');
    enduranceRafId = requestAnimationFrame(enduranceTick);
}
function getCurrentEnduranceSeconds() { if (enduranceRunning) return (performance.now() - enduranceStartTime) / 1000; return endurancePausedAt / 1000; }
function endurancePause() {
    enduranceRunning = false;
    if (enduranceRafId) cancelAnimationFrame(enduranceRafId);
    endurancePausedAt = performance.now() - enduranceStartTime;
    if (enduranceQueue.length === 0) return toast('计时暂停，但没有冲线记录', 'info');
    endurancePhase = 'claiming';
    toast(`计时结束！共 ${enduranceQueue.length} 个冲线时间 → 请认领给学生`, 'success');
    renderEndurance();
}
function enduranceCaptureQueue() {
    if (!enduranceRunning) return toast('先点"开始"！', 'error');
    const secs = getCurrentEnduranceSeconds();
    const mm = Math.floor(secs / 60), ss = Math.floor(secs % 60), cs = Math.floor((secs % 1) * 100);
    const display = `${mm}'${String(ss).padStart(2,'0')}"${String(cs).padStart(2,'0')}`;
    enduranceQueue.push({ seconds: secs, display });
    beep(800, 100);
    renderEndurance();
}
function enduranceFinishAll() {
    const savedCount = getSavedCount();
    if (savedCount === 0) return toast('还没有认领任何成绩', 'error');
    if (savedCount < enduranceQueue.length && !confirm(`还有 ${enduranceQueue.length - savedCount} 个时间未分配，确定要结束吗？`)) return;
    toast(`✅ 完成！已保存 ${savedCount} 条 ${enduranceType} 成绩`, 'success');
    enduranceRunning = false;
    enduranceQueue = []; endurancePhase = 'running'; endurancePausedAt = 0; enduranceStartTime = null;
    renderEndurance();
}

// ============================================
// 身高体重 (BMI) 独立录入
// ============================================
function renderHeightEntry() {
    document.getElementById('app').innerHTML = renderNav('height') + `
    <div class="container">
        ${_classFilterBar()}
        <div class="card">
            <div class="h2">📏 身高体重录入 (自动计算 BMI)</div>
            <div class="text-muted" style="font-size:12px;margin-top:4px;">输入身高(cm)和体重(kg)，自动判定 BMI 等级</div>
        </div>
        <div class="card" id="input-card"></div>
    </div>`;
    _renderBMI();
}
function _renderBMI() {
    const el = document.getElementById('input-card');
    if (!el) return;
    if (state.students.length === 0) { el.innerHTML = '<div class="empty">暂无学生，请先导入名单</div>'; return; }
    const byClass = {};
    _getFilteredStudents().forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    el.innerHTML = Object.entries(byClass).map(([cls, list]) => `<div class="group-header">${cls}</div>${list.map(s => {
        const scH = state.scores.find(sc => sc.student_id === s.id && sc.project === '身高');
        const scW = state.scores.find(sc => sc.student_id === s.id && sc.project === '体重');
        return `<div class="score-input-row">
            <div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''} · ${s.grade||''}</span></div>
            ${_absenceCell(s.id,'身高体重','height')}
            <input class="score-input-box" type="number" placeholder="身高cm" value="${scH?.value||''}" onchange="saveScore('${s.id}','身高',this.value,'cm');_renderBMI();" style="width:85px;">
            <input class="score-input-box" type="number" placeholder="体重kg" step="0.1" value="${scW?.value||''}" onchange="saveScore('${s.id}','体重',this.value,'kg');_renderBMI();" style="width:85px;">
            <span class="score-level" id="bmi-${s.id}"></span>
        </div>`;
    }).join('')}`).join('');
    state.students.forEach(s => { const hSc = state.scores.find(sc => sc.student_id === s.id && sc.project === '身高'); const wSc = state.scores.find(sc => sc.student_id === s.id && sc.project === '体重'); if (hSc && wSc) recalcBMI(s.id); });
}
function recalcBMI(studentId) {
    const student = state.students.find(s => s.id === studentId);
    const hSc = state.scores.find(sc => sc.student_id === studentId && sc.project === '身高');
    const wSc = state.scores.find(sc => sc.student_id === studentId && sc.project === '体重');
    const el = document.getElementById(`bmi-${studentId}`);
    if (!hSc || !wSc || !el) return;
    const result = calcBMI(student.grade, student.gender, { height: hSc.value, weight: wSc.value });
    if (result) { const badge = result.level === '正常' ? 'badge-good' : result.level === '低体重' ? 'badge-pass' : result.level === '超重' ? 'badge-warning' : 'badge-fail'; el.innerHTML = `<span class="badge ${badge}">BMI:${result.value}</span>`; }
}

// ============================================
// 单项目通用录入（肺活量/跳远/坐位体前屈）
// ============================================
function renderSingleEntry(project, navId, unit) {
    const iconMap = { '肺活量': '💨', '立定跳远': '🦘', '坐位体前屈': '📐', '50米×8往返跑': '🔁' };
    const icon = iconMap[project] || '📝';
    document.getElementById('app').innerHTML = renderNav(navId) + `
    <div class="container">
        ${_classFilterBar()}
        <div class="card">
            <div class="h2">${icon} ${project} 成绩录入</div>
            <div class="text-muted" style="font-size:12px;margin-top:4px;">单位：${unit} · 每个学生一个输入框，自动计算等级</div>
        </div>
        <div class="card" id="input-card"></div>
    </div>`;
    _renderSingle(project, unit, navId);
}
function _renderSingle(project, unit, navId) {
    const el = document.getElementById('input-card');
    if (!el) return;
    if (state.students.length === 0) { el.innerHTML = '<div class="empty">暂无学生，请先导入名单</div>'; return; }
    const byClass = {};
    _getFilteredStudents().forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    const existing = state.scores.find(sc => sc.project === project); // 检查有没有评分表
    const showLevel = !!existing;
    el.innerHTML = Object.entries(byClass).map(([cls, list]) => `<div class="group-header">${cls}</div>${list.map(s => {
        const sc = state.scores.find(sc => sc.student_id === s.id && sc.project === project);
        const onChg = `saveScore('${s.id}','${project}',this.value,'${unit}');${showLevel?'showLevelBadge(\"'+s.id+'\",\"'+project+'\",this.value);':''}`;
        return `<div class="score-input-row">
            <div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''} · ${s.grade||''}</span></div>
            ${_absenceCell(s.id, project, navId || '')}
            <input class="score-input-box" type="number" step="0.1" placeholder="${unit}" value="${sc?.value||''}" onchange="${onChg}">
            <span class="score-level" id="sl-${s.id}-${project}"></span>
        </div>`;
    }).join('')}`).join('');
    if (showLevel) state.students.forEach(s => { const sc = state.scores.find(sc => sc.student_id === s.id && sc.project === project); if (sc) showLevelBadge(s.id, project, sc.value); });
}
function showLevelBadge(studentId, project, value) {
    const el = document.getElementById(`sl-${studentId}-${project}`);
    if (!el || !value) { if (el) el.innerHTML = ''; return; }
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    // 评分逻辑复用 showLevel
    const level = showLevel(studentId, project, value, true);
    if (level) {
        const badge = level === '优秀' || level === '满分' ? 'badge-excellent' : level === '良好' ? 'badge-good' : level === '及格' || level === '通过' ? 'badge-pass' : 'badge-fail';
        el.innerHTML = `<span class="badge ${badge}">${level}</span>`;
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
                    <label class="btn btn-sm btn-primary" style="cursor:pointer;">📂 导入<input type="file" accept=".xlsx,.xls" onchange="importExcel(this.files[0])" style="display:none;"></label>
                </div>
            </div>
        </div>
        <div id="students-list"></div>
    </div>`;
    const el = document.getElementById('students-list');
    if (state.students.length === 0) { el.innerHTML = '<div class="card empty">📋 还没有学生名单<br><span style="font-size:12px;">点"模板"下载，填好后点"导入"</span></div>'; return; }
    const byClass = {};
    _getFilteredStudents().forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    el.innerHTML = Object.entries(byClass).map(([cls, list]) => `<div class="card"><div class="flex-between" style="margin-bottom:8px;"><div class="h2" style="margin:0;">${cls} <span style="font-size:14px;color:var(--text-muted);">(${list.length}人)</span></div><button class="btn btn-sm btn-danger" onclick="if(confirm('确认删除？')){state.students=state.students.filter(s=>'${cls}'.indexOf((s.grade||'')+(s.class_name||'未分班'))<0);saveStudents();renderStudents();}">删除班级</button></div>${list.map(s => `<div class="student-row"><div class="student-info"><div class="name">${s.name}</div><div class="meta">${s.gender||''} ${s.student_id||''}</div></div><button class="btn btn-sm btn-ghost" onclick="deleteStudent('${s.id}');renderStudents();">删除</button></div>`).join('')}</div>`).join('');
}
function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
        ['姓名','性别','年级','班级','学籍号','民族'],
        ['张三','男','四年级','1','2024010001','汉族'],
        ['李四','女','四年级','1','2024010002','汉族']
    ]);
    ws['!cols'] = [{wch:10},{wch:6},{wch:10},{wch:6},{wch:15},{wch:6}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '学生名单');
    XLSX.writeFile(wb, '体测宝_导入模板.xlsx');
    toast('模板已下载', 'success');
}
function importExcel(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            let count = 0;
            for (let row of rows) {
                const s = { name: String(row['姓名']||'').trim(), gender: String(row['性别']||'').trim(), grade: String(row['年级']||'').trim(), class_name: String(row['班级']||row['班级名称']||'').trim(), student_id: String(row['学籍号']||'').trim(), ethnicity: String(row['民族']||'').trim() };
                if (s.name) { addStudent(s); count++; }
            }
            toast(`成功导入 ${count} 名学生！`, 'success');
            renderStudents();
        } catch (err) { toast('导入失败：' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(file);
}

// ============================================
// 成绩分析
// ============================================
// ============================================
// 训练/饮食建议知识库已独立到 advice-knowledge.js（window.TCB_ADVICE）
// 校准建议内容时只改那个文件即可
// ============================================
const TRAINING_ADVICE = (window.TCB_ADVICE && window.TCB_ADVICE.training) || {};
const DIET_ADVICE = (window.TCB_ADVICE && window.TCB_ADVICE.diet) || {};

// 分析工具：给单个学生算全部项目等级
function analyzeStudent(student) {
    const projects = ['肺活量','50米跑','坐位体前屈','一分钟跳绳','一分钟仰卧起坐','50米×8往返跑','立定跳远','耐力跑','仰卧起坐引体'];
    const results = [];
    for (const p of projects) {
        if (!(GRADE_MAP[student.grade]?.projects || []).some(gp => gp === p || (gp==='BMI'))) {
            // 年级没这个项目就跳过（耐力跑兼容 50×8）
            if (!(p === '耐力跑' && (GRADE_MAP[student.grade]?.projects||[]).includes('50米×8往返跑'))) continue;
        }
        const sc = state.scores.find(x => x.student_id === student.id && x.project === p);
        if (!sc) continue;
        const r = getScore(student.grade, student.gender, p, sc.value);
        if (r) results.push({ project: p, value: sc.value, level: r.level, score: r.score });
    }
    // BMI
    const hSc = state.scores.find(x => x.student_id === student.id && x.project === '身高');
    const wSc = state.scores.find(x => x.student_id === student.id && x.project === '体重');
    let bmi = null;
    if (hSc && wSc) bmi = calcBMI(student.grade, student.gender, { height: hSc.value, weight: wSc.value });
    return { results, bmi };
}

function renderAnalysis() {
    window._analysisClass = window._analysisClass || '全部';
    const classes = _getAllClasses();
    // 统计（按班级筛选）
    const stu = window._analysisClass === '全部' ? state.students : state.students.filter(s => `${s.grade||''}${s.class_name||'未分班'}` === window._analysisClass);
    const stuIds = new Set(stu.map(s => s.id));
    let levels = { '优秀': 0, '良好': 0, '及格': 0, '不及格': 0 }, projectStats = {};
    for (let sc of state.scores) {
        if (!stuIds.has(sc.student_id) || sc.project === '身高' || sc.project === '体重') continue;
        const student = state.students.find(s => s.id === sc.student_id);
        if (!student) continue;
        const result = getScore(student.grade, student.gender, sc.project, sc.value);
        if (result) {
            levels[result.level] = (levels[result.level]||0) + 1;
            const ps = projectStats[sc.project] = projectStats[sc.project] || { total: 0, pass: 0, levels: { '优秀':0,'良好':0,'及格':0,'不及格':0 } };
            ps.total++; ps.levels[result.level] = (ps.levels[result.level]||0)+1;
            if (result.level !== '不及格') ps.pass++;
        }
    }
    const total = Object.values(levels).reduce((a,b)=>a+b,0);
    const passRate = total > 0 ? ((levels['优秀']+levels['良好']+levels['及格'])/total*100) : 0;
    const excRate = total > 0 ? (levels['优秀']/total*100) : 0;

    // 各项目达标率排序（薄弱在前）
    const projSorted = Object.entries(projectStats).map(([p, st]) => ({ p, rate: st.total ? st.pass/st.total*100 : 0, ...st })).sort((a,b) => a.rate - b.rate);

    // 班级对比
    const classCompare = classes.map(cls => {
        const ids = new Set(state.students.filter(s => `${s.grade||''}${s.class_name||'未分班'}` === cls).map(s => s.id));
        let t = 0, p = 0;
        for (let sc of state.scores) {
            if (!ids.has(sc.student_id) || sc.project === '身高' || sc.project === '体重') continue;
            const student = state.students.find(s => s.id === sc.student_id);
            if (!student) continue;
            const r = getScore(student.grade, student.gender, sc.project, sc.value);
            if (r) { t++; if (r.level !== '不及格') p++; }
        }
        return { cls, rate: t ? p/t*100 : 0, total: t };
    }).filter(c => c.total > 0).sort((a,b) => b.rate - a.rate);

    // 班级薄弱项 TOP3 → 班级训练建议
    const weakTop = projSorted.slice(0, 3).filter(x => x.rate < 100);

    // 个人建议列表
    const stuList = stu.map(s => {
        const a = analyzeStudent(s);
        const weak = a.results.filter(r => r.level === '不及格').map(r => r.project);
        return { s, a, weak };
    }).filter(x => x.a.results.length > 0 || x.a.bmi);

    document.getElementById('app').innerHTML = renderNav('analysis') + `
    <div class="container">
        <div class="card"><div class="flex-between" style="flex-wrap:wrap;gap:8px;">
            <div class="h2" style="margin:0;">📊 成绩分析</div>
            ${classes.length > 1 ? `<select class="input" style="padding:6px 10px;font-size:13px;width:auto;" onchange="window._analysisClass=this.value;renderAnalysis();">
                <option value="全部" ${window._analysisClass==='全部'?'selected':''}>全部班级</option>
                ${classes.map(c => `<option value="${c}" ${c===window._analysisClass?'selected':''}>${c}</option>`).join('')}
            </select>` : ''}
        </div>
        <div class="stat-grid" style="margin-top:12px;">
            <div class="stat-card"><div class="stat-value">${stu.length}</div><div class="stat-label">学生总数</div></div>
            <div class="stat-card"><div class="stat-value">${stuList.length}</div><div class="stat-label">已有成绩</div></div>
            <div class="stat-card"><div class="stat-value">${passRate.toFixed(1)}%</div><div class="stat-label">达标率</div></div>
            <div class="stat-card"><div class="stat-value">${excRate.toFixed(1)}%</div><div class="stat-label">优秀率</div></div>
        </div></div>

        ${total > 0 ? `
        <div class="card"><div class="h2">🎯 等级分布</div>
            ${[['优秀','var(--success,#16a34a)','badge-excellent'],['良好','#3b82f6','badge-good'],['及格','#f59e0b','badge-pass'],['不及格','#ef4444','badge-fail']].map(([lv, color]) => {
                const n = levels[lv]||0; const pct = total ? (n/total*100) : 0;
                return `<div style="margin:10px 0;"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>${lv}</span><span style="color:#64748b;">${n} 人 · ${pct.toFixed(1)}%</span></div>
                <div style="background:#f1f5f9;height:14px;border-radius:7px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${color};border-radius:7px;transition:width .4s;"></div></div></div>`;
            }).join('')}
        </div>

        <div class="card"><div class="h2">📈 各项目达标率（弱项排前）</div>
            ${projSorted.map(x => { const color = x.rate >= 80 ? '#16a34a' : x.rate >= 60 ? '#f59e0b' : '#ef4444';
                return `<div style="margin:10px 0;"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>${x.p}</span><span style="color:#64748b;">${x.rate.toFixed(0)}% 达标 (${x.total}人测)</span></div>
                <div style="background:#f1f5f9;height:14px;border-radius:7px;overflow:hidden;"><div style="width:${x.rate}%;height:100%;background:${color};border-radius:7px;transition:width .4s;"></div></div></div>`; }).join('')}
        </div>

        ${classCompare.length > 1 ? `<div class="card"><div class="h2">🏫 班级达标率对比</div>
            ${classCompare.map(c => { const color = c.rate >= 80 ? '#16a34a' : c.rate >= 60 ? '#f59e0b' : '#ef4444';
                return `<div style="margin:10px 0;"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>${c.cls}</span><span style="color:#64748b;">${c.rate.toFixed(1)}%</span></div>
                <div style="background:#f1f5f9;height:14px;border-radius:7px;overflow:hidden;"><div style="width:${c.rate}%;height:100%;background:${color};border-radius:7px;"></div></div></div>`; }).join('')}
        </div>` : ''}

        <div class="card" style="background:#fffbeb;border-color:#fde68a;">
            <div class="h2">💪 班级训练建议 <span class="text-muted" style="font-size:12px;">依据 NSCA 青少年抗阻训练指南 / ACSM 运动处方原则</span></div>
            ${weakTop.length === 0 ? '<div class="text-muted">暂无薄弱项，班级整体达标良好，保持现有训练节奏！</div>' : weakTop.map((x, i) => {
                const adv = TRAINING_ADVICE[x.p];
                if (!adv) return '';
                const plan = adv.fail || adv;
                return `<div style="margin:14px 0;padding:12px;background:white;border-radius:10px;border:1px solid #fde68a;">
                    <div style="font-weight:700;margin-bottom:4px;">${i+1}. ${x.p}（达标率 ${x.rate.toFixed(0)}%，练：${adv.name}）</div>
                    ${plan.methods.map(m => `<div style="font-size:13px;color:#475569;margin:4px 0 0 12px;">• ${m}</div>`).join('')}
                    <div style="font-size:12px;color:#16a34a;margin-top:6px;margin-left:12px;">⏰ ${plan.freq}</div>
                    ${adv.safety ? `<div style="font-size:12px;color:#dc2626;margin-top:4px;margin-left:12px;">⚠️ ${adv.safety}</div>` : ''}
                </div>`;
            }).join('')}
            ${(() => {
                const cw = window.TCB_ADVICE && window.TCB_ADVICE.classWeekly;
                if (!cw) return '';
                if (typeof cw === 'string') return `<div style="font-size:12px;color:#92400e;margin-top:10px;">${cw}</div>`;
                return `<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #fde68a;">
                    <div style="font-weight:700;font-size:13px;color:#92400e;margin-bottom:4px;">📅 班级每周训练模板${cw.title ? '（' + cw.title + '）' : ''}</div>
                    ${(cw.sessions || cw.days || []).map(s => {
                        if (typeof s[1] === 'string') return `<div style="font-size:13px;color:#78350f;margin:4px 0 0 12px;"><b>${s[0]}</b> ${s[1]}</div>`;
                        return `<div style="margin:8px 0 0 12px;">
                            <div style="font-size:13px;font-weight:700;color:#78350f;">${s[0]}</div>
                            ${s[1].map(line => `<div style="font-size:13px;color:#78350f;margin:2px 0 0 10px;">• ${line}</div>`).join('')}
                        </div>`;
                    }).join('')}
                    ${cw.daily ? `<div style="font-size:13px;color:#78350f;margin:6px 0 0 12px;">📌 每天：${cw.daily}</div>` : ''}
                    ${cw.examWeek ? `<div style="font-size:13px;color:#78350f;margin:3px 0 0 12px;">🏁 ${cw.examWeek}</div>` : ''}
                    ${cw.tip ? `<div style="font-size:13px;color:#78350f;margin:3px 0 0 12px;">💡 ${cw.tip}</div>` : ''}
                </div>`;
            })()}
        </div>` : '<div class="card"><div class="empty">还没有成绩数据，先去录入成绩吧</div></div>'}

        <div class="card"><div class="h2">👤 个人诊断报告 <span class="text-muted" style="font-size:12px;">点学生展开训练 + 饮食建议</span></div>
            ${stuList.length === 0 ? '<div class="empty">暂无成绩数据</div>' : stuList.map(({ s, a, weak }) => {
                const dietKey = a.bmi ? (a.bmi.level || '正常') : '正常';
                const diet = DIET_ADVICE[dietKey] || DIET_ADVICE['正常'];
                const weakProjects = [...new Set(weak)];
                return `<div style="border:1px solid var(--border);border-radius:10px;margin:8px 0;overflow:hidden;">
                    <div onclick="toggleStuDetail('${s.id}')" style="display:flex;align-items:center;gap:10px;padding:12px;cursor:pointer;background:#f8fafc;">
                        <span style="font-weight:600;">${s.name}</span>
                        <span style="font-size:12px;color:#64748b;">${s.gender||''} · ${s.grade||''}${s.class_name||''}</span>
                        ${a.bmi ? `<span class="badge ${a.bmi.level==='正常'?'badge-good':a.bmi.level==='低体重'?'badge-pass':a.bmi.level==='超重'?'badge-warning':'badge-fail'}">BMI ${a.bmi.value} ${a.bmi.level}</span>` : ''}
                        ${weakProjects.length === 0 ? '<span class="badge badge-excellent" style="margin-left:auto;">全达标</span>' : `<span class="badge badge-fail" style="margin-left:auto;">薄弱 ${weakProjects.length} 项</span>`}
                    </div>
                    <div id="detail-${s.id}" style="display:none;padding:12px;border-top:1px solid var(--border);">
                        <div style="font-size:13px;font-weight:600;margin-bottom:6px;">📋 各项目成绩</div>
                        ${a.results.map(r => { const badge = r.level==='优秀'?'badge-excellent':r.level==='良好'?'badge-good':r.level==='及格'?'badge-pass':'badge-fail';
                            return `<span class="badge ${badge}" style="margin:2px;">${r.project} ${r.level}</span>`; }).join('') || '<div class="text-muted" style="font-size:13px;">暂无测试成绩</div>'}
                        ${(a.results.some(r => r.level === '不及格' || r.level === '及格')) ? `<div style="font-size:13px;font-weight:600;margin:12px 0 6px;">🏃 针对性训练建议</div>
                            ${a.results.filter(r => r.level === '不及格' || r.level === '及格').map(r => {
                                const adv = TRAINING_ADVICE[r.project]; if (!adv) return '';
                                const isFail = r.level === '不及格';
                                const plan = isFail ? (adv.fail || adv) : (adv.improve || adv);
                                return `<div style="margin:8px 0;padding:10px;${isFail ? 'background:#fef2f2;' : 'background:#eff6ff;'}border-radius:8px;">
                                    <div style="font-weight:600;font-size:13px;">${isFail ? '🚨 补救' : '📈 提升'}：${r.project}（当前${r.level}，练：${adv.name}）</div>
                                    ${plan.methods.map(m => `<div style="font-size:12px;color:#475569;margin:3px 0 0 10px;">• ${m}</div>`).join('')}
                                    <div style="font-size:12px;color:${isFail ? '#dc2626' : '#2563eb'};margin-top:4px;margin-left:10px;">⏰ ${plan.freq}</div>
                                    ${isFail && adv.safety ? `<div style="font-size:12px;color:#dc2626;margin-top:3px;margin-left:10px;">⚠️ ${adv.safety}</div>` : ''}
                                </div>`; }).join('')}` : '<div style="font-size:13px;color:#16a34a;margin-top:10px;">✅ 全部项目良好及以上，保持当前运动习惯，每周 3 次以上中高强度运动维持体能！</div>'}
                        <div style="font-size:13px;font-weight:600;margin:12px 0 6px;">${diet.title}</div>
                        ${diet.items.map(it => `<div style="font-size:12px;color:#475569;margin:4px 0 0 10px;">• ${it}</div>`).join('')}
                    </div>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}
function toggleStuDetail(id) {
    const el = document.getElementById(`detail-${id}`);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ============================================
// 导出（21列国网体测网格式）
// ============================================
function renderExport() {
    const gradeOrder = ['一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级'];
    const sorted = [...state.students].sort((a,b) => { const ai = gradeOrder.indexOf(a.grade), bi = gradeOrder.indexOf(b.grade); return ai !== bi ? ai - bi : (a.class_name||'').localeCompare(b.class_name||''); });
    document.getElementById('app').innerHTML = renderNav('export') + `
    <div class="container">
        <div class="card" style="background:linear-gradient(135deg,#16a34a,#15803d);color:white;text-align:center;">
            <div style="font-size:20px;font-weight:700;margin-bottom:8px;">📤 一键导出国网体测网格式</div>
            <div style="font-size:13px;opacity:0.9;margin-bottom:14px;">${state.students.length} 名学生 · 21 列标准格式 · 可直接上传</div>
            <button class="btn btn-block btn-lg" style="background:rgba(255,255,255,0.2);color:white;" onclick="doExport()">📥 下载 Excel 文件</button>
        </div>
        <div class="card" style="background:#fef2f2;border-color:#fecaca;">
            <div class="flex-between" style="flex-wrap:wrap;gap:10px;">
                <div>
                    <div class="h2" style="margin:0;font-size:15px;">🚫 请假名单（${state.absences.length} 条记录）</div>
                    <div class="text-muted" style="font-size:12px;margin-top:4px;">各计时/录入页面点"🚫 请假"按钮记录，导出后单独存档</div>
                </div>
                <button class="btn btn-sm btn-primary" onclick="exportAbsences()">📥 下载全部请假名单</button>
            </div>
        </div>
        <div class="card"><div class="h2" style="font-size:14px;">📋 导出预览（前 5 行）</div><div style="overflow-x:auto;font-size:11px;max-height:300px;"><table style="width:100%;border-collapse:collapse;"><tr style="background:#f1f5f9;position:sticky;top:0;">${EXPORT_COLUMNS.map(c => `<th style="padding:4px;border:1px solid #e2e8f0;text-align:left;white-space:nowrap;">${c}</th>`).join('')}</tr>${sorted.slice(0,5).map(s => { const gm = GRADE_MAP[s.grade] || { code: 0 }; const cn = (s.class_name||'').match(/\d+/)?.[0] || '1'; const sc = (p) => { const f = state.scores.find(x => x.student_id===s.id && x.project===p); return f?.value ?? ''; }; return `<tr>${EXPORT_COLUMNS.map(c => { let v=''; if(c==='年级编号')v=gm.code; else if(c==='班级编号')v=`${gm.code}${String(cn).padStart(2,'0')}`; else if(c==='班级名称')v=`${s.grade||''}${s.class_name||''}`; else if(c==='学籍号')v=s.student_id||''; else if(c==='民族代码')v=s.ethnicity||''; else if(c==='姓名')v=s.name||''; else if(c==='性别')v=s.gender||''; else if(c==='身高')v=sc('身高'); else if(c==='体重')v=sc('体重'); else if(c==='肺活量')v=sc('肺活量'); else if(c==='50米跑')v=sc('50米跑'); else if(c==='坐位体前屈')v=sc('坐位体前屈'); else if(c==='一分钟跳绳')v=sc('一分钟跳绳'); else if(c==='一分钟仰卧起坐')v=sc('一分钟仰卧起坐'); else if(c==='50米×8往返跑')v=sc('50米×8往返跑'); else if(c==='立定跳远')v=sc('立定跳远'); else if(c==='800米跑'){ if(s.gender==='女'){ const val=sc('耐力跑'); v=val?formatEndurance(val):''; }} else if(c==='1000米跑'){ if(s.gender==='男'){ const val=sc('耐力跑'); v=val?formatEndurance(val):''; }} else if(c==='引体向上')v=sc('仰卧起坐引体'); return `<td style="padding:2px 4px;border:1px solid #e2e8f0;">${v}</td>`; }).join('')}</tr>`; }).join('')}</table></div></div>
    </div>`;
}
function formatEndurance(value) { const seconds = parseFloat(value); if (isNaN(seconds)) return ''; const mm = Math.floor(seconds/60), ss = Math.floor(seconds%60); return `${mm}'${String(ss).padStart(2,'0')}"`; }
function doExport() {
    if (state.students.length === 0) return toast('没有学生数据', 'error');
    const gradeOrder = ['一年级','二年级','三年级','四年级','五年级','六年级','七年级','八年级','九年级'];
    const sorted = [...state.students].sort((a,b) => { const ai = gradeOrder.indexOf(a.grade), bi = gradeOrder.indexOf(b.grade); return ai !== bi ? ai - bi : (a.class_name||'').localeCompare(b.class_name||''); });
    const aoa = [EXPORT_COLUMNS, ...sorted.map(s => {
        const gm = GRADE_MAP[s.grade] || { code: 0 };
        const cn = (s.class_name||'').match(/\d+/)?.[0] || '1';
        const sc = (p) => { const f = state.scores.find(x => x.student_id===s.id && x.project===p); return f?.value ?? ''; };
        const row = { '年级编号': gm.code, '班级编号': `${gm.code}${String(cn).padStart(2,'0')}`, '班级名称': `${s.grade||''}${s.class_name||''}`, '学籍号': s.student_id || '', '民族代码': s.ethnicity || '', '姓名': s.name || '', '性别': s.gender || '', '出生日期': '', '家庭住址': '', '身高': sc('身高'), '体重': sc('体重'), '肺活量': sc('肺活量'), '50米跑': sc('50米跑'), '坐位体前屈': sc('坐位体前屈'), '一分钟跳绳': sc('一分钟跳绳'), '一分钟仰卧起坐': sc('一分钟仰卧起坐'), '50米×8往返跑': sc('50米×8往返跑'), '立定跳远': sc('立定跳远'), '800米跑': s.gender==='女' && sc('耐力跑') ? formatEndurance(sc('耐力跑')) : '', '1000米跑': s.gender==='男' && sc('耐力跑') ? formatEndurance(sc('耐力跑')) : '', '引体向上': sc('仰卧起坐引体') };
        return EXPORT_COLUMNS.map(c => row[c] || '');
    })];
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = EXPORT_COLUMNS.map(c => ({ wch: 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '体测成绩');
    const now = new Date();
    XLSX.writeFile(wb, `体测宝_体测成绩_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`);
    toast('导出成功！', 'success');
}

// ============================================
// 管理员后台
// ============================================
// 排队点名（语音播报）
// ============================================
let rollCallTimer = null;
let rollCallIndex = 0;
let rollCallAutoPlaying = false;
let rollCallIntervalSec = 5; // 间隔秒数
function renderRollCall() {
    if (rollCallTimer) { clearInterval(rollCallTimer); rollCallTimer = null; }
    rollCallAutoPlaying = false;
    
    const students = _getFilteredStudents();
    const count = students.length;
    
    document.getElementById('app').innerHTML = renderNav('rollcall') + `
    <div class="container">
        ${_classFilterBar()}
        <div class="card">
            <div class="flex-between" style="flex-wrap:wrap;gap:10px;">
                <div>
                    <div class="h2" style="margin:0;">📢 排队点名</div>
                    <div class="text-muted" style="font-size:12px;margin-top:4px;">共 ${count} 名学生 · 点击名字语音播报 · 支持自动顺序点名</div>
                </div>
                <div class="flex" style="gap:8px;align-items:center;flex-wrap:wrap;">
                    <span style="font-size:13px;color:#64748b;">间隔</span>
                    <select id="rc-interval" class="input" style="padding:4px 8px;font-size:13px;width:auto;" onchange="rollCallIntervalSec=parseInt(this.value);document.querySelectorAll('.interval-reload').forEach(fn=>fn());">
                        <option value="3" ${rollCallIntervalSec===3?'selected':''}>3秒</option>
                        <option value="5" ${rollCallIntervalSec===5?'selected':''}>5秒</option>
                        <option value="8" ${rollCallIntervalSec===8?'selected':''}>8秒</option>
                        <option value="10" ${rollCallIntervalSec===10?'selected':''}>10秒</option>
                    </select>
                    <button class="btn btn-primary btn-sm" onclick="rollCallStartAuto()">▶ 自动点名</button>
                    <button class="btn btn-danger btn-sm" onclick="rollCallStopAuto()">⏹ 停止</button>
                    <button class="btn btn-sm btn-ghost" onclick="rollCallReset()">🔄 重置</button>
                </div>
            </div>
        </div>
        
        <div class="card" id="rc-progress" style="background:#f0fdf4;border:1px solid #86efac;display:none;">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="font-size:18px;">🔊</div>
                <div style="flex:1;">
                    <div style="font-size:13px;color:#15803d;font-weight:600;">
                        正在点名 <span id="rc-now-name">--</span>
                        <span id="rc-now-idx" style="color:#94a3b8;margin-left:8px;">1/${count}</span>
                    </div>
                    <div style="background:#e2e8f0;height:6px;border-radius:3px;margin-top:6px;overflow:hidden;">
                        <div id="rc-bar" style="background:#22c55e;height:100%;width:0%;transition:width 0.3s;"></div>
                    </div>
                </div>
                <div class="flex" style="gap:6px;">
                    <button class="btn btn-sm btn-ghost" onclick="rollCallPrev()">⬅ 上一个</button>
                    <button class="btn btn-sm btn-ghost" onclick="rollCallNext()">跳过 ➡</button>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="group-header" style="font-size:13px;color:#64748b;">点击名字手动播报，或点"自动点名"顺序播放</div>
            ${count === 0 ? '<div class="empty">暂无学生，请先导入名单</div>' : students.map((s, i) => `
                <div id="rc-row-${i}" class="rc-row" onclick="rollCallSpeakOne(${i})" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:8px;cursor:pointer;border:2px solid transparent;transition:all 0.15s;">
                    <span id="rc-check-${i}" style="font-size:20px;color:#94a3b8;">⚪</span>
                    <span style="font-size:14px;color:#64748b;width:28px;text-align:center;">#${i+1}</span>
                    <span style="flex:1;font-size:15px;font-weight:500;">${s.name}</span>
                    <span style="font-size:12px;color:#94a3b8;">${s.gender||''} ${s.grade||''}${s.class_name||''}</span>
                    <span style="font-size:20px;color:#60a5fa;">🔊</span>
                </div>
            `).join('')}
        </div>
    </div>`;
    
    // 样式
    const styleId = 'rc-inject-style';
    if (!document.getElementById(styleId)) {
        const st = document.createElement('style');
        st.id = styleId;
        st.textContent = `.rc-row:hover { background: #f1f5f9; border-color: #e2e8f0; } .rc-row.active { background: #fef3c7; border-color: #f59e0b; }`;
        document.head.appendChild(st);
    }
}
function rollCallSpeakOne(idx) {
    const students = _getFilteredStudents();
    if (!students[idx]) return;
    // 高亮当前行
    document.querySelectorAll('.rc-row').forEach(el => el.classList.remove('active'));
    const row = document.getElementById(`rc-row-${idx}`);
    if (row) row.classList.add('active');
    // 播报："XXX，请出列"
    _speak(`${students[idx].name}，请出列`);
}
function rollCallMarkCheck(idx) {
    const el = document.getElementById(`rc-check-${idx}`);
    if (el) el.textContent = '✅';
}
function rollCallStartAuto() {
    if (rollCallAutoPlaying) return;
    const students = _getFilteredStudents();
    if (students.length === 0) return toast('暂无学生', 'error');
    
    // 重置到下一个未完成的
    if (rollCallIndex >= students.length) rollCallIndex = 0;
    
    rollCallAutoPlaying = true;
    document.getElementById('rc-progress').style.display = 'block';
    
    // 立即播第一个
    rollCallPlayCurrent();
    
    // 定时播下一个
    const intervalMs = rollCallIntervalSec * 1000;
    rollCallTimer = setInterval(() => rollCallPlayNext(), intervalMs);
    toast(`▶ 开始自动点名，间隔 ${rollCallIntervalSec} 秒`, 'info');
}
function rollCallStopAuto() {
    rollCallAutoPlaying = false;
    if (rollCallTimer) { clearInterval(rollCallTimer); rollCallTimer = null; }
    _stopSpeak();
    document.getElementById('rc-progress').style.display = 'none';
    toast('⏹ 已停止点名', 'info');
}
function rollCallPlayCurrent() {
    const students = _getFilteredStudents();
    const idx = rollCallIndex;
    if (!students[idx]) { rollCallStopAuto(); toast('✅ 全部点完', 'success'); return; }
    
    const bar = document.getElementById('rc-bar');
    if (bar) bar.style.width = `${((idx + 1) / students.length) * 100}%`;
    const nameEl = document.getElementById('rc-now-name');
    if (nameEl) nameEl.textContent = students[idx].name;
    const idxEl = document.getElementById('rc-now-idx');
    if (idxEl) idxEl.textContent = `${idx + 1}/${students.length}`;
    
    rollCallSpeakOne(idx);
}
function rollCallPlayNext() {
    rollCallMarkCheck(rollCallIndex);
    rollCallIndex++;
    rollCallPlayCurrent();
}
function rollCallNext() {
    rollCallMarkCheck(rollCallIndex);
    rollCallIndex++;
    rollCallPlayCurrent();
}
function rollCallPrev() {
    rollCallIndex = Math.max(0, rollCallIndex - 1);
    rollCallPlayCurrent();
}
function rollCallReset() {
    rollCallStopAuto();
    rollCallIndex = 0;
    document.querySelectorAll('.rc-check').forEach(el => { if (el) el.textContent = '⚪'; });
    document.querySelectorAll('.rc-row').forEach(el => el.classList.remove('active'));
}

// ============================================
// 管理员后台
// ============================================
let adminLoggedIn = false;
let adminCodesCache = [];

function renderAdmin() {
    if (!adminLoggedIn) return renderAdminLogin();
    
    document.getElementById('app').innerHTML = renderNav('admin') + `
    <div class="container">
        <div class="card" style="background:linear-gradient(135deg,#dc2626,#991b1b);color:white;text-align:center;">
            <div style="font-size:20px;font-weight:700;margin-bottom:6px;">🔐 管理员后台</div>
            <div style="font-size:12px;opacity:0.8;">激活码生成 · 查询 · 禁用</div>
            <button class="btn" style="margin-top:10px;background:rgba(255,255,255,0.2);color:white;" onclick="adminLogout()">退出登录</button>
        </div>

        <div class="card">
            <div class="h2" style="font-size:14px;margin-bottom:12px;">➕ 生成激活码</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <label style="font-size:13px;">类型：
                    <select id="admin-plan" class="input" style="width:auto;" onchange="document.getElementById('admin-days').disabled=this.value==='PERMANENT'">
                        <option value="PERMANENT">永久会员</option>
                        <option value="TRIAL">限时体验码</option>
                    </select>
                </label>
                <label style="font-size:13px;">天数：
                    <input id="admin-days" class="input" style="width:80px;" type="number" min="1" max="365" value="1">
                </label>
                <label style="font-size:13px;">数量：
                    <input id="admin-count" class="input" style="width:80px;" type="number" min="1" max="50" value="5">
                </label>
                <button class="btn btn-primary" onclick="adminGenerate()">🔑 批量生成</button>
            </div>
            <div id="admin-gen-result" style="margin-top:12px;"></div>
        </div>

        <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div class="h2" style="font-size:14px;">📋 激活码列表</div>
                <button class="btn" onclick="adminRefreshList()">🔄 刷新</button>
            </div>
            <div id="admin-codes-list">
                <div style="text-align:center;color:#888;padding:20px;">加载中...</div>
            </div>
        </div>

        <div class="card">
            <div class="h2" style="font-size:14px;margin-bottom:12px;">🔑 修改管理员密码</div>
            <div class="form-group" style="margin-bottom:8px;">
                <label class="label">当前密码</label>
                <input id="admin-old-pwd" class="input" type="password" placeholder="当前密码">
            </div>
            <div class="form-group" style="margin-bottom:8px;">
                <label class="label">新密码（至少 4 位）</label>
                <input id="admin-new-pwd" class="input" type="password" placeholder="新密码">
            </div>
            <div class="form-group" style="margin-bottom:12px;">
                <label class="label">确认新密码</label>
                <input id="admin-new-pwd2" class="input" type="password" placeholder="再输一次">
            </div>
            <button class="btn btn-primary btn-block" onclick="changeAdminPwd()">✅ 修改密码</button>
        </div>
    </div>`;
    adminRefreshList();
}

function renderAdminLogin() {
    document.getElementById('app').innerHTML = renderNav('admin') + `
    <div class="container">
        <div class="card" style="max-width:400px;margin:40px auto;text-align:center;">
            <div style="font-size:24px;margin-bottom:12px;">🔐</div>
            <div class="h2">管理员登录</div>
            <div style="font-size:12px;color:#888;margin-bottom:16px;">只有管理员才能进入此页面</div>
            <input id="admin-pwd" class="input" type="password" placeholder="管理员密码" style="margin-bottom:12px;" onkeydown="if(event.key==='Enter')adminLogin()">
            <button class="btn btn-primary btn-block" onclick="adminLogin()">登录</button>
        </div>
    </div>`;
}

async function adminLogin() {
    const pwd = document.getElementById('admin-pwd').value.trim();
    if (!pwd) return toast('请输入密码', 'error');
    if (!SB.ready()) return toast('云端未连接', 'error');
    
    const r = await SB.adminList(pwd);
    if (r.ok) {
        adminLoggedIn = true;
        localStorage.setItem('tb_admin_pwd', pwd); // 临时存一下
        toast('登录成功', 'success');
        renderAdmin();
    } else {
        toast(r.message || '密码错误', 'error');
    }
}

function adminLogout() {
    adminLoggedIn = false;
    localStorage.removeItem('tb_admin_pwd');
    renderAdmin();
}

async function changeAdminPwd() {
    const oldPwd = document.getElementById('admin-old-pwd').value.trim();
    const newPwd = document.getElementById('admin-new-pwd').value.trim();
    const newPwd2 = document.getElementById('admin-new-pwd2').value.trim();
    
    if (!oldPwd) return toast('请输入当前密码', 'error');
    if (newPwd.length < 4) return toast('新密码至少 4 位', 'error');
    if (newPwd !== newPwd2) return toast('两次新密码不一致', 'error');
    if (newPwd === oldPwd) return toast('新密码不能和旧密码相同', 'error');
    
    toast('⏳ 修改中...', 'info');
    try {
        const { data, error } = await supabase.rpc('admin_update_password', {
            old_pwd: oldPwd,
            new_pwd: newPwd
        });
        if (error) throw error;
        
        localStorage.setItem('tb_admin_pwd', newPwd);
        document.getElementById('admin-old-pwd').value = '';
        document.getElementById('admin-new-pwd').value = '';
        document.getElementById('admin-new-pwd2').value = '';
        toast('✅ 密码修改成功！', 'success');
    } catch (e) {
        toast('修改失败：' + (e.message || '原密码可能不对'), 'error');
    }
}

async function adminGenerate() {
    const pwd = localStorage.getItem('tb_admin_pwd');
    const plan = document.getElementById('admin-plan').value;
    const count = parseInt(document.getElementById('admin-count').value) || 5;
    const days = plan === 'PERMANENT' ? 99999 : (parseInt(document.getElementById('admin-days').value) || 1);
    
    const r = await SB.adminGenerate(pwd, plan, days, count);
    const box = document.getElementById('admin-gen-result');
    
    if (r.ok) {
        box.innerHTML = `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;">
            <div style="color:#166534;font-weight:600;margin-bottom:8px;">✅ 生成成功 ${r.codes.length} 个激活码</div>
            <div style="font-family:monospace;font-size:12px;line-height:1.8;">
                ${r.codes.map(c => `<div>${c.new_code} — ${c.plan_type === 'PERMANENT' ? '永久' : c.days + '天'}</div>`).join('')}
            </div>
            <button class="btn" style="margin-top:8px;" onclick="navigator.clipboard.writeText(\`${r.codes.map(c => c.new_code).join('\\n')}\`).then(()=>toast('已复制到剪贴板','success'))">📋 复制全部</button>
        </div>`;
        adminRefreshList();
    } else {
        box.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;color:#991b1b;">❌ ${r.message}</div>`;
    }
}

async function adminRefreshList() {
    const pwd = localStorage.getItem('tb_admin_pwd');
    const r = await SB.adminList(pwd);
    const box = document.getElementById('admin-codes-list');
    if (!box) return;
    
    if (r.ok) {
        adminCodesCache = r.codes;
        if (r.codes.length === 0) {
            box.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">暂无激活码</div>';
            return;
        }
        box.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">
            <tr style="background:#f1f5f9;">
                <th style="padding:6px;border:1px solid #e2e8f0;text-align:left;">激活码</th>
                <th style="padding:6px;border:1px solid #e2e8f0;">类型</th>
                <th style="padding:6px;border:1px solid #e2e8f0;">有效期</th>
                <th style="padding:6px;border:1px solid #e2e8f0;">状态</th>
                <th style="padding:6px;border:1px solid #e2e8f0;">操作</th>
            </tr>
            ${r.codes.map(c => `<tr>
                <td style="padding:4px 6px;border:1px solid #e2e8f0;font-family:monospace;">${c.code}</td>
                <td style="padding:4px 6px;border:1px solid #e2e8f0;text-align:center;">${c.plan_type === 'PERMANENT' ? '永久' : '试用'}</td>
                <td style="padding:4px 6px;border:1px solid #e2e8f0;text-align:center;">${c.days >= 99999 ? '永久' : c.days + '天'}</td>
                <td style="padding:4px 6px;border:1px solid #e2e8f0;text-align:center;">${c.is_used ? '<span style="color:#dc2626;">❌ 已用</span>' : '<span style="color:#16a34a;">✅ 可用</span>'}</td>
                <td style="padding:4px 6px;border:1px solid #e2e8f0;text-align:center;">${c.is_used ? '-' : `<button class="btn" style="padding:2px 8px;font-size:11px;" onclick="adminDisable('${c.code}')">禁用</button>`}</td>
            </tr>`).join('')}
        </table></div>`;
    } else {
        box.innerHTML = `<div style="color:#991b1b;padding:20px;text-align:center;">❌ ${r.message}</div>`;
    }
}

async function adminDisable(code) {
    if (!confirm(`确定禁用激活码 ${code} 吗？`)) return;
    const pwd = localStorage.getItem('tb_admin_pwd');
    const r = await SB.adminDisable(pwd, code);
    if (r.ok && r.success) {
        toast('已禁用', 'success');
        adminRefreshList();
    } else {
        toast('禁用失败', 'error');
    }
}

// ============================================
// Magic Link / 重置密码 回跳处理
// ============================================
async function handleMagicLinkInUrl() {
    try {
        if (!window.supabase) return;
        const hash = window.location.hash;
        
        // 解析 hash 参数
        const params = new URLSearchParams(hash.substring(1));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const type = params.get('type');
        const error = params.get('error');
        const errorDesc = params.get('error_description');
        
        if (error) {
            toast('❌ 链接无效: ' + (errorDesc || error), 'error');
            window.location.hash = '';
            return;
        }
        if (!accessToken) return;
        
        // 设置 session
        const { data, error: setErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
        });
        if (setErr) {
            toast('❌ 验证失败: ' + setErr.message, 'error');
            return;
        }
        
        const user = data?.user;
        if (!user) {
            toast('❌ 未找到用户', 'error');
            return;
        }
        
        console.log('[体测宝] Magic Link 成功 type=' + type, user.email);
        
        // 清理 hash
        window.history.replaceState(null, '', window.location.pathname);
        
        state.authed = true;
        state.userEmail = user.email;
        state.signupEmail = user.email; // 供 finishSignup 用
        
        if (type === 'recovery') {
            // 重置密码 → 跳到设密码页面
            state.signupStep = 2; // 复用 Step 2 的设密码界面
            toast('✅ 邮箱验证成功，请设置新密码', 'success');
        } else if (type === 'magiclink') {
            // 注册验证 → 跳到设密码页面
            state.signupStep = 2;
            toast('✅ 邮箱验证成功，请设置密码', 'success');
        } else {
            toast('✅ 欢迎回来！', 'success');
            LS.set('tb_auth', { email: user.email, plan: 'TRIAL', expires: null });
            navigate('home');
            return;
        }
        
        renderAuth();
    } catch (e) {
        console.error('[体测宝] Magic Link 处理失败:', e);
        toast('链接处理失败: ' + e.message, 'error');
    }
}

// ============================================
// 蜂鸣器
// ============================================
function beep(freq = 880, duration = 200) { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = freq; osc.type = 'sine'; gain.gain.setValueAtTime(0.3, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + duration / 1000); osc.onended = () => ctx.close(); } catch(e) {} }

// ============================================
// 启动
// ============================================
(async function init() {
    // ① 先处理 Magic Link / 重置密码链接
    const hash = window.location.hash;
    if (hash.includes('access_token=') || hash.includes('error=')) {
        await handleMagicLinkInUrl();
    }
    
    loadFromStorage();
    if (window.SB) {
        await SB.init();
        if (SB.ready()) console.log('[体测宝] 云端已连接');
        else console.log('[体测宝] 离线模式');
    }
    
    // 自动拉云端数据
    if (window.SB && SB.ready()) {
        try {
            await SB.syncStudents(state.students);
            const syncResult = await SB.syncScores(state.scores);
            await SB.syncAbsences(state.absences);
            if (syncResult.status === 'synced') {
                toast(`☁️ 已从云端拉取 ${syncResult.count} 条数据`, 'success');
            }
        } catch(e) { console.warn('自动同步跳过:', e.message); }
    }
    
    if (!state.authed) {
        renderAuth();
    } else {
        renderHome();
        if (state.userPlan === 'EXPIRED') setTimeout(addExpiredOverlay, 300);
    }
})();
