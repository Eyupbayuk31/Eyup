// Gemini ile belge okuma. İki iş:
//  tur:'koli'    → Gelen Gir "Koli fotoğrafından oku": koli etiketleri →
//                  her koli için {model, uzunluk, miktar, ...}
//  tur:'siparis' → "PDF'ten Satın Alma": sipariş e-postası ekran görüntüsü,
//                  fotoğraf ya da (yazısız/taranmış) PDF → model başına
//                  {beden, cm, adet} satırları
//  tur:'gelen'   → Gelen Gir "İrsaliyeden oku": tedarikçinin sevk irsaliyesi /
//                  çeki listesi (fotoğraf ya da yazı) → gelen {beden, cm, adet}
//  tur:'form'    → İrsaliye formlarında "Hızlı doldur": yazı (WhatsApp mesajı,
//                  sesle yazdırma) ya da fotoğraf → formun alanları
// Yazı (metin) tek başına da gönderilebilir; fotoğraf zorunlu değil.
// Anahtar (GEMINI_API_KEY) yalnızca Vercel ortam değişkeninde durur.

const MODELLER = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [])
  // Flash-Lite önce: ücretsiz katmanda Flash 25 sn'de cevap vermedi, Lite 3 sn'de verdi.
  // (gemini-2.5-flash yeni kullanıcılara kapatıldı → 404, listeden çıkarıldı)
  .concat(['gemini-flash-lite-latest', 'gemini-flash-latest']);
const GECICI = [429, 500, 503];   // anlık yoğunluk / dakikalık sınır: bekleyip bir kez daha dene
const EN_COK_FOTO = 12;
const EN_BUYUK_FOTO = 1600000;   // base64 karakter (~1,2 MB)

const ISTEM =
  'Bu fotoğraflar fermuar ya da kordon tedarikçisinden gelen kolilerin üstündeki etiketler. ' +
  'Her fotoğraf "Foto N" yazısından hemen sonra geliyor. Her fotoğraftaki koli etiketini oku. ' +
  'Etiket ters, yan ya da eğik çekilmiş olabilir; çevirerek oku.\n' +
  'Etikette tipik olarak: alıcı firma adı, barkod ve altında sipariş numarası (ör. P100691430), ' +
  'tedarikçi iş numarası (ör. 212211-2), bizim MODEL KODUMUZ (bir harf + rakamlar, ör. J4842), ' +
  've bir tablo: Renk (ör. "1400690 127"), Uzunluk (cm, ör. 23), Miktar (adet, ör. 1350).\n' +
  'YKK etiketlerinde model kodu "J 5911 - SEPARE - PEMBE" gibi bir satırdadır: model J5911, renk adı PEMBE. ' +
  '"Item" altındaki 7 haneli sayı (ör. 4964423) ve FS6000000X ürün kodudur, MODEL DEĞİLDİR.\n' +
  'Kurallar: model alanına sadece model kodunu yaz (J4842, J5911 gibi; mutlaka harfle başlar), tedarikçi iş numarasını (212211-2) ya da ürün kodunu yazma. ' +
  'baslik alanına model kodunun geçtiği satırı aynen yaz (ör. "J 5911 - SEPARE - PEMBE"). ' +
  'uzunluk cm cinsinden sayı, miktar adet cinsinden tam sayı. Emin olmadığın alanı boş bırak ya da 0 yaz, uydurma. ' +
  'Fotoğrafta okunabilir koli etiketi yoksa okunabildi=false yaz.\n' +
  'ELLE YAZILMIŞ ETİKET: torba ya da koli üstüne kâğıtla yazılmış olabilir. Üstüne yazılarak düzeltilmiş rakamda düzeltilmiş hâli geçerlidir (model kodu çoğunlukla bir harf + 4 rakam, ör. J4842). ' +
  'HAM KORDON / METRE: ölçüsüz mal metreyle gelir ("3645 MT", "3645 metre"): uzunluk=0, miktar=metre, renk_kodu=yazan renk adı (ör. KAHVE RENGİ).\n' +
  'KARIŞIK KOLİ: bir etiketin tablosunda birden çok satır (farklı uzunluk ya da renk) varsa HER SATIR için ayrı kayıt döndür; ' +
  'miktarları toplama, en büyük uzunluğa yazma. Aynı etiketin satırları aynı etiket numarasını alır. ' +
  'Fotoğrafta birden çok koli etiketi varsa her etikete sırayla 1, 2, 3 numarası ver. Her satırın renk_kodu alanına o satırdaki Color/Renk değerini yaz (ör. RJ76).';

const ISTEM_SIPARIS =
  'Bu belgeler bir fermuar ya da kordon SATIN ALMA siparişi: e-posta ekran görüntüsü, kâğıt fotoğrafı ya da PDF olabilir. ' +
  'Her belge "Belge N" yazısından hemen sonra geliyor. Siparişteki her model için uzunluk (cm) başına sipariş adedini çıkar.\n' +
  'Kurallar:\n' +
  '- model: bizim model kodumuz, bir-üç harf + rakamlar (ör. J4842, I0987, M1S10178). "J 4842" gibi boşluklu yazılmışsa birleştir. ' +
  'Tedarikçinin kendi stok/iş numarasını (ör. 212211-2) model yazma. Model kodu yoksa boş bırak.\n' +
  '- satirlar: her uzunluk için bir satır. cm sayı, adet tam sayı. Satır birden çok bedeni kapsıyorsa ' +
  '(ör. "(XS-S-M) 23 cm : 5500 adet") beden alanına "XS-S-M" yaz; tek beden ise o bedeni yaz; beden yoksa boş bırak.\n' +
  '- RENK: tabloda Renk sütunu varsa (ör. "511", "RJ76") her satırın renk alanına o satırdaki KODU aynen yaz. ' +
  'Farklı renk kodları FARKLI siparişlerdir: aynı model kodu olsa bile her renk kodu için ayrı bir modeller kaydı döndür. ' +
  'Kaydın renk alanına renk ADINI yaz: belge başlığında (ör. "Müşteri Sipariş No: J 5911 - SEPARE - SYAH") geçen rengi düzgün Türkçe yaz ' +
  '(SYAH → Siyah, BYZ → Beyaz, LACI → Lacivert, KHV → Kahverengi). Bir başlık hangi tabloya aitse o tablodaki renk kodunun adıdır; ' +
  'aynı kodlu satırlar başka fotoğrafta başlıksız devam ediyorsa onlar için de aynı adı kullan. Adı hiçbir yerde yazmıyorsa renk alanını boş bırak, kod uydurma ad yazma. ' +
  'Renk sütunu yoksa belgede yazan renk adını kaydın renk alanına yaz.\n' +
  '- Fotoğraflar aynı sayfanın üst üste binen parçaları olabilir: aynı satırı (aynı sıra no, renk, uzunluk, miktar) iki kez yazma.\n' +
  '- "İrsaliye Detayları" tablosundaki parça teslimat miktarlarını satır yapma; yalnız ana tablodaki sipariş Miktar\'ını al.\n' +
  '- Fiyat, fermuar tipi, not gibi bilgileri satıra koyma. ' +
  'tedarikci: belgede açıkça görünen tedarikçi firma adı, yoksa boş. toplam: belgede yazan genel toplam adet, yoksa 0.\n' +
  '- Okuyamadığın değeri uydurma, boş bırak.';
const SEMA_SIPARIS = {
  type: 'OBJECT',
  properties: {
    modeller: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          model:     { type: 'STRING' },
          baslik:    { type: 'STRING', description: 'Bu tablonun belge başlığındaki "Müşteri Sipariş No" yazısı aynen (ör. "J 5911 - SEPARE - SYAH"), yoksa boş' },
          renk:      { type: 'STRING' },
          tedarikci: { type: 'STRING' },
          toplam:    { type: 'INTEGER' },
          satirlar: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { beden: { type: 'STRING' }, cm: { type: 'NUMBER' }, adet: { type: 'INTEGER' },
                renk: { type: 'STRING', description: 'Bu satırın Renk sütunundaki kod, yoksa boş' } },
              required: ['cm', 'adet']
            }
          }
        },
        required: ['satirlar']
      }
    },
    belgeler: {
      type: 'ARRAY',
      description: 'Her belge (Belge N) için bir kayıt',
      items: {
        type: 'OBJECT',
        properties: {
          belge: { type: 'INTEGER', description: 'Belge numarası (Belge N içindeki N)' },
          baslik: { type: 'STRING', description: 'Bu belgede görünen "Müşteri Sipariş No" yazısı aynen (ör. "J 5911 - SEPARE - SYAH"); bu belgede görünmüyorsa boş' },
          renk_kodlari: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Bu belgedeki tablo satırlarında görünen Renk sütunu kodları' }
        },
        required: ['belge']
      }
    }
  },
  required: ['modeller']
};

const ISTEM_GELEN =
  'Bu belge bir fermuar ya da kordon tedarikçisinin bize gönderdiği SEVK İRSALİYESİ, çeki listesi ya da teslimat mesajı. ' +
  'Fotoğraf, ekran görüntüsü ya da yazı olabilir. Bu teslimatta GELEN miktarları çıkar.\n' +
  'Kurallar:\n' +
  '- model: bizim model kodumuz (bir-üç harf + rakamlar, ör. J4842). Tedarikçi stok/iş numarasını model yazma. Yoksa boş.\n' +
  '- satirlar: her uzunluk (cm) için bir satır; adet o teslimatta gelen tam sayı. Beden ya da beden grubu yazıyorsa beden alanına yaz (ör. "XS-S-M"). ' +
  'Ham kordon gibi metre ile gelen malda cm=0 yaz, adet alanına metreyi yaz.\n' +
  '- Elle yazılmış kâğıtta üstüne yazılarak düzeltilmiş rakamın düzeltilmiş hâlini al (model kodu çoğunlukla bir harf + 4 rakam, ör. J4842).\n' +
  '- renk: varsa renk adı. Koli sayısı, fiyat, KDV, tutar, irsaliye no gibi bilgileri satıra koyma. toplam: belgede yazan toplam miktar, yoksa 0.\n' +
  '- Okuyamadığın değeri uydurma, boş bırak.';

const FORM_TARIF = {
  standart: 'POŞET irsaliyesi. Miktarlar poşet ölçüsüne göre: 30x40, 35x45, 40x60, 50x70, 60x90, 100x100 → posetler listesi (olcu "30x40" biçiminde). ' +
    'Geniş bant, dar bant, kılçık adetleri → bant_genis, bant_dar, kilcik. "Mal adedi" (kaç adet ürün için verildiği) → mal_adedi.',
  fermuar: 'FERMUAR irsaliyesi. Miktarlar beden ve uzunluk (cm) başına adet → satirlar. Beden grubu (ör. "XS-S-M 23 cm 500") varsa beden alanına grubu yaz.',
  kordon: 'KORDON irsaliyesi. Ya cm başına adet (satirlar; beden varsa yaz) ya da sadece toplam metre (metre alanı).',
  dugme: 'DÜĞME irsaliyesi. Tek miktar: toplam adet → adet.',
  lastik: 'LASTİK irsaliyesi. Lastiğin eni cm olarak → cm, toplam metre → metre.',
  dantel: 'DANTEL irsaliyesi. Toplam metre → metre.',
  satenaskilik: 'SATEN ASKILIK irsaliyesi. Toplam metre → metre.',
  toptan: 'TOPTAN SİPARİŞ. Müşteri firma adı → firma, ürün kodu → model, beden başına adet → satirlar (cm=0).'
};
function istemForm(form, bugun) {
  return 'Bir tekstil firmasında atölyeye malzeme gönderirken kesilen irsaliyenin formunu dolduruyoruz. ' +
    (FORM_TARIF[form] || FORM_TARIF.fermuar) + '\n' +
    'Kaynak: kullanıcının yazdığı / sesle söylediği kısa not, WhatsApp mesajı ya da bir kâğıdın fotoğrafı. Bugünün tarihi ' + bugun + '.\n' +
    'Alanlar:\n' +
    '- atolye: malın gönderildiği atölye adı, metinde geçtiği gibi ama ek almadan (ör. "Paşa\'ya" → "Paşa").\n' +
    '- model: bizim model kodumuz (bir-üç harf + rakamlar, ör. J4842, I6399AX). "J 4842" ise birleştir.\n' +
    '- renk: renk adı (ör. Kahverengi).\n' +
    '- satirlar: miktar satırları. "23 cm 3 koli 1800" demek 23 cm uzunluktan 1800 adet demektir (3 koli sayısıdır, adet değil) → {cm:23, adet:1800}. ' +
    '"XS-S-M 23 cm 500" → {beden:"XS-S-M", cm:23, adet:500}. "S 100 M 200" → {beden:"S", adet:100}, {beden:"M", adet:200}.\n' +
    '- tarih ve termin: YYYY-AA-GG biçiminde; "yarın", "cuma" gibi ifadeleri bugüne göre çevir. Yazmıyorsa boş.\n' +
    '- aciklama: yalnızca açıkça not olarak yazılan kısa bilgi, yoksa boş.\n' +
    '- Bu irsaliye türüyle ilgisi olmayan alanları boş bırak / 0 yaz. Fiyat ve tutar yazma. Okuyamadığın değeri uydurma.';
}
const SEMA_FORM = {
  type: 'OBJECT',
  properties: {
    atolye: { type: 'STRING' }, firma: { type: 'STRING' }, model: { type: 'STRING' }, renk: { type: 'STRING' },
    tarih: { type: 'STRING' }, termin: { type: 'STRING' }, aciklama: { type: 'STRING' },
    satirlar: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: {
        beden: { type: 'STRING', description: 'Beden ya da beden grubu (XS-S-M), yoksa boş' },
        cm: { type: 'NUMBER', description: 'Uzunluk cm, yoksa 0' },
        adet: { type: 'INTEGER', description: 'Gönderilen adet (koli sayısı değil)' } }, required: ['adet'] }
    },
    metre: { type: 'NUMBER' }, adet: { type: 'INTEGER' }, cm: { type: 'NUMBER' },
    posetler: { type: 'ARRAY', items: { type: 'OBJECT', properties: { olcu: { type: 'STRING' }, adet: { type: 'INTEGER' } }, required: ['olcu', 'adet'] } },
    bant_genis: { type: 'INTEGER' }, bant_dar: { type: 'INTEGER' }, kilcik: { type: 'INTEGER' }, mal_adedi: { type: 'INTEGER' }
  }
};
const FORMLAR = Object.keys(FORM_TARIF);
const yazi = v => String(v == null ? '' : v).trim().slice(0, 120);
const tam = v => Math.max(0, Math.round(+v || 0));
const tarihMi = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : '');
function formSonucu(o) {
  return {
    atolye: yazi(o.atolye), firma: yazi(o.firma), model: yazi(o.model).toUpperCase().replace(/\s+/g, ''), renk: yazi(o.renk),
    teslimEden: '', teslimAlan: '',   // kişi adı Gemini'den alınmaz (uydurabiliyor); yazıda açıkça varsa telefon okur
    tarih: tarihMi(o.tarih), termin: tarihMi(o.termin),
    aciklama: yazi(o.aciklama),
    satirlar: (o.satirlar || []).map(z => ({ beden: yazi(z.beden), cm: +z.cm || 0, adet: tam(z.adet) })).filter(z => z.adet > 0),
    metre: Math.max(0, Math.round((+o.metre || 0) * 10) / 10), adet: tam(o.adet), cm: Math.max(0, +o.cm || 0),
    posetler: (o.posetler || []).map(p => ({ olcu: yazi(p.olcu), adet: tam(p.adet) })).filter(p => p.adet > 0),
    bant: { genis: tam(o.bant_genis), dar: tam(o.bant_dar), kilcik: tam(o.kilcik) }, malAdedi: tam(o.mal_adedi)
  };
}

const SEMA = {
  type: 'OBJECT',
  properties: {
    koliler: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          foto:        { type: 'INTEGER', description: 'Fotoğraf numarası (Foto N içindeki N)' },
          etiket:      { type: 'INTEGER', description: 'Fotoğraftaki kaçıncı koli etiketi (1, 2, ...); aynı etiketin satırları aynı numara' },
          okunabildi:  { type: 'BOOLEAN' },
          model:       { type: 'STRING' },
          uzunluk:     { type: 'NUMBER' },
          miktar:      { type: 'INTEGER' },
          renk_kodu:   { type: 'STRING' },
          baslik:      { type: 'STRING', description: 'Model kodunun geçtiği satır aynen (ör. "J 5911 - SEPARE - PEMBE"), yoksa boş' },
          koli_no:     { type: 'STRING', description: 'Büyük barkodun altındaki uzun koli numarası (ör. 29260651263000000001), yoksa boş' },
          siparis_no:  { type: 'STRING' }
        },
        required: ['foto', 'okunabildi']
      }
    }
  },
  required: ['koliler']
};

function hataMetni(status, govde) {
  const m = (govde && govde.error && govde.error.message) || '';
  if (status === 429) return 'Günlük ücretsiz okuma hakkı doldu ya da çok sık istek gitti. Biraz sonra tekrar dene.';
  if (status === 400 && /api key/i.test(m)) return 'Gemini anahtarı geçersiz. Vercel\'deki GEMINI_API_KEY\'i kontrol et.';
  if (status === 403) return 'Gemini anahtarının bu modele izni yok.';
  if (status === 503 || status === 500) return 'Gemini şu an yoğun. Birkaç saniye sonra tekrar dene.';
  if (status === 'zaman aşımı') return 'Gemini zamanında cevap vermedi. Tekrar dene.';
  return 'Gemini hatası (' + status + ')' + (m ? ': ' + m.slice(0, 160) : '');
}

async function gemini(anahtar, model, parcalar, sema) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  // Tek model en çok 25 sn: takılırsa sıradaki modele geçilir
  const iptal = new AbortController();
  const sayac = setTimeout(() => iptal.abort(), 25000);
  const r = await fetch(url, {
    signal: iptal.signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': anahtar },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: parcalar }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: sema }
    })
  });
  const govde = await r.json().catch(() => null);
  clearTimeout(sayac);
  return { status: r.status, ok: r.ok, govde };
}

module.exports = async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ hata: 'Sadece POST' }); return; }

  // Yalnız kendi sitemizden gelen istekler (anahtarın kotası başkasına harcanmasın)
  const origin = req.headers.origin || '';
  if (origin && !/^https:\/\/([a-z0-9-]+\.)*(eyupybr\.com|vercel\.app)$/i.test(origin) && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    res.status(403).json({ hata: 'İzin yok' }); return;
  }
  if (req.headers['x-irsaliye'] !== 'koli') { res.status(403).json({ hata: 'İzin yok' }); return; }
  let govde = req.body;
  if (typeof govde === 'string') { try { govde = JSON.parse(govde); } catch (_) { govde = null; } }
  const tur = (govde && ['siparis', 'gelen', 'form'].includes(govde.tur)) ? govde.tur : 'koli';
  const siparis = tur === 'siparis' || tur === 'gelen';   // ikisi de {modeller:[{satirlar}]} döner
  const form = tur === 'form' ? (FORMLAR.includes(govde.form) ? govde.form : 'fermuar') : '';
  const metin = (tur !== 'koli' && govde && typeof govde.metin === 'string') ? govde.metin.trim().slice(0, 4000) : '';
  const bugun = (govde && tarihMi(govde.bugun)) || new Date().toISOString().slice(0, 10);

  const anahtar = process.env.GEMINI_API_KEY;
  if (!anahtar) { res.status(500).json({ hata: 'Sunucuda GEMINI_API_KEY tanımlı değil (Vercel ayarları).' }); return; }

  const fotolar = (govde && Array.isArray(govde.fotolar)) ? govde.fotolar : [];
  if (!fotolar.length && !metin) { res.status(400).json({ hata: tur === 'koli' ? 'Fotoğraf yok' : 'Yazı ya da fotoğraf yok' }); return; }
  if (fotolar.length > EN_COK_FOTO) { res.status(400).json({ hata: 'Tek seferde en çok ' + EN_COK_FOTO + ' fotoğraf' }); return; }

  const istem = tur === 'form' ? istemForm(form, bugun) : tur === 'gelen' ? ISTEM_GELEN : tur === 'siparis' ? ISTEM_SIPARIS : ISTEM;
  const parcalar = [{ text: istem }];
  if (metin) parcalar.push({ text: 'Kullanıcının yazdığı metin (--- işaretleri arasında):\n---\n' + metin + '\n---' });
  let toplamBoy = 0;
  for (let i = 0; i < fotolar.length; i++) {
    // Görsel (JPEG data URL) ya da sipariş için PDF (data:application/pdf;base64,…)
    const ham = String(fotolar[i] || '');
    const pdf = tur !== 'koli' && /^data:application\/pdf;base64,/.test(ham);
    const veri = ham.replace(/^data:[\w/+.-]+;base64,/, '');
    const sinir = pdf ? 3000000 : EN_BUYUK_FOTO;
    toplamBoy += veri.length;
    if (!veri || veri.length > sinir || toplamBoy > 4000000 || !/^[A-Za-z0-9+/=]+$/.test(veri.slice(0, 200))) {
      res.status(400).json({ hata: (i + 1) + '. dosya okunamadı ya da çok büyük' }); return;
    }
    parcalar.push({ text: (tur === 'koli' ? 'Foto ' : 'Belge ') + (i + 1) });
    parcalar.push({ inline_data: { mime_type: pdf ? 'application/pdf' : 'image/jpeg', data: veri } });
  }

  let son = null;
  const denemeler = [];   // hangi model, ne cevap, kaç ms — sorun ayıklamak için (gizli bilgi yok)
  const denenecek = [];
  MODELLER.forEach((m, i) => { denenecek.push(m); if (i === 0) denenecek.push(m); });   // ilk model iki şans
  for (let di = 0; di < denenecek.length; di++) {
    const model = denenecek[di];
    const tekrar = di > 0 && denenecek[di - 1] === model;
    if (tekrar) {
      const onceki = denemeler[denemeler.length - 1];
      if (!onceki || !(GECICI.includes(onceki.status) || onceki.status === 'bağlantı')) continue;   // kalıcı hatada tekrar deneme
      await new Promise(r => setTimeout(r, 2500));
    }
    let c; const t0 = Date.now();
    try { c = await gemini(anahtar, model, parcalar, tur === 'form' ? SEMA_FORM : siparis ? SEMA_SIPARIS : SEMA); }
    catch (e) {
      const st = e && e.name === 'AbortError' ? 'zaman aşımı' : 'bağlantı';
      denemeler.push({ model, status: st, ms: Date.now() - t0 });
      son = { status: st, govde: null }; continue;
    }
    denemeler.push({ model, status: c.status, ms: Date.now() - t0 });
    if (c.ok) {
      try {
        const metinCevap = ((c.govde.candidates || [])[0] || {}).content.parts.map(p => p.text || '').join('');
        const sonuc = JSON.parse(metinCevap);
        if (tur === 'form') { res.status(200).json({ sonuc: formSonucu(sonuc || {}), model, denemeler }); return; }
        if (siparis) {
          const modeller = (sonuc.modeller || []).map(m => ({
            model: String(m.model || '').trim().toUpperCase().replace(/\s+/g, ''),
            baslik: String(m.baslik || '').trim().slice(0, 120),
            renk: String(m.renk || '').trim(),
            tedarikci: String(m.tedarikci || '').trim(),
            toplam: Math.max(0, Math.round(+m.toplam || 0)),
            satirlar: (m.satirlar || []).map(z => ({ beden: String(z.beden || '').trim(), cm: +z.cm || 0, adet: Math.max(0, Math.round(+z.adet || 0)), renk: String(z.renk || '').trim() }))
              .filter(z => z.adet > 0 && (z.cm > 0 || tur === 'gelen'))   // gelen: metreyle gelen ham kordonda cm yok
          })).filter(m => m.satirlar.length || m.model);
          const belgeler = (sonuc.belgeler || []).map(b => ({
            belge: parseInt(b.belge, 10) || 0, baslik: String(b.baslik || '').trim().slice(0, 120),
            renkKodlari: (b.renk_kodlari || []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 10)
          }));
          res.status(200).json({ modeller, belgeler, model, denemeler });
          return;
        }
        const koliler = (sonuc.koliler || []).map(k => ({
          foto: Math.max(0, (parseInt(k.foto, 10) || 1) - 1),       // 0 tabanlı
          etiket: Math.max(1, parseInt(k.etiket, 10) || 1),
          okunabildi: k.okunabildi !== false,
          // Harfsiz kod (ör. YKK ürün kodu 4964423) model değildir
          model: (m => (/[A-Z]/.test(m) && /\d/.test(m)) ? m : '')(String(k.model || '').trim().toUpperCase().replace(/\s+/g, '')),
          baslik: String(k.baslik || '').trim().slice(0, 120),
          koli_no: String(k.koli_no || '').replace(/\s+/g, '').slice(0, 40),
          uzunluk: +k.uzunluk || 0,
          miktar: Math.max(0, Math.round(+k.miktar || 0)),
          renk_kodu: String(k.renk_kodu || '').trim(),
          siparis_no: String(k.siparis_no || '').trim()
        }));
        res.status(200).json({ koliler, model, denemeler });
        return;
      } catch (e) {
        son = { status: 502, govde: { error: { message: 'Cevap çözülemedi' } } };
        continue;
      }
    }
    son = c;
    // Model yoksa / kotası bittiyse / meşgulse sıradaki modeli dene
    if (![404, 429, 500, 503].includes(c.status)) break;
  }
  // En anlamlı hata: kota (429) > yoğunluk > ilk denemenin hatası. 404 (kaldırılmış model) en son.
  const durumlar = denemeler.map(d => d.status);
  const st = durumlar.includes(429) ? 429 : (durumlar.find(x => x !== 404) || (son && son.status) || 502);
  const ozet = denemeler.map(d => d.model.replace('gemini-', '').replace('-latest', '') + ': ' + d.status).join(', ');
  res.status(st === 429 ? 429 : 502).json({ hata: hataMetni(st, st === (son && son.status) ? son.govde : null) + ' (' + ozet + ')', denemeler });
};
