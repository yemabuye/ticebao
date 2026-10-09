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

// ====== 保险函数：全局可用 ======
// 防止旧版 SW 缓存的同步函数调用 refreshTeacherUuid 时报错
// 同时作为新版同步函数的统一入口
async function refreshTeacherUuid() {
    if (supabase && supabase.auth) {
        try {
            const { data } = await supabase.auth.getSession();
            if (data?.session?.user?.id) {
                const newId = data.session.user.id;
                if (teacherUuid !== newId) {
                    console.log('[Supabase] 🔄 teacherUuid 刷新:', teacherUuid, '→', newId);
                    teacherUuid = newId;
                    localStorage.setItem('tb_teacher_uuid', newId);
                }
            }
        } catch (e) {}
    }
}

// ====== 初始化 ======
async function initSupabase() {
    if (!window.supabase) {
        console.warn('[Supabase] supabase-js 未加载，使用纯 LocalStorage 模式');
        supabaseReady = false;
        return false;
    }

    try {
        // 先创建 client，再取 auth session（多设备同步的关键！）
        // persistSession:true 会自动从 localStorage 恢复 session
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: true,  // ✅ session 存 localStorage，关闭浏览器不丢
                autoRefreshToken: true  // ✅ 自动刷新 token，过期前悄悄换新的
            }
        });

        // 登录后从 auth session 取 user.id 作为 teacherUuid（跨设备统一）
        try {
            if (supabase && supabase.auth) {
                const { data } = await supabase.auth.getSession();
                if (data?.session?.user?.id) {
                    teacherUuid = data.session.user.id;
                    // 关键：同步更新 localStorage，确保下次 init 也不会用旧值
                    localStorage.setItem('tb_teacher_uuid', teacherUuid);
                    console.log('[Supabase] ✅ 已登录，teacherUuid = auth user.id:', teacherUuid);
                }
            }
        } catch (authErr) {
            console.warn('[Supabase] auth session 读取失败:', authErr.message);
        }

        // 如果没有 auth session，用本地生成的 UUID（降级方案，离线/未登录时用）
        if (!teacherUuid) {
            teacherUuid = localStorage.getItem('tb_teacher_uuid');
        }
        if (!teacherUuid) {
            teacherUuid = crypto.randomUUID();
            localStorage.setItem('tb_teacher_uuid', teacherUuid);
        }

        // 测试连通性（自定义 RPC 失败不影响 auth API 可用）
        try {
            await supabase.rpc('validate_activation_code', { input_code: 'TCB-TRIAL-20260921-78A8D2' });
        } catch (rpcErr) {
            console.warn('[Supabase] RPC 测试跳过（不影响登录/忘记密码）:', rpcErr.message);
        }
        supabaseReady = true;
        console.log('[Supabase] ✅ 连接成功，启用云端同步，teacherUuid:', teacherUuid);
        return true;
    } catch (err) {
        console.warn('[Supabase] ❌ client 创建失败:', err.message);
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
        // 🔄 保险：同步前刷新 teacherUuid 为 auth user.id
        await refreshTeacherUuid();
        // 同时查 auth.user.id 和 旧本地 UUID（兼容历史数据）
        const oldLocalUuid = localStorage.getItem('tb_teacher_uuid');
        const uuids = [teacherUuid];
        if (oldLocalUuid && oldLocalUuid !== teacherUuid) uuids.push(oldLocalUuid);
        
        const { data: cloudStudents, error: fetchErr } = await supabase
            .from('students')
            .select('*')
            .in('teacher_uuid', uuids);
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

        return { status: 'synced', count: merged.length, data: merged };
    } catch (err) {
        console.warn('[Supabase] 学生同步失败:', err.message);
        return { status: 'error', message: err.message };
    }
}

// ====== 云端同步：成绩 ======
async function cloudSyncScores(localScores) {
    if (!supabaseReady || !supabase) return { status: 'offline', count: 0 };

    try {
        // 🔄 保险：同步前刷新 teacherUuid 为 auth user.id
        await refreshTeacherUuid();
        const oldLocalUuid = localStorage.getItem('tb_teacher_uuid');
        const uuids = [teacherUuid];
        if (oldLocalUuid && oldLocalUuid !== teacherUuid) uuids.push(oldLocalUuid);
        
        const { data: cloudScores, error: fetchErr } = await supabase
            .from('scores')
            .select('*')
            .in('teacher_uuid', uuids);
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

        return { status: 'synced', count: merged.length, data: merged };
    } catch (err) {
        console.warn('[Supabase] 成绩同步失败:', err.message);
        return { status: 'error', message: err.message };
    }
}

// ====== 云端同步：请假记录 ======
// 全量同步（支持撤销删除：云端有但本地没有 → 删除；本地有但云端没有 → upsert）
async function cloudSyncAbsences(localAbsences) {
    if (!supabaseReady || !supabase) return { status: 'offline', count: 0 };

    try {
        // 🔄 保险：同步前刷新 teacherUuid 为 auth user.id
        await refreshTeacherUuid();
        const oldLocalUuid = localStorage.getItem('tb_teacher_uuid');
        const uuids = [teacherUuid];
        if (oldLocalUuid && oldLocalUuid !== teacherUuid) uuids.push(oldLocalUuid);
        
        const { data: cloudAbs, error: fetchErr } = await supabase
            .from('absences')
            .select('*')
            .in('teacher_uuid', uuids);
        if (fetchErr) throw fetchErr;

        const localIds = new Set(localAbsences.map(a => a.id));
        const cloudIds = new Set((cloudAbs || []).map(a => a.id));

        // 云端有但本地没有 → 已撤销，删除
        const toDelete = (cloudAbs || []).filter(a => !localIds.has(a.id)).map(a => a.id);
        if (toDelete.length > 0) {
            const { error } = await supabase.from('absences').delete().in('id', toDelete);
            if (error) console.warn('[Supabase] 请假删除失败:', error.message);
        }

        // 本地有但云端没有 → 新增
        const toInsert = localAbsences
            .filter(a => !cloudIds.has(a.id))
            .map(a => ({
                id: a.id,
                teacher_uuid: teacherUuid,
                student_id: a.student_id,
                project: a.project,
                date: a.date,
                note: a.note || null,
            }));
        if (toInsert.length > 0) {
            const { error } = await supabase.from('absences').upsert(toInsert);
            if (error) console.warn('[Supabase] 请假推送失败:', error.message);
        }

        return { status: 'synced', count: localAbsences.length, data: localAbsences };
    } catch (err) {
        console.warn('[Supabase] 请假同步失败（如果没建 absences 表可忽略）:', err.message);
        return { status: 'offline', count: 0 };
    }
}

// ====== 管理员函数（需要管理员密码）======
async function adminGenerateCodes(pwd, plan, days, count) {
    if (!supabaseReady || !supabase) return { ok: false, message: '云端未连接' };
    try {
        const { data, error } = await supabase.rpc('admin_generate_codes', {
            admin_password: pwd,
            plan: plan,
            duration_days: days,
            count: count
        });
        if (error) throw error;
        return { ok: true, codes: data };
    } catch (err) {
        return { ok: false, message: err.message };
    }
}

async function adminListCodes(pwd) {
    if (!supabaseReady || !supabase) return { ok: false, message: '云端未连接' };
    try {
        const { data, error } = await supabase.rpc('admin_list_codes', { admin_password: pwd });
        if (error) throw error;
        return { ok: true, codes: data };
    } catch (err) {
        return { ok: false, message: err.message };
    }
}

async function adminDisableCode(pwd, code) {
    if (!supabaseReady || !supabase) return { ok: false, message: '云端未连接' };
    try {
        const { data, error } = await supabase.rpc('admin_disable_code', {
            admin_password: pwd,
            target_code: code
        });
        if (error) throw error;
        return { ok: true, success: data };
    } catch (err) {
        return { ok: false, message: err.message };
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
    syncAbsences: cloudSyncAbsences,
    adminGenerate: adminGenerateCodes,
    adminList: adminListCodes,
    adminDisable: adminDisableCode,
};
