// Gemini ile belge okuma. İki iş:
//  tur:'koli'    → Gelen Gir "Koli fotoğrafından oku": koli etiketleri →
//                  her koli için {model, uzunluk, miktar, ...}
//  tur:'siparis' → "PDF'ten Satın Alma": sipariş e-postası ekran görüntüsü,
//                  fotoğraf ya da (yazısız/taranmış) PDF → model başına
//                  {beden, cm, adet} satırları
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
  'Kurallar: model alanına sadece model kodunu yaz (J4842 gibi), tedarikçi iş numarasını (212211-2) yazma. ' +
  'uzunluk cm cinsinden sayı, miktar adet cinsinden tam sayı. Emin olmadığın alanı boş bırak ya da 0 yaz, uydurma. ' +
  'Fotoğrafta okunabilir koli etiketi yoksa okunabildi=false yaz. Her fotoğraf için tam bir kayıt döndür.';

const ISTEM_SIPARIS =
  'Bu belgeler bir fermuar ya da kordon SATIN ALMA siparişi: e-posta ekran görüntüsü, kâğıt fotoğrafı ya da PDF olabilir. ' +
  'Her belge "Belge N" yazısından hemen sonra geliyor. Siparişteki her model için uzunluk (cm) başına sipariş adedini çıkar.\n' +
  'Kurallar:\n' +
  '- model: bizim model kodumuz, bir-üç harf + rakamlar (ör. J4842, I0987, M1S10178). "J 4842" gibi boşluklu yazılmışsa birleştir. ' +
  'Tedarikçinin kendi stok/iş numarasını (ör. 212211-2) model yazma. Model kodu yoksa boş bırak.\n' +
  '- satirlar: her uzunluk için bir satır. cm sayı, adet tam sayı. Satır birden çok bedeni kapsıyorsa ' +
  '(ör. "(XS-S-M) 23 cm : 5500 adet") beden alanına "XS-S-M" yaz; tek beden ise o bedeni yaz; beden yoksa boş bırak.\n' +
  '- Fiyat, fermuar tipi, not gibi bilgileri satıra koyma. renk: varsa renk adı (ör. Kahverengi). ' +
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
          renk:      { type: 'STRING' },
          tedarikci: { type: 'STRING' },
          toplam:    { type: 'INTEGER' },
          satirlar: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { beden: { type: 'STRING' }, cm: { type: 'NUMBER' }, adet: { type: 'INTEGER' } },
              required: ['cm', 'adet']
            }
          }
        },
        required: ['satirlar']
      }
    }
  },
  required: ['modeller']
};

const SEMA = {
  type: 'OBJECT',
  properties: {
    koliler: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          foto:        { type: 'INTEGER', description: 'Fotoğraf numarası (Foto N içindeki N)' },
          okunabildi:  { type: 'BOOLEAN' },
          model:       { type: 'STRING' },
          uzunluk:     { type: 'NUMBER' },
          miktar:      { type: 'INTEGER' },
          renk_kodu:   { type: 'STRING' },
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
  const siparis = !!(govde && govde.tur === 'siparis');

  const anahtar = process.env.GEMINI_API_KEY;
  if (!anahtar) { res.status(500).json({ hata: 'Sunucuda GEMINI_API_KEY tanımlı değil (Vercel ayarları).' }); return; }

  const fotolar = (govde && Array.isArray(govde.fotolar)) ? govde.fotolar : [];
  if (!fotolar.length) { res.status(400).json({ hata: 'Fotoğraf yok' }); return; }
  if (fotolar.length > EN_COK_FOTO) { res.status(400).json({ hata: 'Tek seferde en çok ' + EN_COK_FOTO + ' fotoğraf' }); return; }

  const parcalar = [{ text: siparis ? ISTEM_SIPARIS : ISTEM }];
  let toplamBoy = 0;
  for (let i = 0; i < fotolar.length; i++) {
    // Görsel (JPEG data URL) ya da sipariş için PDF (data:application/pdf;base64,…)
    const ham = String(fotolar[i] || '');
    const pdf = siparis && /^data:application\/pdf;base64,/.test(ham);
    const veri = ham.replace(/^data:[\w/+.-]+;base64,/, '');
    const sinir = pdf ? 3000000 : EN_BUYUK_FOTO;
    toplamBoy += veri.length;
    if (!veri || veri.length > sinir || toplamBoy > 4000000 || !/^[A-Za-z0-9+/=]+$/.test(veri.slice(0, 200))) {
      res.status(400).json({ hata: (i + 1) + '. dosya okunamadı ya da çok büyük' }); return;
    }
    parcalar.push({ text: (siparis ? 'Belge ' : 'Foto ') + (i + 1) });
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
    try { c = await gemini(anahtar, model, parcalar, siparis ? SEMA_SIPARIS : SEMA); }
    catch (e) {
      const st = e && e.name === 'AbortError' ? 'zaman aşımı' : 'bağlantı';
      denemeler.push({ model, status: st, ms: Date.now() - t0 });
      son = { status: st, govde: null }; continue;
    }
    denemeler.push({ model, status: c.status, ms: Date.now() - t0 });
    if (c.ok) {
      try {
        const metin = ((c.govde.candidates || [])[0] || {}).content.parts.map(p => p.text || '').join('');
        const sonuc = JSON.parse(metin);
        if (siparis) {
          const modeller = (sonuc.modeller || []).map(m => ({
            model: String(m.model || '').trim().toUpperCase().replace(/\s+/g, ''),
            renk: String(m.renk || '').trim(),
            tedarikci: String(m.tedarikci || '').trim(),
            toplam: Math.max(0, Math.round(+m.toplam || 0)),
            satirlar: (m.satirlar || []).map(z => ({ beden: String(z.beden || '').trim(), cm: +z.cm || 0, adet: Math.max(0, Math.round(+z.adet || 0)) }))
              .filter(z => z.cm > 0 && z.adet > 0)
          })).filter(m => m.satirlar.length || m.model);
          res.status(200).json({ modeller, model, denemeler });
          return;
        }
        const koliler = (sonuc.koliler || []).map(k => ({
          foto: Math.max(0, (parseInt(k.foto, 10) || 1) - 1),       // 0 tabanlı
          okunabildi: k.okunabildi !== false,
          model: String(k.model || '').trim().toUpperCase().replace(/\s+/g, ''),
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
