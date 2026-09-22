// ============================================
// 体测宝 - Supabase 混合架构配置（v3）
// 完全匹配实际表结构：
//   students: id(uuid), teacher_id(uuid), name, gender, grade, class_name, student_id, ethnicity, birthday, teacher_uuid
//   scores:   id(uuid), teacher_id(uuid), student_id(uuid), project, value, unit, recorded_at, teacher_uuid, level, score
//   activation_codes: code, plan_type, duration_days, is_used, activated_by
// 连得上 Supabase → 云端同步 + 服务端激活码
// 连不上 → 自动回退纯 LocalStorage（保证离线可用）
// ============================================

const SUPABASE_URL = 'https://wtjsnuucgpvaowhvwask.supabase.co';
const SUPABASE_KEY = 'sb_publishable_p0T7Z6Ci3_KEGGTTpjf_Lg_xIyvOZLC';

// ====== 全局状态 ======
let supabase = null;
let supabaseReady = false;
let teacherUuid = null;

// ====== 初始化 ======
async function initSupabase() {
    // 生成/读取老师唯一标识
    teacherUuid = localStorage.getItem('tb_teacher_uuid');
    if (!teacherUuid) {
        // 用标准 UUID 格式，匹配数据库的 uuid 类型
        if (window.crypto && crypto.randomUUID) {
            teacherUuid = crypto.randomUUID();
        } else {
            teacherUuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        localStorage.setItem('tb_teacher_uuid', teacherUuid);
    }

    if (!window.supabase) {
        console.warn('[Supabase] supabase-js 未加载，使用纯 LocalStorage 模式');
        supabaseReady = false;
        return false;
    }

    try {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: false }
        });
        // 测试连通性
        await supabase.rpc('validate_activation_code', { input_code: 'TCB-TRIAL-20260921-78A8D2' });
        supabaseReady = true;
        console.log('[Supabase] ✅ 连接成功，启用云端同步');
        return true;
    } catch (err) {
        console.warn('[Supabase] ❌ 连接失败，回退纯 LocalStorage:', err.message);
        supabaseReady = false;
        supabase = null;
        return false;
    }
}

// ====== 激活码校验（云端优先 → 本地回退）======
async function verifyActivationCode(code) {
    const LOCAL_CODES = [
        { code: 'TCB-TRIAL-20260921-AAAAAA', days: 7, plan: 'TRIAL' },
        { code: 'TCB-TRIAL-20260921-BBBBBB', days: 7, plan: 'TRIAL' },
        { code: 'TCB-TRIAL-20260921-CCCCCC', days: 7, plan: 'TRIAL' },
        { code: 'TCB-TRIAL-20260921-DDDDDD', days: 7, plan: 'TRIAL' },
        { code: 'TCB-TRIAL-20260921-EEEEEE', days: 7, plan: 'TRIAL' },
        { code: 'TCB-PRO-20260921-XXXXXX', days: 365, plan: 'YEARLY' },
    ];

    // 云端优先
    if (supabaseReady && supabase) {
        try {
            const { data, error } = await supabase.rpc('validate_activation_code', { input_code: code });
            if (error) throw error;
            if (data && data[0] && data[0].valid) {
                await supabase.rpc('mark_code_used', { input_code: code, input_teacher_uuid: teacherUuid });
                return { ok: true, plan: data[0].plan, days: data[0].days };
            }
        } catch (err) {
            console.warn('[Supabase] RPC 调用失败，回退本地校验:', err.message);
        }
    }

    // 本地回退
    const match = LOCAL_CODES.find(c => c.code === code.toUpperCase());
    if (match) return { ok: true, plan: match.plan, days: match.days };
    return { ok: false, message: '激活码无效' };
}

// ====== 云端同步：学生名单 ======
async function cloudSyncStudents(localStudents) {
    if (!supabaseReady || !supabase) return { status: 'offline', count: 0 };

    try {
        const { data: cloudStudents, error: fetchErr } = await supabase
            .from('students')
            .select('*')
            .eq('teacher_uuid', teacherUuid);
        if (fetchErr) throw fetchErr;

        // 本地为主，补充云端新增
        const localIds = new Set(localStudents.map(s => s.id));
        let merged = [...localStudents];
        if (cloudStudents) {
            cloudStudents.forEach(cs => {
                if (!localIds.has(cs.id)) {
                    merged.push({
                        id: cs.id,
                        name: cs.name,
                        gender: cs.gender,
                        grade: cs.grade,
                        class_name: cs.class_name,
                        student_id: cs.student_id,
                        ethnicity: cs.ethnicity,
                        birthday: cs.birthday,
                    });
                }
            });
        }

        // 推送本地新增到云端（严格匹配字段）
        const toInsert = localStudents
            .filter(s => !cloudStudents || !cloudStudents.find(c => c.id === s.id))
            .map(s => ({
                id: s.id,                       // uuid
                teacher_uuid: teacherUuid,       // TEXT
                name: s.name,
                gender: s.gender,
                grade: s.grade,
                class_name: s.class_name,
                student_id: s.student_id,
                ethnicity: s.ethnicity || null,
                birthday: s.birthday || null,
            }));

        if (toInsert.length > 0) {
            const { error } = await supabase.from('students').upsert(toInsert);
            if (error) console.warn('[Supabase] 学生推送失败:', error.message);
        }

        return { status: 'synced', count: merged.length };
    } catch (err) {
        console.warn('[Supabase] 学生同步失败:', err.message);
        return { status: 'error', message: err.message };
    }
}

// ====== 云端同步：成绩 ======
async function cloudSyncScores(localScores) {
    if (!supabaseReady || !supabase) return { status: 'offline', count: 0 };

    try {
        const { data: cloudScores, error: fetchErr } = await supabase
            .from('scores')
            .select('*')
            .eq('teacher_uuid', teacherUuid);
        if (fetchErr) throw fetchErr;

        // 本地为主，补充云端新增
        const localIds = new Set(localScores.map(s => s.id));
        let merged = [...localScores];
        if (cloudScores) {
            cloudScores.forEach(cs => {
                if (!localIds.has(cs.id)) {
                    merged.push({
                        id: cs.id,
                        student_id: cs.student_id,
                        project: cs.project,
                        value: parseFloat(cs.value),
                        unit: cs.unit,
                        level: cs.level,
                        score: cs.score,
                    });
                }
            });
        }

        // 推送本地新增到云端（严格匹配字段）
        const toInsert = localScores
            .filter(s => !cloudScores || !cloudScores.find(c => c.id === s.id))
            .map(s => ({
                id: s.id,                       // uuid
                teacher_uuid: teacherUuid,       // TEXT
                student_id: s.student_id,        // uuid（关联 students.id）
                project: s.project,
                value: s.value,                  // numeric
                unit: s.unit || null,
                level: s.level || null,
                score: s.score || null,
            }));

        if (toInsert.length > 0) {
            const { error } = await supabase.from('scores').upsert(toInsert);
            if (error) console.warn('[Supabase] 成绩推送失败:', error.message);
        }

        return { status: 'synced', count: merged.length };
    } catch (err) {
        console.warn('[Supabase] 成绩同步失败:', err.message);
        return { status: 'error', message: err.message };
    }
}

// ====== 导出全局 ======
window.SB = {
    init: initSupabase,
    ready: () => supabaseReady,
    getTeacherUuid: () => teacherUuid,
    verifyCode: verifyActivationCode,
    syncStudents: cloudSyncStudents,
    syncScores: cloudSyncScores,
};
