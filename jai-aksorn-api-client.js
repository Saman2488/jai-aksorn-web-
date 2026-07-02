// ============================================================================
//  ใจอักษร — API LAYER
//  ไฟล์นี้คือ "เซิร์ฟเวอร์" ของเว็บ ในความหมายที่ว่า มันคือจุดเดียวที่หน้าเว็บ
//  (React/HTML ต้นแบบที่ทำไว้ก่อนหน้า) เรียกใช้เพื่อคุยกับฐานข้อมูลจริง
//
//  ข้อสำคัญที่ต้องเข้าใจก่อน: เมื่อใช้ Supabase เราแทบไม่ต้องเขียนเซิร์ฟเวอร์
//  (เช่น Node.js/Express) เองเลย เพราะ Supabase สร้าง REST API ให้ทุกตาราง
//  โดยอัตโนมัติอยู่แล้ว หน้าที่ของเราคือเรียกผ่าน "supabase-js" (SDK) จากฝั่ง
//  เว็บโดยตรง ส่วนความปลอดภัย (ใครทำอะไรได้บ้าง) ถูกบังคับโดย Row Level
//  Security (RLS) ที่ตั้งไว้ในไฟล์ schema ก่อนหน้า ไม่ใช่โดยโค้ดฝั่งเซิร์ฟเวอร์
//
//  พูดง่าย ๆ: ไฟล์นี้ = "endpoint" ทั้งหมดที่ขอมา แต่เขียนในรูปฟังก์ชัน
//  JavaScript แทนที่จะเป็น POST /api/xxx เพราะไม่ต้องมีเซิร์ฟเวอร์คั่นกลาง
//
//  ติดตั้ง: npm install @supabase/supabase-js
// ============================================================================

import { createClient } from '@supabase/supabase-js';

// ค่าสองตัวนี้หาได้จาก Supabase Dashboard -> Project Settings -> API
// ห้ามใส่ "service_role key" ที่นี่เด็ดขาด (นั่นคือกุญแจแอดมินสูงสุด ต้องอยู่
// บนเซิร์ฟเวอร์เท่านั้น) ใช้ "anon public key" ซึ่งปลอดภัยสำหรับฝั่งเว็บ
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ============================================================================
// 1. สมัครสมาชิก / เข้าสู่ระบบ
// เทียบเท่า:  POST /api/auth/signup   และ   POST /api/auth/login
// ============================================================================

/** สมัครสมาชิกใหม่ + สร้างแถวใน profiles พร้อมเหรียญเริ่มต้น 20 เหรียญ */
export async function signUp({ email, password, displayName }) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;

  // แถวใน profiles ยังไม่มี ต้องสร้างเองหลังสมัครสำเร็จ
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({ id: data.user.id, display_name: displayName });
  if (profileError) throw profileError;

  return data.user;
}

/** เข้าสู่ระบบด้วยอีเมล/รหัสผ่าน */
export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** ดึงข้อมูลผู้ใช้ปัจจุบัน (รวมเหรียญ, is_admin) ไว้ใช้แสดงผลในหน้าเว็บ */
export async function getMyProfile() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', auth.user.id)
    .single();
  if (error) throw error;
  return data;
}


// ============================================================================
// 2. ดึงรายชื่อนิยาย / ตอน
// เทียบเท่า:  GET /api/novels   และ   GET /api/novels/:id/chapters
// ============================================================================

/** รายชื่อนิยายทั้งหมดที่เผยแพร่แล้ว ใช้แสดงหน้าแรก */
export async function fetchNovels({ genre = null, limit = 20 } = {}) {
  let query = supabase
    .from('novels')
    .select('id, title, genre, synopsis, cover_url, views, likes, author_id, profiles(display_name, pen_name)')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (genre) query = query.eq('genre', genre);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** รายละเอียดนิยายเรื่องเดียว สำหรับหน้ารายละเอียด */
export async function fetchNovelById(novelId) {
  const { data, error } = await supabase
    .from('novels')
    .select('*, profiles(display_name, pen_name)')
    .eq('id', novelId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * รายการตอนของนิยายเรื่องหนึ่ง — ใช้ view "chapters_public" ที่สร้างไว้ใน schema
 * แทนตาราง chapters ตรง ๆ เพราะ view นี้บอกด้วยว่า "is_unlocked_for_me" หรือยัง
 * โดยไม่ต้องส่งเนื้อหาเต็มของตอนที่ยังไม่ปลดล็อกออกไป
 */
export async function fetchChaptersForNovel(novelId) {
  const { data, error } = await supabase
    .from('chapters_public')
    .select('*')
    .eq('novel_id', novelId)
    .order('chapter_number', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * เนื้อหาเต็มของตอนหนึ่ง — เรียกเฉพาะตอนกดเข้าหน้าอ่านจริง ๆ
 * ถ้าตอนนี้ยังไม่ฟรีและผู้ใช้ยังไม่ได้ปลดล็อก RLS จะไม่คืนแถวนี้ให้เลย
 * (ป้องกันที่ฐานข้อมูล ไม่ใช่แค่ซ่อนด้วย UI ฝั่งหน้าเว็บ)
 */
export async function fetchChapterContent(chapterId) {
  const { data, error } = await supabase
    .from('chapters')
    .select('id, novel_id, chapter_number, title, content, is_free, price_coins')
    .eq('id', chapterId)
    .single();
  if (error) throw error; // error ที่นี่มักแปลว่า "ยังไม่มีสิทธิ์อ่าน"
  return data;
}


// ============================================================================
// 3. อัปโหลดสลิป + สร้างคำขอปลดล็อก
// เทียบเท่า:  POST /api/unlock-requests   (multipart: ไฟล์รูป + chapter_id)
// ============================================================================

/**
 * อัปโหลดรูปสลิปเข้า Storage bucket "payment-slips" แล้วสร้างคำขอปลดล็อก
 * ที่มีสถานะ "pending" รอแอดมินตรวจ
 */
export async function submitUnlockRequest({ userId, chapterId, file, amountBaht }) {
  // ตั้งชื่อไฟล์ตาม path {user_id}/{chapter_id}-{timestamp}.jpg
  // รูปแบบนี้จำเป็น เพราะ policy ของ storage ที่ตั้งไว้ตรวจสิทธิ์จาก path นี้
  const filePath = `${userId}/${chapterId}-${Date.now()}.jpg`;

  const { error: uploadError } = await supabase
    .storage
    .from('payment-slips')
    .upload(filePath, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('unlock_requests')
    .insert({
      user_id: userId,
      chapter_id: chapterId,
      slip_image_url: filePath,
      amount_baht: amountBaht,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** ผู้ใช้ดูสถานะคำขอของตัวเอง (pending / approved / rejected) */
export async function fetchMyUnlockRequests(userId) {
  const { data, error } = await supabase
    .from('unlock_requests')
    .select('*, chapters(title, novel_id)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}


// ============================================================================
// 4. แอดมิน: ดูคำขอที่รอตรวจ + อนุมัติ/ปฏิเสธ
// เทียบเท่า:  GET /api/admin/unlock-requests   และ   POST /api/admin/unlock-requests/:id/approve
// ============================================================================
// หมายเหตุ: RLS policy "admins manage all unlock requests" คือสิ่งที่ทำให้
// ฟังก์ชันสองตัวนี้ใช้ได้เฉพาะบัญชีที่ profiles.is_admin = true เท่านั้น
// ถ้าผู้ใช้ทั่วไปลองเรียกฟังก์ชันนี้ ฐานข้อมูลจะปฏิเสธเองโดยไม่ต้องเช็คในโค้ด

/** ดึงคำขอทั้งหมดที่ยังไม่ตรวจ พร้อม URL รูปสลิปแบบเข้าถึงได้ชั่วคราว */
export async function fetchPendingRequests() {
  const { data, error } = await supabase
    .from('unlock_requests')
    .select('*, profiles(display_name), chapters(title, price_coins, novels(title))')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;

  // สร้างลิงก์รูปสลิปแบบชั่วคราว (private bucket จึงต้องขอ signed URL)
  for (const req of data) {
    const { data: signed } = await supabase
      .storage
      .from('payment-slips')
      .createSignedUrl(req.slip_image_url, 60 * 10); // ใช้ได้ 10 นาที
    req.slip_signed_url = signed?.signedUrl ?? null;
  }
  return data;
}

/**
 * อนุมัติคำขอ — การ update สถานะเป็น 'approved' จะไป trigger ฟังก์ชัน
 * handle_unlock_approval() ในฐานข้อมูลโดยอัตโนมัติ ซึ่งจะปลดล็อกตอนให้
 * ผู้อ่านทันทีและบันทึกลงสมุดบัญชีเหรียญให้เอง ไม่ต้องเขียน logic ซ้ำที่นี่
 */
export async function approveRequest(requestId, adminId) {
  const { data, error } = await supabase
    .from('unlock_requests')
    .update({ status: 'approved', reviewed_by: adminId })
    .eq('id', requestId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function rejectRequest(requestId, adminId) {
  const { data, error } = await supabase
    .from('unlock_requests')
    .update({ status: 'rejected', reviewed_by: adminId, reviewed_at: new Date().toISOString() })
    .eq('id', requestId)
    .select()
    .single();
  if (error) throw error;
  return data;
}


// ============================================================================
// ตัวอย่างการเรียกใช้ในหน้าเว็บ (ตัดมาจาก flow จริงของต้นแบบที่ทำไว้)
// ============================================================================
//
//  // ตอนกดปุ่ม "เข้าสู่ระบบ"
//  const user = await signIn({ email, password });
//
//  // ตอนโหลดหน้าแรก
//  const novels = await fetchNovels();
//
//  // ตอนกดเข้าเรื่องหนึ่ง
//  const chapters = await fetchChaptersForNovel(novelId);
//
//  // ตอนกดอ่านตอนหนึ่ง (ถ้ายังไม่ปลดล็อกและไม่ฟรี จะได้ error กลับมา
//  // ให้พาไปหน้าโอนเงินแทน)
//  try {
//    const chapter = await fetchChapterContent(chapterId);
//  } catch {
//    // แสดงหน้า paywall
//  }
//
//  // ตอนผู้ใช้แนบสลิปแล้วกดส่ง
//  await submitUnlockRequest({ userId, chapterId, file, amountBaht: 60 });
//
//  // ในหน้าแอดมิน โหลดคำขอที่รอ
//  const pending = await fetchPendingRequests();
//
//  // แอดมินกดปุ่ม "อนุมัติ"
//  await approveRequest(requestId, adminId);
//
// ============================================================================
//
//  เมื่อไหร่ถึงต้อง "เขียนเซิร์ฟเวอร์เอง" จริง ๆ (Supabase Edge Function)?
//  RLS ครอบคลุมเกือบทุกกรณีข้างต้นแล้ว แต่มี 2 สถานการณ์ที่ควรมีโค้ดฝั่ง
//  เซิร์ฟเวอร์เพิ่ม (เขียนเป็น Edge Function — คือฟังก์ชันเซิร์ฟเวอร์เล็ก ๆ
//  ที่ Supabase รันให้ ไม่ต้องเช่า server เอง):
//    1. เติมเหรียญแบบเป็นชุด (เช่น แพ็กเกจ 100 บาท = 100 เหรียญ) ที่อยากให้
//       คำนวณอัตราแลกเปลี่ยน/โปรโมชั่นฝั่งเซิร์ฟเวอร์ ไม่ให้ผู้ใช้แก้ค่าเองได้
//    2. ส่งอีเมล/แจ้งเตือนอัตโนมัติเมื่อแอดมินอนุมัติคำขอ
//  ทั้งสองกรณีนี้ยังไม่จำเป็นสำหรับช่วงเริ่มต้น เพิ่มทีหลังได้เมื่อระบบโตขึ้น
// ============================================================================
