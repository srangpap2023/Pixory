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

  // v2.9.0 · งานที่ถูกยกเลิก = ไม่นับเป็นยอดขาย/ค้างเก็บ/คาดการณ์ (แต่เงินที่รับจริงยังอยู่ใน payments → ยังนับรายรับ)
  function jobCancelled(j) {
    return !!(j && (j.cancelled === true || j.jobStatus === 'ยกเลิก'));
  }

  // รายได้ของงาน = ราคาขาย + ส่วนเรียกเก็บเพิ่ม · งานยกเลิก = 0 (ไม่ใช่ยอดขายแล้ว)
  function jobRevenue(j) {
    if (jobCancelled(j)) return 0;
    return (Number(j && j.sell) || 0) + jobInvExtra(j);
  }

  // ยอดค้างเก็บ = max(0, ราคาขาย − ยอดที่จ่ายสะสม) + ส่วนเรียกเก็บเพิ่ม · 0 เมื่อปิดยอดใบเรียกเก็บแล้ว/ยกเลิก
  // คิดจาก sell−deposit (ไม่พึ่ง j.remain ที่อาจ stale) · savePayment ตั้ง deposit เป็นยอดสะสมเสมอ
  function jobOutstanding(j) {
    if (!j) return 0;
    if (jobCancelled(j)) return 0;            // v2.9.0 · งานยกเลิก ไม่ต้องเก็บแล้ว
    if (j.invoice && j.invoice.balancePaid) return 0;
    return Math.max(0, (Number(j.sell) || 0) - (Number(j.deposit) || 0)) + jobInvExtra(j);
  }

  // ยอดที่จ่ายมาแล้ว = รายได้ − ค้างเก็บ
  function jobPaid(j) { return jobRevenue(j) - jobOutstanding(j); }

  // วันที่ "ขาย/จองงาน" เข้ามา (สำหรับ เคส/ยอดขายเดือนนี้)
  // v2.9.0 · ห้าม fallback ไปวันถ่าย (j.date) — ไม่งั้นงานที่ถ่ายเดือนนี้แต่ขายเดือนก่อน จะถูกนับเป็น "ขายเดือนนี้" ผิด
  //   ใช้เฉพาะสัญญาณ "ตอนจอง": วันที่สร้างงาน → วันลงมัดจำ → วันจ่ายมัดจำ · งานเก่าที่ไม่มีข้อมูลพวกนี้ = ไม่นับเข้าเดือนไหน
  function jobBookingDate(j) {
    if (!j) return '';
    return String(j._createdAt || j.dateDeposit || j.depositPaidDate || '').slice(0, 10);
  }

  // เช็คว่า date string อยู่ในเดือน/ปีที่ระบุ
  function _isSameMonth(dateStr, y, m) {
    if (!dateStr) return false;
    var d = new Date(dateStr);
    return !isNaN(d.getTime()) && d.getFullYear() === y && d.getMonth() === m;
  }

  // ===== ภาษี · เกณฑ์เงินสด (task #9) =====================================
  // เงินรับจริงในปีภาษี = Σ ทุก payment ที่ลงวันที่ในปีปฏิทิน Y (รวมมัดจำงานปีหน้าที่รับปีนี้)
  // = "ยอดยื่นจริง" ของบุคคลธรรมดาไทย (cash basis) · ไม่นับราคาเต็มงานที่ยังเก็บไม่ครบ
  function cashReceivedInYear(Y, jobs) {
    jobs = jobs || (typeof JOBS !== 'undefined' ? JOBS : []);
    var s = 0;
    jobs.forEach(function (j) {
      ((j && j.payments) || []).forEach(function (p) {
        if (!p || !p.date) return;
        var d = new Date(p.date);
        if (!isNaN(d.getTime()) && d.getFullYear() === Y) s += Number(p.amount) || 0;
      });
    });
    return s;
  }

  // รายการเงินรับรายตัว (payment-by-payment) ของปีภาษี → ใช้ทำชีต Excel "เงินรับจริง"
  // แต่ละแถว = 1 การรับเงิน · รวมทุกแถว = cashReceivedInYear(Y)
  function cashRowsForYear(Y, jobs) {
    jobs = jobs || (typeof JOBS !== 'undefined' ? JOBS : []);
    var rows = [];
    jobs.forEach(function (j) {
      if (!j) return;
      var shootD = j.date ? new Date(j.date) : null;
      var shootYear = (shootD && !isNaN(shootD.getTime())) ? shootD.getFullYear() : null;
      (j.payments || []).forEach(function (p) {
        if (!p || !p.date) return;
        var d = new Date(p.date);
        if (isNaN(d.getTime()) || d.getFullYear() !== Y) return;
        rows.push({
          date: String(p.date).slice(0, 10),
          amount: Number(p.amount) || 0,
          ptype: p.type || '',
          code: j.code || '',
          customer: j.customer || '',
          jobType: j.type || '',
          shootDate: j.date || '',
          shootYear: shootYear,
          nextYearJob: (shootYear != null && shootYear > Y)   // มัดจำงานปีถัดไป (รับปีนี้)
        });
      });
    });
    rows.sort(function (a, b) { return a.date.localeCompare(b.date); });
    return rows;
  }

  // ฐาน "ประเมินล่วงหน้า/วางแผน" = มูลค่างานที่ "ถ่ายในปี Y" ทั้งหมด (ไม่นับงานยกเลิก)
  // ต่างจากเงินสด: ไม่รวมมัดจำงานปีหน้า · รวมยอดเต็มของงานปีนี้แม้ยังเก็บไม่ครบ
  function jobValueShotInYear(Y, jobs) {
    jobs = jobs || (typeof JOBS !== 'undefined' ? JOBS : []);
    var s = 0;
    jobs.forEach(function (j) {
      if (!j || jobCancelled(j) || !j.date) return;
      var d = new Date(j.date);
      if (!isNaN(d.getTime()) && d.getFullYear() === Y) s += jobRevenue(j);
    });
    return s;
  }

  g.jobInvExtra = jobInvExtra;
  g.cashReceivedInYear = cashReceivedInYear;
  g.cashRowsForYear = cashRowsForYear;
  g.jobValueShotInYear = jobValueShotInYear;
  g.jobCancelled = jobCancelled;
  g.jobRevenue = jobRevenue;
  g.jobOutstanding = jobOutstanding;
  g.jobPaid = jobPaid;
  g.jobBookingDate = jobBookingDate;
  g._isSameMonth = _isSameMonth;
  g._isSameMonthD = _isSameMonth; // desktop ใช้ชื่อ _isSameMonthD · alias เดียวกัน
  g.PIXORY_HELPERS_LOADED = true;
})(typeof window !== 'undefined' ? window : this);
