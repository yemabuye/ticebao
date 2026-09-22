-- ============================================
-- 体测宝 Supabase 初始化 SQL（v3 - 匹配实际表结构）
-- 三张表已存在，只需要：补字段 + RPC + RLS + 权限
-- 在 SQL Editor 里一次性执行
-- ============================================

-- ============================================
-- 第 1 步：补缺失字段（实际表已有大部分）
-- ============================================

-- students：补 teacher_uuid TEXT（混合架构不用 Auth）
ALTER TABLE students ADD COLUMN IF NOT EXISTS teacher_uuid TEXT;

-- scores：补 teacher_uuid TEXT + level + score（unit 和 recorded_at 已存在）
ALTER TABLE scores ADD COLUMN IF NOT EXISTS teacher_uuid TEXT;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS score NUMERIC;

-- activation_codes：什么都不用补，已经很完整了！

-- ============================================
-- 第 2 步：RPC 函数（严格匹配 activation_codes 实际字段）
-- 先 DROP 旧的（如果返回类型变了，必须先 DROP 再 CREATE）
-- ============================================

DROP FUNCTION IF EXISTS validate_activation_code(text);
DROP FUNCTION IF EXISTS mark_code_used(text, text);
DROP FUNCTION IF EXISTS generate_activation_codes(text, integer, integer);

-- RPC 1：校验激活码
CREATE OR REPLACE FUNCTION validate_activation_code(input_code TEXT)
RETURNS TABLE(valid BOOLEAN, plan TEXT, days INTEGER, message TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        NOT c.is_used AS valid,
        c.plan_type AS plan,
        c.duration_days AS days,
        CASE 
            WHEN c IS NULL THEN '激活码不存在'
            WHEN c.is_used THEN '激活码已被使用'
            ELSE '激活码有效'
        END AS message
    FROM activation_codes c
    WHERE c.code = input_code;
END;
$$;

-- RPC 2：标记激活码已使用
CREATE OR REPLACE FUNCTION mark_code_used(input_code TEXT, input_teacher_uuid TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    UPDATE activation_codes 
    SET is_used = TRUE, 
        activated_by = CASE WHEN input_teacher_uuid ~ '^[0-9a-f-]{36}$' THEN input_teacher_uuid::uuid ELSE NULL END
    WHERE code = input_code AND is_used = FALSE;
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows > 0;
END;
$$;

-- RPC 3：批量生成激活码
CREATE OR REPLACE FUNCTION generate_activation_codes(
    p_plan TEXT,
    p_days INTEGER,
    p_count INTEGER
)
RETURNS TABLE(code TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
    i INTEGER;
    new_code TEXT;
BEGIN
    FOR i IN 1..p_count LOOP
        new_code := 'TCB-' || p_plan || '-' || to_char(NOW(), 'YYYYMMDD') || '-' || 
                    UPPER(substring(md5(random()::text) from 1 for 6));
        INSERT INTO activation_codes (code, plan_type, duration_days, is_used) 
        VALUES (new_code, p_plan, p_days, FALSE)
        ON CONFLICT (code) DO NOTHING;
        RETURN NEXT new_code;
    END LOOP;
END;
$$;

-- ============================================
-- 第 3 步：开放 RLS 匿名读写
-- ============================================

-- students
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "students anon select" ON students;
DROP POLICY IF EXISTS "students anon insert" ON students;
DROP POLICY IF EXISTS "students anon update" ON students;
DROP POLICY IF EXISTS "students anon delete" ON students;
CREATE POLICY "students anon select" ON students FOR SELECT TO anon USING (true);
CREATE POLICY "students anon insert" ON students FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "students anon update" ON students FOR UPDATE TO anon USING (true);
CREATE POLICY "students anon delete" ON students FOR DELETE TO anon USING (true);

-- scores
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scores anon select" ON scores;
DROP POLICY IF EXISTS "scores anon insert" ON scores;
DROP POLICY IF EXISTS "scores anon update" ON scores;
DROP POLICY IF EXISTS "scores anon delete" ON scores;
CREATE POLICY "scores anon select" ON scores FOR SELECT TO anon USING (true);
CREATE POLICY "scores anon insert" ON scores FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "scores anon update" ON scores FOR UPDATE TO anon USING (true);
CREATE POLICY "scores anon delete" ON scores FOR DELETE TO anon USING (true);

-- activation_codes
ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activation_codes anon select" ON activation_codes;
CREATE POLICY "activation_codes anon select" ON activation_codes FOR SELECT TO anon USING (true);

-- ============================================
-- 第 4 步：授予 RPC 执行权限给 anon
-- ============================================
GRANT EXECUTE ON FUNCTION validate_activation_code(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION mark_code_used(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION generate_activation_codes(TEXT, INTEGER, INTEGER) TO anon;

-- ============================================
-- 第 5 步：验证一下（跑这几句测试！）
-- ============================================
-- SELECT validate_activation_code('TCB-TRIAL-20260921-78A8D2');
-- SELECT mark_code_used('TCB-TRIAL-20260921-78A8D2', '00000000-0000-0000-0000-000000000000');
-- SELECT generate_activation_codes('TRIAL', 7, 3);
