/* ============================================================
   Pixory · Shared money/date helpers · SINGLE SOURCE OF TRUTH
   ------------------------------------------------------------
   โหลดก่อน <script> หลักของทั้ง index.html (มือถือ) และ desktop.html (คอม)
   แก้สูตรเงิน/วันที่ "ที่นี่ที่เดียว" → ทั้ง 2 แอปได้ค่าตรงกันเสมอ (กัน drift)

   ทั้ง 2 แอปมี FALLBACK สำเนาเดียวกันฝังในตัว เผื่อไฟล์นี้โหลดไม่ติด/ลืม push
   (แอปจะไม่พัง) — แต่ตัวจริงที่ใช้คือไฟล์นี้

   ⚠️ ต้อง push ไฟล์นี้ขึ้น GitHub พร้อม index.html / desktop.html เสมอ
   ============================================================ */
(function (g) {
  'use strict';

  // OT + post-shoot add-ons จากใบเรียกเก็บเพิ่ม = รายได้จริงของงาน
  function jobInvExtra(j) {
    if (!j || !j.invoice) return 0;
    var e = Number(j.invoice.extraTime) || 0;
    var a = Array.isArray(j.invoice.addOns)
      ? j.invoice.addOns.reduce(function (s, x) { return s + (Number(x && x.price) || 0); }, 0)
      : 0;
    return e + a;
  }

  // รายได้ของงาน = ราคาขาย + ส่วนเรียกเก็บเพิ่ม
  function jobRevenue(j) { return (Number(j && j.sell) || 0) + jobInvExtra(j); }

  // ยอดค้างเก็บ = max(0, ราคาขาย − ยอดที่จ่ายสะสม) + ส่วนเรียกเก็บเพิ่ม · 0 เมื่อปิดยอดใบเรียกเก็บแล้ว
  // คิดจาก sell−deposit (ไม่พึ่ง j.remain ที่อาจ stale) · savePayment ตั้ง deposit เป็นยอดสะสมเสมอ
  function jobOutstanding(j) {
    if (!j) return 0;
    if (j.invoice && j.invoice.balancePaid) return 0;
    return Math.max(0, (Number(j.sell) || 0) - (Number(j.deposit) || 0)) + jobInvExtra(j);
  }

  // ยอดที่จ่ายมาแล้ว = รายได้ − ค้างเก็บ
  function jobPaid(j) { return jobRevenue(j) - jobOutstanding(j); }

  // วันที่จอง/สร้างงานเข้ามา (สำหรับ เคส/ยอดขายเดือนนี้) · fallback ครอบงานเก่า
  function jobBookingDate(j) {
    if (!j) return '';
    return String(j._createdAt || j.dateDeposit || j.depositPaidDate || j.date || '').slice(0, 10);
  }

  // เช็คว่า date string อยู่ในเดือน/ปีที่ระบุ
  function _isSameMonth(dateStr, y, m) {
    if (!dateStr) return false;
    var d = new Date(dateStr);
    return !isNaN(d.getTime()) && d.getFullYear() === y && d.getMonth() === m;
  }

  g.jobInvExtra = jobInvExtra;
  g.jobRevenue = jobRevenue;
  g.jobOutstanding = jobOutstanding;
  g.jobPaid = jobPaid;
  g.jobBookingDate = jobBookingDate;
  g._isSameMonth = _isSameMonth;
  g._isSameMonthD = _isSameMonth; // desktop ใช้ชื่อ _isSameMonthD · alias เดียวกัน
  g.PIXORY_HELPERS_LOADED = true;
})(typeof window !== 'undefined' ? window : this);
