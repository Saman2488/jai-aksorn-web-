// ============================================================================
//  ใจอักษร — ระบบยืนยันตัวตน (AUTH)
//
//  ข่าวดี: Supabase Auth ทำ "เข้ารหัสรหัสผ่าน" ให้อัตโนมัติอยู่แล้ว (ใช้ bcrypt
//  ฝั่งเซิร์ฟเวอร์ของ Supabase เอง) เราไม่ต้องเขียนโค้ดเข้ารหัสเอง แค่เรียก
//  ฟังก์ชันที่ถูกต้อง — สิ่งที่เราต้อง "ทำเอง" คือ (1) ตั้งค่าฝั่ง Dashboard
//  ให้ปลอดภัย (2) เขียนฝั่งหน้าเว็บให้จัดการ session/สิทธิ์ถูกต้อง
//
//  ไฟล์นี้ต่อยอดจาก jai-aksorn-api-client.js ที่ทำไว้ก่อนหน้า
// ============================================================================

import { supabase } from './jai-aksorn-api-client.js';

// ----------------------------------------------------------------------------
// ตั้งค่าที่ต้องทำใน Supabase Dashboard ก่อน (ทำครั้งเดียว ไม่ใช่โค้ด)
// ----------------------------------------------------------------------------
// Authentication -> Providers -> Email:
//   ✅ เปิด "Confirm email"  → ผู้ใช้ต้องกดยืนยันในอีเมลก่อนล็อกอินได้จริง
//      (กันคนสมัครด้วยอีเมลปลอม/อีเมลคนอื่นเพื่อสวมสิทธิ์)
//   ✅ ตั้ง "Minimum password length" อย่างน้อย 8 ตัวอักษร
// Authentication -> URL Configuration:
//   ตั้ง Site URL และ Redirect URLs ให้ตรงกับโดเมนเว็บจริง
//   (ป้องกันลิงก์ยืนยัน/รีเซ็ตรหัสผ่านถูกส่งไปเว็บปลอม)
// Authentication -> Rate Limits:
//   จำกัดจำนวนอีเมล OTP/reset ต่อชั่วโมง กัน spam
// ----------------------------------------------------------------------------


// ============================================================================
// 1. สมัครสมาชิกด้วยอีเมล + รหัสผ่าน (ต้องยืนยันอีเมลก่อนใช้งานได้)
// ============================================================================
export async function signUpWithPassword({ email, password, displayName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // ข้อมูลนี้จะถูกแนบไปกับ user เพื่อเอาไปสร้างแถวใน profiles หลังยืนยันอีเมลสำเร็จ
      data: { display_name: displayName },
      // ไม่ใส่ emailRedirectTo ตรงนี้ตั้งใจ — ปล่อยให้ Supabase ใช้ค่า "Site URL"
      // ที่ตั้งไว้ใน Dashboard (Authentication -> URL Configuration) แทน
      // เพราะเว็บนี้เป็น single-page app หน้าเดียว ไม่มีหน้า /auth/callback แยก
    },
  });
  if (error) throw error;

  // ขณะนี้ data.user มีค่าแล้ว แต่ data.session เป็น null จนกว่าจะกดยืนยันอีเมล
  // อย่าเพิ่งสร้างแถว profiles ตรงนี้ — ให้สร้างตอนยืนยันอีเมลสำเร็จ (ดูข้อ 2)
  return { needsEmailConfirmation: !data.session };
}

/**
 * เรียกตอนโหลดหน้า /auth/callback (หลังผู้ใช้กดลิงก์ยืนยันจากอีเมล)
 * ตอนนี้ session พร้อมใช้งานแล้ว ค่อยสร้างแถว profiles จริง
 */
export async function completeSignupAfterEmailConfirm() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  // สร้าง profile แค่ครั้งแรกเท่านั้น (กันซ้ำถ้าเรียกฟังก์ชันนี้หลายครั้ง)
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (!existing) {
    await supabase.from('profiles').insert({
      id: auth.user.id,
      display_name: auth.user.user_metadata?.display_name ?? 'นักอ่าน',
    });
  }
  return auth.user;
}


// ============================================================================
// 2. เข้าสู่ระบบด้วยรหัสผ่าน
// ============================================================================
export async function signInWithPassword({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase จะตอบ error แบบเดียวกันไม่ว่าอีเมลจะมีอยู่จริงหรือรหัสผิด
    // (ตั้งใจให้เป็นแบบนี้ เพื่อไม่ให้คนร้ายไล่เช็คว่าอีเมลไหนมีบัญชีอยู่)
    throw error;
  }
  return data.session;
}


// ============================================================================
// 3. เข้าสู่ระบบด้วย OTP ทางอีเมล (ทางเลือกแทนรหัสผ่าน — ปลอดภัยและง่ายกว่า
//    สำหรับผู้ใช้ทั่วไปที่มักใช้รหัสผ่านซ้ำ ๆ จนหลุด)
// ============================================================================

/** ขั้นที่ 1: ขอรหัส OTP 6 หลัก ส่งเข้าอีเมล */
export async function requestEmailOtp(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }, // สมัครอัตโนมัติถ้ายังไม่เคยมีบัญชี
  });
  if (error) throw error;
}

/** ขั้นที่ 2: ผู้ใช้กรอกรหัส 6 หลักที่ได้รับ มายืนยัน */
export async function verifyEmailOtp({ email, token }) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error) throw error;

  // ถ้าเป็นผู้ใช้ใหม่ (ไม่เคยมี profiles) ให้สร้างให้อัตโนมัติ
  await completeSignupAfterEmailConfirm();
  return data.session;
}


// ============================================================================
// 4. ลืมรหัสผ่าน / เปลี่ยนรหัสผ่าน
// ============================================================================
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://your-domain.com/auth/reset-password',
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}


// ============================================================================
// 5. Session — ทำให้ผู้ใช้ไม่ต้องล็อกอินใหม่ทุกครั้งที่รีเฟรชหน้า
// ============================================================================
export function onAuthChange(callback) {
  // เรียก callback ทุกครั้งที่ login/logout/refresh token
  // ใช้ตัวนี้ใน frontend เพื่ออัปเดตว่าตอนนี้ใครล็อกอินอยู่ (แทน state.user เดิม)
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user ?? null, event);
  });
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
}


// ============================================================================
// 6. Guard — ป้องกัน "สวมสิทธิ์คนอื่น" ทั้งฝั่งหน้าเว็บและฝั่งฐานข้อมูล
// ============================================================================
// หัวใจของการป้องกันคือ: ทุก request ที่ไปฐานข้อมูลจะพก JWT (access token)
// ของผู้ใช้ที่ล็อกอินอยู่ไปด้วยเสมอโดยอัตโนมัติ (supabase-js ทำให้เอง) และ
// ฝั่งฐานข้อมูลจะรู้ auth.uid() จาก JWT นั้น — ไม่ใช่จาก "user_id" ที่หน้าเว็บ
// ส่งมาเอง ดังนั้นแม้ผู้ใช้จะพยายามแก้ค่า user_id ในโค้ด ก็ปลดล็อกตอนแทน
// คนอื่นไม่ได้ เพราะ policy บังคับว่า user_id ต้องตรงกับ auth.uid() เสมอ
// (ดู policy "users create own unlock requests" ในไฟล์ schema)
//
// สิ่งที่ต้องเพิ่มฝั่งหน้าเว็บคือการ "เช็คก่อนแสดงหน้า" เพื่อประสบการณ์ใช้งาน
// ที่ดี (ไม่ใช่เพื่อความปลอดภัย — ความปลอดภัยจริงอยู่ที่ RLS ข้างบน)

/** ใช้ครอบหน้าที่ต้องล็อกอินก่อน เช่น หน้าโปรไฟล์, หน้าเขียนนิยาย */
export async function requireAuth(onFail) {
  const user = await getCurrentUser();
  if (!user) { onFail(); return null; }
  return user;
}

/** ใช้ครอบหน้าแอดมิน — เช็คทั้งฝั่งหน้าเว็บ (UX) และฝั่ง DB (ความปลอดภัยจริง) */
export async function requireAdmin(onFail) {
  const user = await getCurrentUser();
  if (!user) { onFail(); return null; }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) { onFail(); return null; }
  return user;
}


// ============================================================================
// ตัวอย่างการใช้งานในหน้าเว็บ
// ============================================================================
//
//  // ตอนแอปเริ่มทำงาน — ผูก listener ไว้ที่เดียว ให้ทุกหน้าอัปเดตอัตโนมัติ
//  onAuthChange((user) => {
//    state.user = user;
//    render();
//  });
//
//  // ปุ่ม "สมัครสมาชิก" (แบบรหัสผ่าน)
//  const { needsEmailConfirmation } = await signUpWithPassword({ email, password, displayName });
//  if (needsEmailConfirmation) toast('เช็คอีเมลเพื่อกดยืนยันก่อนเข้าสู่ระบบ');
//
//  // ปุ่ม "เข้าสู่ระบบด้วย OTP" (ไม่ต้องจำรหัสผ่าน)
//  await requestEmailOtp(email);            // ส่งรหัส 6 หลัก
//  await verifyEmailOtp({ email, token });  // ผู้ใช้กรอกรหัส แล้วเข้าระบบทันที
//
//  // ก่อนแสดงหน้าเขียนนิยาย
//  await requireAuth(() => navigate('auth'));
//
//  // ก่อนแสดงหน้าแอดมิน
//  await requireAdmin(() => navigate('home'));
//
// ============================================================================
//
//  สรุปเทียบกับที่ถามมา:
//  "เข้ารหัสรหัสผ่าน"      → Supabase ทำให้อัตโนมัติ ไม่ต้องเขียนเอง
//  "OTP/อีเมล"             → requestEmailOtp() + verifyEmailOtp() ด้านบน
//  "ป้องกันสวมสิทธิ์คนอื่น"  → มาจาก RLS + JWT (auth.uid()) ไม่ใช่จากโค้ด
//                              ฝั่งหน้าเว็บเลย ต่อให้แก้โค้ดหน้าเว็บก็สวมสิทธิ์
//                              คนอื่นไม่ได้ เพราะฐานข้อมูลเป็นคนตรวจสอบเอง
// ============================================================================
