#!/bin/bash
# QR Viewer Test Script

echo "🔍 QR Viewer Test Başlatılıyor..."
echo ""

# Test 1: Dosya kontrolü
echo "✅ Test 1: Dosya Kontrolü"
if [ -f "index.html" ]; then
    echo "   ✓ index.html mevcut"
else
    echo "   ✗ index.html bulunamadı!"
    exit 1
fi

if [ -f "qr-test.html" ]; then
    echo "   ✓ qr-test.html mevcut"
else
    echo "   ✗ qr-test.html bulunamadı!"
fi

if [ -f "test-qr-url.html" ]; then
    echo "   ✓ test-qr-url.html mevcut"
else
    echo "   ✗ test-qr-url.html bulunamadı!"
fi

echo ""

# Test 2: Kod kontrolü
echo "✅ Test 2: Kod Kontrolü"
if grep -q "QR viewer: Starting parse" index.html; then
    echo "   ✓ Debug logları eklendi"
else
    echo "   ✗ Debug logları eksik!"
fi

if grep -q "function _checkAndRenderPublicViewer" index.html; then
    echo "   ✓ Viewer fonksiyonu mevcut"
else
    echo "   ✗ Viewer fonksiyonu bulunamadı!"
fi

if grep -q "DOMContentLoaded" index.html; then
    echo "   ✓ DOMContentLoaded event listener mevcut"
else
    echo "   ✗ DOMContentLoaded eksik!"
fi

echo ""

# Test 3: GitHub fotoğrafları
echo "✅ Test 3: GitHub Fotoğraf Kontrolü"
if [ -d "kanitlar" ]; then
    photo_count=$(ls -1 kanitlar/*.jpg 2>/dev/null | wc -l)
    echo "   ✓ kanitlar/ klasörü mevcut"
    echo "   ✓ $photo_count adet fotoğraf bulundu"
else
    echo "   ⚠ kanitlar/ klasörü bulunamadı"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Test Tamamlandı!"
echo ""
echo "🚀 Manuel Test Adımları:"
echo ""
echo "1. HTTP Server Başlat:"
echo "   python3 -m http.server 8000"
echo ""
echo "2. Test URL Generator'ı Aç:"
echo "   http://localhost:8000/test-qr-url.html"
echo ""
echo "3. Test URL'sini Oluştur ve Aç"
echo "   - 'Test URL Oluştur' butonuna tıkla"
echo "   - 'Yeni Sekmede Aç' butonuna tıkla"
echo "   - Public viewer açılmalı ve fotoğraflar görünmeli"
echo ""
echo "4. QR Test Aracını Kullan:"
echo "   http://localhost:8000/qr-test.html"
echo ""
echo "5. Console Loglarını Kontrol Et:"
echo "   - F12 ile Developer Tools'u aç"
echo "   - Console sekmesine git"
echo "   - 'QR viewer:' loglarını kontrol et"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
