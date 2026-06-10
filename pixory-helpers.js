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

  // v2.9.8 · A1 fix · แก้ "มัดจำ" ในหน้าแก้งานแล้ว payments[] ต้องตามไปด้วย
  // เหตุผล: payments[] = ฐานยอดยื่นภาษีเกณฑ์เงินสด (cashReceivedInYear) · เดิมแก้ scalar j.deposit
  // อย่างเดียว → เงินส่วนต่างหาย/เกินจากชีต "เงินรับจริง ยอดยื่น" เงียบๆ
  // กติกา: j.deposit = ยอดรับสะสม (ไม่รวม payment type 'balance' ที่บันทึกตอนปิดยอดใบเรียกเก็บ)
  //   - เคสทั่วไป (มีรายการมัดจำเดิมรายการเดียว) → แก้ amount ที่รายการเดิม คงวันที่เดิม (ไม่ย้ายปีภาษี)
  //   - เคสอื่น (หลายงวด/ลดยอดเกินรายการเดิม) → บันทึกรายการ type 'adjust' ลงวันที่มัดจำเดิม
  // คืน true ถ้ามีการปรับ payments
  function reconcileDepositPayments(j, oldDeposit, newDeposit) {
    if (!j) return false;
    var diff = (Number(newDeposit) || 0) - (Number(oldDeposit) || 0);
    if (!diff) return false;
    j.payments = Array.isArray(j.payments) ? j.payments : [];
    var nonBal = j.payments.filter(function (p) { return p && p.type !== 'balance'; });
    if (nonBal.length === 1 && nonBal[0].type === 'deposit' && (Number(nonBal[0].amount) || 0) + diff > 0) {
      nonBal[0].amount = (Number(nonBal[0].amount) || 0) + diff;
      return true;
    }
    j.payments.push({
      date: String(j.depositPaidDate || j.dateDeposit || new Date().toISOString().slice(0, 10)).slice(0, 10),
      amount: diff,
      type: 'adjust',
      note: 'ปรับยอดรับ · จากการแก้ไขงาน'
    });
    return true;
  }

  // ===== ทีมงาน · ID คงที่ (v2.9.7) ===========================================
  // โมเดล: TEAM แต่ละคนมี id ถาวร · งานเก็บ j.teamMembers=[{id,name,wage}] (canonical)
  // คงฟิลด์เดิม j.team (ชื่อ) + j.teamWages (ชื่อ→ค่าแรง) + j.teamCost (รวม) ไว้แบบ "derived"
  //   → จุดที่อ่านข้อมูลเดิมทั้งหมดยังทำงานได้ · เปลี่ยนชื่อแล้วอัปเดตทุกงานผ่าน id
  function genTeamId() { return 'tm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // id แบบ deterministic จากชื่อ (มือถือ/คอม migrate แยกกันได้ id ตรงกัน · กันชนข้ามเครื่อง)
  function _detIdFromName(prefix, s) {
    s = String(s || '');
    var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return prefix + (h >>> 0).toString(36);
  }

  // ใส่ id ให้คนที่ยังไม่มี · ใช้ id จากชื่อ (deterministic) + กันซ้ำภายใน TEAM
  function ensureTeamIds(team) {
    var used = {};
    (team || []).forEach(function (m) { if (m && m.id) used[m.id] = true; });
    (team || []).forEach(function (m) {
      if (m && !m.id) {
        var base = _detIdFromName('tm_', m.name || ''), id = base, k = 1;
        while (used[id]) id = base + '_' + (k++);
        m.id = id; used[id] = true;
      }
    });
    return team;
  }

  // rename-propagation สำหรับ "ลิสต์และแท็ก" (ไม่มี id · เขียนทับชื่ออ้างอิงตอนเปลี่ยนชื่อ)
  // kind: 'jobtype' | 'source' | 'status' | 'expcat'
  function renameListRef(jobs, expenses, kind, oldName, newName) {
    if (oldName == null || oldName === newName) return 0;
    var n = 0;
    (jobs || []).forEach(function (j) {
      if (!j) return;
      if (kind === 'jobtype' && j.type === oldName) { j.type = newName; n++; }
      else if (kind === 'source' && j.source === oldName) { j.source = newName; n++; }
      else if (kind === 'status' && j.jobStatus === oldName) { j.jobStatus = newName; n++; }
      if (kind === 'expcat') {
        (j.costItems || []).forEach(function (c) { if (c && c.category === oldName) { c.category = newName; n++; } });
        (j.billableCosts || []).forEach(function (c) { if (c && c.category === oldName) { c.category = newName; n++; } });
      }
    });
    if (kind === 'expcat') (expenses || []).forEach(function (e) { if (e && e.cat === oldName) { e.cat = newName; n++; } });
    return n;
  }

  function teamNameById(team, id) {
    var m = (team || []).find(function (x) { return x && x.id === id; });
    return m ? m.name : '';
  }

  // คืน j.teamMembers (สร้างจาก legacy ถ้ายังไม่มี · idempotent) + refresh ชื่อจาก master ตาม id
  function normalizeJobTeam(j, team) {
    if (!j) return [];
    team = team || (typeof TEAM !== 'undefined' ? TEAM : []);
    if (!Array.isArray(j.teamMembers)) {
      var names = Array.isArray(j.team) ? j.team : [];
      var wages = (j.teamWages && typeof j.teamWages === 'object') ? j.teamWages : {};
      j.teamMembers = names.map(function (nm) {
        var master = team.find(function (x) { return x && x.name === nm; });
        return { id: master ? master.id : null, name: nm, wage: Number(wages[nm]) || 0 };
      });
    }
    j.teamMembers.forEach(function (e) {
      if (e && e.id) { var m = team.find(function (x) { return x && x.id === e.id; }); if (m) e.name = m.name; }
    });
    return j.teamMembers;
  }

  // เขียนฟิลด์ legacy กลับจาก teamMembers (back-compat กับจุดอ่านเดิม + sync)
  function deriveLegacyTeam(j) {
    if (!j) return;
    var tm = Array.isArray(j.teamMembers) ? j.teamMembers : [];
    j.team = tm.map(function (e) { return e.name; });
    j.teamWages = {}; var tot = 0;
    tm.forEach(function (e) { j.teamWages[e.name] = Number(e.wage) || 0; tot += Number(e.wage) || 0; });
    j.teamCost = tot;
  }

  // migrate ทุกงาน (idempotent) · เรียกตอนโหลดข้อมูล
  function migrateJobsTeam(jobs, team) {
    ensureTeamIds(team);
    (jobs || []).forEach(function (j) { normalizeJobTeam(j, team); deriveLegacyTeam(j); });
  }

  // เปลี่ยนชื่อทีม · อัปเดต master + ทุกงานที่อ้าง id นี้ + re-derive legacy
  function renameTeamMember(jobs, team, id, newName) {
    if (!id) return 0;
    var m = (team || []).find(function (x) { return x && x.id === id; });
    if (m) m.name = newName;
    var n = 0;
    (jobs || []).forEach(function (j) {
      if (!Array.isArray(j.teamMembers)) return;
      var changed = false;
      j.teamMembers.forEach(function (e) { if (e && e.id === id) { e.name = newName; changed = true; } });
      if (changed) { deriveLegacyTeam(j); n++; }
    });
    return n;
  }

  g.genTeamId = genTeamId;
  g.ensureTeamIds = ensureTeamIds;
  g.teamNameById = teamNameById;
  g.normalizeJobTeam = normalizeJobTeam;
  g.deriveLegacyTeam = deriveLegacyTeam;
  g.migrateJobsTeam = migrateJobsTeam;
  g.renameTeamMember = renameTeamMember;
  g.renameListRef = renameListRef;

  g.reconcileDepositPayments = reconcileDepositPayments;
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
