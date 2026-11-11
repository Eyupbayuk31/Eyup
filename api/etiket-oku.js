// Koli etiketi okuma — Gelen Gir ekranındaki "Koli fotoğrafından oku".
// Tarayıcı küçültülmüş JPEG'leri gönderir; burada Gemini'ye sorulur ve her
// koli için {model, uzunluk, miktar, ...} döner. Anahtar (GEMINI_API_KEY)
// yalnızca Vercel ortam değişkeninde durur, sayfaya hiç gitmez.

const MODELLER = (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [])
  .concat(['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash']);
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
  return 'Gemini hatası (' + status + ')' + (m ? ': ' + m.slice(0, 160) : '');
}

async function gemini(anahtar, model, parcalar) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': anahtar },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: parcalar }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SEMA }
    })
  });
  const govde = await r.json().catch(() => null);
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

  const anahtar = process.env.GEMINI_API_KEY;
  if (!anahtar) { res.status(500).json({ hata: 'Sunucuda GEMINI_API_KEY tanımlı değil (Vercel ayarları).' }); return; }

  let govde = req.body;
  if (typeof govde === 'string') { try { govde = JSON.parse(govde); } catch (_) { govde = null; } }
  const fotolar = (govde && Array.isArray(govde.fotolar)) ? govde.fotolar : [];
  if (!fotolar.length) { res.status(400).json({ hata: 'Fotoğraf yok' }); return; }
  if (fotolar.length > EN_COK_FOTO) { res.status(400).json({ hata: 'Tek seferde en çok ' + EN_COK_FOTO + ' fotoğraf' }); return; }

  const parcalar = [{ text: ISTEM }];
  for (let i = 0; i < fotolar.length; i++) {
    const veri = String(fotolar[i] || '').replace(/^data:image\/\w+;base64,/, '');
    if (!veri || veri.length > EN_BUYUK_FOTO || !/^[A-Za-z0-9+/=]+$/.test(veri.slice(0, 200))) {
      res.status(400).json({ hata: (i + 1) + '. fotoğraf okunamadı ya da çok büyük' }); return;
    }
    parcalar.push({ text: 'Foto ' + (i + 1) });
    parcalar.push({ inline_data: { mime_type: 'image/jpeg', data: veri } });
  }

  let son = null;
  for (const model of MODELLER) {
    let c;
    try { c = await gemini(anahtar, model, parcalar); }
    catch (e) { son = { status: 502, govde: { error: { message: 'Bağlantı hatası' } } }; continue; }
    if (c.ok) {
      try {
        const metin = ((c.govde.candidates || [])[0] || {}).content.parts.map(p => p.text || '').join('');
        const sonuc = JSON.parse(metin);
        const koliler = (sonuc.koliler || []).map(k => ({
          foto: Math.max(0, (parseInt(k.foto, 10) || 1) - 1),       // 0 tabanlı
          okunabildi: k.okunabildi !== false,
          model: String(k.model || '').trim().toUpperCase().replace(/\s+/g, ''),
          uzunluk: +k.uzunluk || 0,
          miktar: Math.max(0, Math.round(+k.miktar || 0)),
          renk_kodu: String(k.renk_kodu || '').trim(),
          siparis_no: String(k.siparis_no || '').trim()
        }));
        res.status(200).json({ koliler, model });
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
  const st = (son && son.status) || 502;
  res.status(st === 429 ? 429 : 502).json({ hata: hataMetni(st, son && son.govde) });
};
