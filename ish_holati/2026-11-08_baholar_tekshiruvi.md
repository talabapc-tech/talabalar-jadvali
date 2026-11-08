# Baholar tekshiruvi va to'ldirish — ish holati (2026-11-07 / 11-08)

Bu hujjat keyingi ish seansi uchun yozilgan. Talabalarning ismi, JSHSHIR va baholari GitHub'ga qo'yilmaydi (repo ommaviy), shuning uchun bu yerda faqat guruh, fan va sonlar bor.

## 1. Nima qilindi

1. **Loyiha va baholar moduli tahlil qilindi.** Baholar Supabase'dagi `fanlar`, `baholar`, `malakaviy_amaliyot` jadvallarida (kalit: JSHSHIR + semestr + fan). Portal kodi: `web/components/BaholarSection.tsx`, `web/app/api/baholar/*`, `web/lib/baholar.ts`.
2. **Qolib ketgan baholar aniqlandi** (guruh → semestr → fan → talaba). Umumiy va har bir guruh uchun Excel hisobotlar yasaldi.
3. **«Boshqa baholar» papkasidagi xlsx fayllar bazaga solishtirildi.** Faqat bo'sh kataklar to'ldirildi, mavjud baholar o'zgartirilmadi.
4. **Akademik ma'lumotnomalar** (4 talaba, 25-16 va 24-13) bo'yicha baholar kiritildi. Xlsx va ma'lumotnoma ikkalasida bo'lsa xlsx ustun.
5. **O'quv rejaga mos bo'lmagan va bahosiz fan ustunlari olib tashlandi** (133 ta, jumladan «N-semestr (…amaliyot…)» ustunlari).
6. **Qo'lyozma jurnallar (PDF, 12-shakl)** bilan «Tasdiq kerak» bo'lgan 39 juftlik tekshirildi.
7. Yangi **2024/2025 3 yillik reja** (24-11, 24-12, 24-13) xlsx dan o'qildi; tayyor JSON `ish_holati/plan-2024-hamshira-3y.json`.

## 2. Qabul qilingan qoidalar va qarorlar

- **Faqat bo'sh katakni to'ldirish.** Bazadagi mavjud baho fayl bilan farq qilsa, o'zgartirilmaydi, «Tasdiq kerak» ro'yxatiga tushadi.
- **«2 yilliklar baholari.xlsx» va «3 yilliklar baholari.xlsx» hisobga olinmaydi** (foydalanuvchi ko'rsatmasi). Ulardan kelgan 19 ta «Oraliq» katagi bazadan qaytarilgan.
- **25-23, 2-semestr:** «Boshqa baholar/25-23.BAHOLAR 3yillik 2-s.xlsx» (yuqoridagi nusxa) asosiy, bazaga mos. «Barcha Baholar» ichidagi nusxa eski va to'liq emas.
- **Kutilgan baho turi qoidasi:** fan kamida 3 talabaga baholangan bo'lsa «baholangan» hisoblanadi; Yakuniy/Joriy/Oraliq turi shu fandagi baholangan talabalarning kamida yarmida bo'lsa hamma talabadan kutiladi.
- **Ism farqlari:** talaba nomi fayllarda biroz boshqacha yozilgan bo'lishi mumkin (Ilhom qizi / Ilhomovna, Hasanova / Xasanova va h.k.). Moslash: guruh ichida aniq ism → butun bazada aniq ism → familiya/ism/ota ismi bo'yicha o'xshashlik (≥0.85). Bitta qo'lda alias bor (25-19, familiya yozilishi farq qiladi).
- **100 ballik reyting** serverdagi qoidaning aniq Python nusxasi bilan hisoblanadi (`scripts/baholar_ish/rating.py`). Bazadagi 46 124 reyting katagida 0 nomuvofiqlik bilan tekshirilgan.
- **Ma'lumotnomadagi bitta baho** hamma turga (yakuniy, joriy, oraliq, R-semestr) qo'yiladi, lekin guruh ishlatmaydigan turga (masalan, oraliq bo'lmagan fanda) yozilmaydi.
- **Guruh ustuni:** akademik ta'til/chiqarilgan talabaning baholari asl guruhida qoladi. Joriy guruhi boshqa bo'lib, baholari eski guruhida qolgan bitta talaba 25-20 dan 25-21 ga o'tkazilgan.

## 3. Bazadagi o'zgarishlar (hammasi 2026-11-07)

| O'zgarish | Soni |
|---|---|
| `baholar` ga yozilgan qatorlar (yangi + to'ldirilgan) | 218 + 30 (keyin 28+2) |
| `baholar` qatorlari jami | 11 531 → 11 592 |
| `malakaviy_amaliyot` qatorlari | 424 → 429 (5 yangi, 1 guruhi tuzatilgan) |
| `fanlar` dan olib tashlangan ustunlar | 133 (hammasi bahosiz) |
| Jamlanma fayllardan kelgani uchun qaytarilgan katak | 19 |

Zaxira nusxalar (git'da YO'Q, `backup/` .gitignore'da; faqat shu kompyuterda):
`backup/baholar_oldin_2026-11-07.json`, `backup/fanlar_oldin_2026-11-07.json`.

## 4. Hisobotlar (faqat mahalliy; talaba ismlari bor, git'ga qo'shilmaydi)

- `Baholar_Tekshiruv_Hisoboti_2026-11-07_v2.xlsx` — umumiy, 15 varaq (Xulosa, Guruhlar kesimi, Kiritilgan baholar, Tasdiq kerak, Jurnal bilan tekshiruv, Kiritilmadi, Olib tashlangan fanlar, Rejada yo'q (bahosi bor), Guruhlar holati, Chetda qolgan talabalar, Qolib ketgan baholar, Bo'sh fanlar, Amaliyot, Izoh).
- `Guruh hisobotlari/` (+ `Guruh_hisobotlari_2026-11-07.zip`) — har bir guruh uchun alohida fayl.
- `Jurnal_bilan_tekshiruv_2026-11-08.xlsx` — jurnal solishtiruvi.
- Manba materiallar: `Boshqa baholar/`, `Jurnallar/` (5 ta PDF jurnal: 24-16, 25-19, 25-20, 25-21, 25-23).

## 5. Ertaga davom ettiriladigan ishlar

1. **25-21, 2-semestr** — foydalanuvchi qaytadan ko'chirib chiqadi. Hozir 7 fan (Hamshiralik ishi., Terapiyada hamshiralik ishi, Pediateriyada hamshiralik ishi, Reabilitatsiya asoslari, Fizioterapiya va massaj, Asab-ruhiy va narkologiya, J.tarbiya) 23 talabada bo'sh; 2 talabada deyarli hamma fan bo'sh; yana 3 ta alohida talaba-fan juftligi. Jurnalda (7–12-betlar) hammasi bor. Tayyor fayl kelgach bo'sh kataklarni to'ldirish (`Boshqa baholar` papkasiga tashlanadi). Yangi 25-21 fayli avval jurnal/baza bilan farq qilgan edi (jurnal bazaga mos chiqdi), shuning uchun faylni qo'llashdan oldin jurnal bilan solishtirish kerak.
2. **«Tasdiq kerak»:** 25-23, 2-semestr, Gistologiya — 9 talaba (36 katak). Jurnalda (237-bet) Gistologiya ustuni bo'sh, shuning uchun ikkala nusxa ham tasdiqlanmaydi. Qaror kerak.
3. **25-23, 1-semestr:** Rus tili, Tibbiyotda biznes asoslari, Farmakologiya bazada yo'q (fayl va jurnalda 27 talabada bor). Rejada yo'qligi uchun avtomatik qo'shilmadi — qaror kerak.
4. **«Rejada yo'q (bahosi bor)»** — 25-16/17/18 1-semestrda shu uchta fan (~250 baho). Reja noto'g'ri yuklangan bo'lishi mumkin. Qaror kerak.
5. **Fanlar ro'yxati yo'q:** 24-15 va 24-16 4-semestr; 24-11/12/13 5-semestr; 25-19…25-22 3-semestrda faqat 4 fan (qolganlari 3 yillik rejadan edi, o'chirilgan). O'quv rejadan yuklash kerak.
6. **2024/2025 3 yillik rejani `oquv_rejalari` jadvaliga qo'shish** — tayyor JSON bor, lekin bazaga yozishga ruxsat berilmagan edi. Portal orqali yoki foydalanuvchi ruxsati bilan qo'shiladi. Eslatma: «Rejadan yuklash» mavjud fan nomini moslashtirmaydi (imlo farqlari), shuning uchun 1–4-semestrda takroriy ustun hosil qiladi; faqat 5-semestrni yuklash tavsiya etiladi.
7. **24-16, 3-semestr:** 17 fan, 20 talaba — baho yo'q, jurnalda ham yo'q (jurnal 1–2-semestr uchun). Manba kerak.
8. **Alohida talabalar uchun manba kerak** (jurnali yo'q guruhlar): 24-11 (1 talaba, 4 semestr), 24-13 (1 talaba 1–2-semestr; 1 talabaning ma'lumotnomasida yo'q fanlari), 25-16 (3 talaba, 6 fan), 25-17 (1 talaba, 2 fan), 25-22 (1 talaba, 1 baho). Tafsilot umumiy hisobotning «Qolib ketgan baholar» va «Chetda qolgan talabalar» varaqlarida.
9. **25-19, 2-semestr, J.tarbiya:** 24 talabada yo'q; jurnalda Jismoniy tarbiya sahifasi yo'q.
10. **Malakaviy amaliyot:** 24-16 (2-sem 18 ball yo'q; 3-sem 18 sana yo'q; har ikkisida 2 talabada yozuv yo'q), boshqa guruhlarda 1–3 talabada joy/sana yo'q. Hisobotning «Amaliyot» varaqlarida.
11. Fayllarda bor, lekin tizimda yo'q bitta talaba (2 yilliklar fayli, guruh «101») — endi manba hisobga olinmagani uchun e'tiborsiz.

## 6. Qanday davom ettirish (texnik)

- Skriptlar: `scripts/baholar_ish/` (`lib_bh.py` — bazaga ulanish va xlsx o'qish, `rating.py` — reyting, `groupreports.py` — guruh hisobotlari). Ular `web/.env.local` dagi Supabase kalitidan foydalanadi (kalitlar kodda yo'q). Yo'llar Windows mashinasiga bog'langan (`lib_bh.ROOT`).
  Ishga tushirish: `python -I scripts/baholar_ish/groupreports.py scripts/baholar_ish`
- Bazaga yozish usuli: PostgREST `POST /rest/v1/baholar?on_conflict=pinfl,semestr,fan` (`Prefer: resolution=merge-duplicates`), mavjud qiymatlarni saqlab, faqat bo'sh kataklarni to'ldirish; reyting ustunlarini `rating.py` bilan hisoblash. Bir so'rovda bir xil kalit ikki marta bo'lmasin (500 xato beradi).
- Hisobot Excel'larini Excel COM orqali qayta hisoblab saqlash (LibreOffice yo'q): hisoblangan qiymatlar shunda saqlanadi.
- Yangi manba fayl kelsa: avval talaba ismini moslash, fan nomini guruhning shu semestrdagi fanlariga moslash, keyin bazadagi qiymat bilan solishtirish (teng / bo'sh→to'ldirish / farq).
- Portal tomonidagi yaqinda qo'shilgan o'zgarish: PR #5 — akademik ta'til/guruh almashganda baholar ko'rinib qolishi; PR #6 — baholarni avto-saqlash.

## 7. Eslatmalar

- Repo **ommaviy**. Ismi, JSHSHIR, baholari bor fayllarni (hisobotlar, `Boshqa baholar/`, `Jurnallar/`, `backup/`) commit qilmang; ular `.gitignore` ga qo'shilgan.
- Telegram sinxronizatsiya xizmati ishlab turganda qo'lda `git add` qilsangiz, uning `pull --rebase --autostash` i stage'ni bekor qilishi mumkin — commit'dan oldin tekshiring.
