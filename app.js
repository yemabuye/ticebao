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
        case 'input': renderInput(); break;
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
        </div>
        ${renderAnnouncement()}
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
            const { data, error } = await supabase.auth.verifyOtp({
                email: state.signupEmail,
                token: otp,
                type: 'signup'
            });
            if (error) throw error;
        }
        state.signupStep = 2;
        toast('✅ 邮箱验证成功', 'success');
        renderAuth();
    } catch (e) {
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
        // 验证码模式：用户已经 verifyOtp 成功了，Supabase 里有临时会话
        // 用 updateUser 设置密码（让账号变成完整账号）
        if (window.SB && SB.ready() && window.supabase) {
            const { error } = await supabase.auth.updateUser({ password: p1 });
            if (error) throw error;
        }
        
        const email = state.signupEmail || 'user@unknown.local';
        state.authed = true;
        state.userEmail = email;
        state.userPlan = isTrialExpired() ? 'EXPIRED' : 'TRIAL';
        state.planExpires = null;
        LS.set('tb_auth', { email, plan: state.userPlan, expires: null });
        
        state.signupStep = 0;
        state.signupEmail = null;
        
        toast(`🎉 注册成功！${isTrialExpired() ? '试用已结束，请联系购买' : `免费使用到 ${TRIAL_END.toLocaleDateString('zh-CN')}`}`, 'success');
        navigate('home');
    } catch (e) {
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
        { id: 'input', label: '✏️ 录入' },
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
    return `
    <div class="announcement-bar" style="background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#7c2d12;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:13px;">
        <div style="font-weight:700;margin-bottom:4px;">📢 公告</div>
        <div style="line-height:1.6;">
            试用激活码有效期 <b>30 天</b>，到期后如需继续使用请购买永久版。<br>
            💰 <b>购买永久版 / 技术支持</b>，请添加微信：<b style="font-size:15px;background:#7c2d12;color:#fef3c7;padding:2px 10px;border-radius:4px;">pp33721</b>
        </div>
    </div>`;
}

// 手动触发云端同步
async function manualSync() {
    if (!window.SB || !SB.ready()) return toast('当前离线，无法同步', 'error');
    toast('⏳ 正在同步到云端...', 'info');
    const studentResult = await SB.syncStudents(state.students);
    const scoreResult = await SB.syncScores(state.scores);
    const total = (studentResult.count || 0) + (scoreResult.count || 0);
    toast(`☁️ 同步完成！共 ${total} 条数据`, 'success');
    renderNav(document.querySelector('.nav-item.active')?.getAttribute('onclick')?.match(/'(\w+)'/)?.[1] || 'home');
}

function renderHome() {
    document.getElementById('app').innerHTML = renderNav('home') + renderAnnouncement() + `
    <div class="container">
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
            <div class="card" onclick="navigate('input')" style="cursor:pointer;"><div style="font-size:24px;">✏️</div><div style="font-weight:600;margin-top:6px;">成绩录入</div><div class="text-muted" style="font-size:12px;">跳远/坐位体前屈等</div></div>
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
function deleteStudent(id) { state.students = state.students.filter(s => s.id !== id); state.scores = state.scores.filter(sc => sc.student_id !== id); saveStudents(); saveScores(); }
function saveScore(studentId, project, value, unit = '') {
    state.scores = state.scores.filter(sc => !(sc.student_id === studentId && sc.project === project));
    state.scores.push({ id: genUUID(), student_id: studentId, project, value: parseFloat(value), unit, recorded_at: new Date().toISOString() });
    saveScores();
}
function clearAll() { if (!confirm('确定要清空所有学生和成绩数据吗？此操作不可恢复！')) return; state.students = []; state.scores = []; saveStudents(); saveScores(); toast('已清空', 'success'); renderHome(); }

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
    state.students.forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    
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
    saveScores();
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
    state.students.forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    return Object.entries(byClass).map(([cls, list]) => `<div class="group-header">${cls}（${list.length}人）</div>${list.map(s => { const sc = state.scores.find(sc => sc.student_id === s.id && sc.project === '一分钟跳绳'); return `<div class="score-input-row"><div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''}</span></div><input class="score-input-box" type="number" placeholder="次数" value="${sc?.value||''}" onchange="saveScore('${s.id}','一分钟跳绳',this.value,'次'); showLevel('${s.id}','一分钟跳绳',this.value);"><div class="score-level" id="qlevel-${s.id}-一分钟跳绳"></div></div>`; }).join('')}`).join('');
}
function showLevel(studentId, project, value) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    const result = getScore(student.grade, student.gender, project, value);
    if (!result) return;
    const el = document.getElementById(`qlevel-${studentId}-${project}`);
    if (!el) return;
    const badge = result.level === '优秀' ? 'badge-excellent' : result.level === '良好' ? 'badge-good' : result.level === '及格' ? 'badge-pass' : 'badge-fail';
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
        <div class="card"><div class="h2">快速录入</div>${state.students.length === 0 ? '<div class="empty">请先导入名单</div>' : state.students.map(s => `<div class="score-input-row"><div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''}</span></div><input class="score-input-box" type="number" placeholder="次数" onchange="saveScore('${s.id}','一分钟仰卧起坐',this.value,'次');"></div>`).join('')}</div>
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

function renderEndurance() {
    const isClaim = endurancePhase === 'claiming';
    document.getElementById('app').innerHTML = renderNav('endurance') + `
    <div class="container">
        <div class="card">
            <div class="flex-between" style="margin-bottom:8px;">
                <div class="h2" style="margin:0;">🏃 耐力跑计时</div>
                <select class="input" style="padding:6px;font-size:13px;" onchange="enduranceType=this.value;renderEndurance();">
                    <option value="800米跑">800米(女生)</option><option value="1000米跑">1000米(男生)</option>
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

function getSavedCount() { return state.scores.filter(sc => sc.project === enduranceType).length; }

function renderClaimStudentList() {
    if (state.students.length === 0) return '<div class="empty">请先导入学生名单</div>';
    const savedMap = {};
    state.scores.filter(sc => sc.project === enduranceType).forEach(sc => { savedMap[sc.student_id] = sc; });
    const usedCount = Object.keys(savedMap).length;
    
    const byClass = {};
    state.students.forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    
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
    saveScore(studentId, enduranceType, q.seconds.toFixed(2), '秒');
    toast(`队列#${savedCount+1} ${q.display} → ${student.name} ✓`, 'success');
    renderEndurance();
}

function enduranceBackToRun() { endurancePhase = 'running'; renderEndurance(); }

function enduranceResetAll() {
    if (!confirm('确定要清空所有计时和耐力跑成绩吗？此操作不可恢复！')) return;
    state.scores = state.scores.filter(sc => sc.project !== enduranceType);
    saveScores();
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
// 快速录入
// ============================================
let currentInputProject = '身高体重(BMI)';
function renderInput() {
    document.getElementById('app').innerHTML = renderNav('input') + `
    <div class="container">
        <div class="card">
            <div class="h2">✏️ 快速录入</div>
            <div class="project-tabs">
                ${['身高体重(BMI)','肺活量','立定跳远','坐位体前屈','50米×8往返跑','1分钟跳绳','仰卧起坐'].map(p =>
                    `<div class="project-tab ${p===currentInputProject?'active':''}" onclick="currentInputProject='${p}';renderInput();">${p}</div>`).join('')}
            </div>
        </div>
        <div class="card" id="input-card"></div>
    </div>`;
    const el = document.getElementById('input-card');
    if (!el) return;
    if (state.students.length === 0) { el.innerHTML = '<div class="empty">暂无学生，请先导入名单</div>'; return; }
    const byClass = {};
    state.students.forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    el.innerHTML = Object.entries(byClass).map(([cls, list]) => `<div class="group-header">${cls}</div>${list.map(s => {
        const scHeight = state.scores.find(sc => sc.student_id === s.id && sc.project === '身高');
        const scWeight = state.scores.find(sc => sc.student_id === s.id && sc.project === '体重');
        const projKey = currentInputProject.replace('1分钟','一分钟').replace('仰卧起坐','一分钟仰卧起坐');
        const scProj = state.scores.find(sc => sc.student_id === s.id && sc.project === projKey);
        let inputs = '';
        if (currentInputProject === '身高体重(BMI)') {
            inputs = `<input class="score-input-box" type="number" placeholder="身高cm" value="${scHeight?.value||''}" onchange="saveScore('${s.id}','身高',this.value,'cm');recalcBMI('${s.id}');" style="width:80px;">
                <input class="score-input-box" type="number" placeholder="体重kg" step="0.1" value="${scWeight?.value||''}" onchange="saveScore('${s.id}','体重',this.value,'kg');recalcBMI('${s.id}');" style="width:80px;">
                <span class="score-level" id="bmi-${s.id}"></span>`;
        } else {
            inputs = `<input class="score-input-box" type="number" step="0.1" placeholder="${currentInputProject}" value="${scProj?.value||''}" onchange="saveScore('${s.id}','${projKey}',this.value);showLevel('${s.id}','${projKey}',this.value);">
                <span class="score-level" id="qlevel-${s.id}-${projKey}"></span>`;
        }
        return `<div class="score-input-row"><div class="score-name">${s.name} <span style="font-size:12px;color:var(--text-muted);">${s.gender||''} · ${s.grade||''}</span></div>${inputs}</div>`;
    }).join('')}`).join('');
    state.students.forEach(s => { if (currentInputProject === '身高体重(BMI)') recalcBMI(s.id); else { const projKey = currentInputProject.replace('1分钟','一分钟').replace('仰卧起坐','一分钟仰卧起坐'); const sc = state.scores.find(sc => sc.student_id === s.id && sc.project === projKey); if (sc) showLevel(s.id, projKey, sc.value); } });
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
    state.students.forEach(s => { const key = `${s.grade||''}${s.class_name||'未分班'}`; (byClass[key] = byClass[key] || []).push(s); });
    el.innerHTML = Object.entries(byClass).map(([cls, list]) => `<div class="card"><div class="flex-between" style="margin-bottom:8px;"><div class="h2" style="margin:0;">${cls} <span style="font-size:14px;color:var(--text-muted);">(${list.length}人)</span></div><button class="btn btn-sm btn-danger" onclick="if(confirm('确认删除？')){state.students=state.students.filter(s=>'${cls}'.indexOf((s.grade||'')+(s.class_name||'未分班'))<0);saveStudents();renderStudents();}">删除班级</button></div>${list.map(s => `<div class="student-row"><div class="student-info"><div class="name">${s.name}</div><div class="meta">${s.gender||''} ${s.student_id||''}</div></div><button class="btn btn-sm btn-ghost" onclick="deleteStudent('${s.id}');renderStudents();">删除</button></div>`).join('')}</div>`).join('');
}
function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([['姓名','性别','年级','班级','学籍号','民族'],['张三','男','四年级','1','','汉族']]);
    ws['!cols'] = [{wch:10},{wch:6},{wch:10},{wch:6},{wch:15},{wch:6}];
    XLSX.writeFile(XLSX.utils.book_new(), '体测宝_导入模板.xlsx'); toast('模板已下载', 'success');
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
function renderAnalysis() {
    let levels = { '优秀': 0, '良好': 0, '及格': 0, '不及格': 0 }, totalScores = 0, projectLevels = {};
    for (let sc of state.scores) {
        const student = state.students.find(s => s.id === sc.student_id);
        if (!student || sc.project === '身高' || sc.project === '体重') continue;
        const result = getScore(student.grade, student.gender, sc.project, sc.value);
        if (result) { totalScores++; if (levels[result.level] !== undefined) levels[result.level]++; projectLevels[sc.project] = projectLevels[sc.project] || {}; projectLevels[sc.project][result.level] = (projectLevels[sc.project][result.level] || 0) + 1; }
    }
    const total = Object.values(levels).reduce((a,b)=>a+b,0);
    document.getElementById('app').innerHTML = renderNav('analysis') + `
    <div class="container">
        <div class="card"><div class="h2">📊 数据概览</div><div class="stat-grid">
            <div class="stat-card"><div class="stat-value">${state.students.length}</div><div class="stat-label">学生总数</div></div>
            <div class="stat-card"><div class="stat-value">${new Set(state.scores.map(sc=>sc.student_id)).size}</div><div class="stat-label">已录入成绩</div></div>
            <div class="stat-card"><div class="stat-value">${total > 0 ? (levels['优秀']/total*100).toFixed(1) : 0}%</div><div class="stat-label">优秀率</div></div>
            <div class="stat-card"><div class="stat-value">${total > 0 ? ((levels['优秀']+levels['良好']+levels['及格'])/total*100).toFixed(1) : 0}%</div><div class="stat-label">达标率</div></div>
        </div></div>
        <div class="card"><div class="h2">🎯 综合等级分布</div><div class="flex" style="gap:12px;flex-wrap:wrap;">
            <span class="badge badge-excellent">优秀 ${levels['优秀']}</span><span class="badge badge-good">良好 ${levels['良好']}</span>
            <span class="badge badge-pass">及格 ${levels['及格']}</span><span class="badge badge-fail">不及格 ${levels['不及格']}</span>
        </div></div>
        <div class="card"><div class="h2">📈 各项目统计</div>${Object.entries(projectLevels).map(([proj, lvls]) => { const t = Object.values(lvls).reduce((a,b)=>a+b,0); return `<div style="padding:10px 0;border-bottom:1px solid var(--border);"><div style="font-weight:600;">${proj} <span class="text-muted" style="font-size:12px;">(共${t}项)</span></div><div class="flex" style="gap:8px;margin-top:6px;">${Object.entries(lvls).map(([lv, n]) => { const badge = lv==='优秀'?'badge-excellent':lv==='良好'?'badge-good':lv==='及格'?'badge-pass':'badge-fail'; return `<span class="badge ${badge}">${lv} ${n}</span>`; }).join('')}</div></div>`; }).join('') || '<div class="empty">还没有成绩数据</div>'}</div>
    </div>`;
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
    const now = new Date();
    XLSX.writeFile(XLSX.utils.book_new(), `体测宝_体测成绩_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`);
    toast('导出成功！', 'success');
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
// 蜂鸣器
// ============================================
function beep(freq = 880, duration = 200) { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = freq; osc.type = 'sine'; gain.gain.setValueAtTime(0.3, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + duration / 1000); osc.onended = () => ctx.close(); } catch(e) {} }

// ============================================
// 启动
// ============================================
(async function init() {
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
