# Çalışma kuralları (Eyüp)

Bu dosya her oturumda okunur. Aşağıdaki kurallar kullanıcının kalıcı tercihleridir.

## Arayüz ve çıktılar
- **Emoji / "AI ikonu" kullanma.** Arayüze, butonlara, toast mesajlarına, PDF/HTML çıktılarına
  emoji veya süs karakteri (📄 📥 🖨️ ✅ ✓ ✗ ✕ ⚠️ 🔗 vb.) koyma.
  - Uygulama içinde simge gerekiyorsa projede zaten kullanılan Font Awesome ikonlarını kullan
    (`<i class="fas fa-...">`).
  - Bağımsız HTML/PDF çıktılarında (Font Awesome yok) gerekiyorsa sade, çizim (inline SVG) işaret
    kullan; çoğu durumda yalnızca yazı yeterli ("Tamam", "180 adet eksik", "PDF İndir").
- Atölyeye giden belgeler sade ve anlaşılır olmalı; atölyeyi ilgilendirmeyen bilgi (ör. eldeki
  stok) konmaz.

## Git akışı
- İş bitince değişiklikleri çalışma dalına commit + push et, ardından **sormadan `main`'e merge
  edip push et** (Vercel `main`'den yayınlıyor). Merge commit kalıbı: `Merge: <kısa açıklama>`.

## Dil
- Kullanıcıyla Türkçe konuş.
