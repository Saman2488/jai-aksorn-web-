// ============================================================================
//  ใจอักษร — ที่เก็บไฟล์ (FILE STORAGE) สำหรับรูปสลิปโอนเงิน
//
//  bucket "payment-slips" ถูกสร้างไว้แล้วในไฟล์ schema (ข้อ 1) พร้อม policy
//  ว่าใครอัปโหลด/ดูได้บ้าง และ jai-aksorn-api-client.js (ข้อ 2) ก็มีฟังก์ชัน
//  submitUnlockRequest() ที่อัปโหลดเข้า bucket นี้อยู่แล้ว
//
//  ไฟล์นี้เพิ่มสิ่งที่ยังขาดเพื่อให้ "พร้อมใช้งานจริง":
//    1. ตรวจสอบไฟล์ก่อนอัปโหลด (ชนิดไฟล์, ขนาด) กันคนแนบไฟล์แปลก ๆ
//    2. บีบอัดรูปก่อนอัปโหลด ประหยัดพื้นที่เก็บ + อัปโหลดเร็วขึ้นบนมือถือ
//    3. ขอลิงก์ดูรูปแบบชั่วคราว (signed URL) เพราะ bucket นี้เป็น private
//    4. ลบไฟล์ทิ้งหลังตรวจเสร็จ/ครบกำหนดเก็บ ประหยัดค่าใช้จ่ายระยะยาว
// ============================================================================

import { supabase } from './jai-aksorn-api-client.js';

const MAX_FILE_SIZE_MB = 5;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const BUCKET = 'payment-slips';


// ============================================================================
// 1. ตรวจสอบไฟล์ก่อนอัปโหลด
// ============================================================================
export function validateSlipFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, reason: 'รองรับเฉพาะไฟล์รูปภาพ JPG, PNG, WEBP หรือ HEIC เท่านั้น' };
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return { valid: false, reason: `ไฟล์ใหญ่เกินไป (จำกัด ${MAX_FILE_SIZE_MB}MB)` };
  }
  return { valid: true };
}


// ============================================================================
// 2. บีบอัด/ย่อรูปก่อนอัปโหลด (ทำในเบราว์เซอร์ ไม่ต้องมีเซิร์ฟเวอร์แปลงรูป)
//    สลิปโอนเงินไม่จำเป็นต้องคมกริบระดับต้นฉบับ ย่อเหลือกว้างไม่เกิน 1200px
//    และแปลงเป็น JPEG คุณภาพ 80% ก็เพียงพอให้แอดมินอ่านตัวเลขได้ชัดเจน
// ============================================================================
export function compressImage(file, { maxWidth = 1200, quality = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;

    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg',
        quality
      );
    };
    img.onerror = reject;

    reader.readAsDataURL(file);
  });
}


// ============================================================================
// 3. อัปโหลดสลิป (รวมขั้นตอนตรวจสอบ + บีบอัด ให้ในฟังก์ชันเดียว)
//    ใช้แทน submitUnlockRequest() เดิมได้เลย — path รูปแบบเดิม
//    {user_id}/{chapter_id}-{timestamp}.jpg ตามที่ storage policy กำหนดไว้
// ============================================================================
export async function uploadSlipImage({ userId, chapterId, file }) {
  const check = validateSlipFile(file);
  if (!check.valid) throw new Error(check.reason);

  const compressed = await compressImage(file);
  const filePath = `${userId}/${chapterId}-${Date.now()}.jpg`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, compressed, { contentType: 'image/jpeg' });
  if (error) throw error;

  return filePath; // เก็บค่านี้ไว้ในคอลัมน์ slip_image_url ของ unlock_requests
}


// ============================================================================
// 4. ขอลิงก์ดูรูปแบบชั่วคราว
//    bucket นี้เป็น private (ไม่ public) ตามที่ตั้งไว้ใน schema ดังนั้นจะเปิด
//    ลิงก์ตรง ๆ ไม่ได้ ต้องขอ "signed URL" ที่หมดอายุอัตโนมัติทุกครั้งที่จะดู
//    — ป้องกันไม่ให้ลิงก์รูปสลิปหลุดไปแล้วเปิดดูได้ตลอดกาล
// ============================================================================
export async function getSignedSlipUrl(filePath, expiresInSeconds = 600) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}


// ============================================================================
// 5. ลบไฟล์ทิ้ง — เรียกหลังแอดมินอนุมัติ/ปฏิเสธคำขอเรียบร้อยแล้ว (เก็บไว้สัก
//    30 วันเผื่อมีข้อโต้แย้ง แล้วค่อยลบ) ช่วยประหยัดค่าใช้จ่าย storage ระยะยาว
// ============================================================================
export async function deleteSlipImage(filePath) {
  const { error } = await supabase.storage.from(BUCKET).remove([filePath]);
  if (error) throw error;
}

/**
 * เรียกเป็นงาน cron รายวัน (เช่นผ่าน Supabase Edge Function + pg_cron) เพื่อ
 * ลบสลิปที่ตรวจสอบเสร็จแล้วและเก่ากว่า retentionDays วัน
 */
export async function cleanupOldReviewedSlips(retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();

  const { data: oldRequests, error } = await supabase
    .from('unlock_requests')
    .select('id, slip_image_url')
    .neq('status', 'pending')
    .lt('reviewed_at', cutoff);
  if (error) throw error;

  for (const req of oldRequests) {
    await deleteSlipImage(req.slip_image_url);
  }
  return oldRequests.length;
}


// ============================================================================
// ตัวอย่างการใช้งานฝั่งหน้าอัปโหลด (แทนที่โค้ด <input type="file"> เดิม)
// ============================================================================
//
//  slipInput.addEventListener('change', async (e) => {
//    const file = e.target.files[0];
//    const check = validateSlipFile(file);
//    if (!check.valid) { toast(check.reason); return; }
//
//    // แสดงตัวอย่างรูปทันทีให้ผู้ใช้เห็น (ไม่ต้องรออัปโหลดเสร็จ)
//    preview.src = URL.createObjectURL(file);
//    pendingFile = file; // เก็บไว้ก่อน ค่อยอัปโหลดตอนกด "ส่ง"
//  });
//
//  submitButton.addEventListener('click', async () => {
//    const filePath = await uploadSlipImage({ userId, chapterId, file: pendingFile });
//    await supabase.from('unlock_requests').insert({
//      user_id: userId, chapter_id: chapterId, slip_image_url: filePath, amount_baht: 60,
//    });
//  });
//
//  // ฝั่งแอดมิน ตอนต้องการดูรูป
//  const url = await getSignedSlipUrl(request.slip_image_url);
//  imgElement.src = url;
//
// ============================================================================
//
//  เทียบตัวเลือกที่เก็บไฟล์ (เผื่ออยากเปลี่ยนในอนาคต)
//  ------------------------------------------------------------------------
//  Supabase Storage (ที่ใช้อยู่)
//    + อยู่ในระบบเดียวกับ database/auth อยู่แล้ว ผูก policy ร่วมกับ RLS ได้เลย
//    + ฟรี 1GB ในแพ็กเกจเริ่มต้น เพียงพอสำหรับสลิปหลักพันใบ (สลิปย่อแล้ว ~100-300KB/ใบ)
//    - ไม่มีระบบแปลงรูปอัตโนมัติ (resize/crop) ในตัวแบบ Cloudinary
//
//  Cloudinary
//    + มีระบบแปลงรูปที่ url โดยตรง (resize, crop, watermark) เหมาะถ้าจะโชว์
//      สลิปเป็น thumbnail หลายขนาด
//    - ต้องผูกอีกระบบเพิ่ม แยกจาก auth/database ทำให้ policy ควบคุมสิทธิ์ยากขึ้น
//
//  AWS S3
//    + ถูกที่สุดเมื่อสเกลใหญ่มาก ควบคุมได้ละเอียดสุด
//    - ต้องตั้งค่า IAM/policy เองทั้งหมด ซับซ้อนเกินความจำเป็นสำหรับช่วงเริ่มต้น
//
//  สรุป: ใช้ Supabase Storage ต่อไปตามที่วางไว้ เหมาะกับสเกลปัจจุบันที่สุด
//  ค่อยพิจารณา Cloudinary/S3 ถ้าวันหนึ่งมีรูปสลิปหลักหมื่น-แสนใบต่อเดือน
// ============================================================================
