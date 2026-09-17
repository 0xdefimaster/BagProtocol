# VS Code'da gerçek çalıştırma — sıfırdan gerçek satın almaya

Bu doküman "artık yapılabilir" durumun ne olduğunu adım adım anlatır. Her
adımda **gerçek para/gas gerekip gerekmediğini** açıkça belirttim.

Bu oturumda yapılan kod değişiklikleri:
- `lib/blockchain/evm/config.ts` — Robinhood Chain artık `EVM_CHAINS`'te. Bundan önce Bag deploy'u sessizce mock'a düşüyordu.
- `scripts/deploy-bag-factory.ts` — artık `robinhood` argümanını kabul ediyor.
- `scripts/deploy-bag-execution-router.ts` — **yeni**, `BagExecutionRouter`'ı deploy edip allowlist'leri aynı script içinde ayarlıyor.

---

## 0) Kurulum (para gerekmez)

```bash
npm install
cp .env.example .env.local
```

## 1) Supabase (para gerekmez, ücretsiz tier yeterli)

1. supabase.com'da yeni proje aç.
2. `supabase/schema.sql`'i SQL editöründe çalıştır.
3. `.env.local`'e doldur: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## 2) Auth secret (para gerekmez)

```bash
openssl rand -base64 32   # -> SESSION_SECRET
```

## 3) Fiyatlama (para gerekmez — CoinGecko free tier yeterli, key olmadan da rate-limited çalışır ama key önerilir)

`.env.local` → `COINGECKO_API_KEY=` (opsiyonel ama önerilir).

## 4) Deployer cüzdanı — BURADAN İTİBAREN GERÇEK PARA/GAS GEREKİYOR

Robinhood Chain'de gaz için gerçek ETH'ye ihtiyacın var. Yeni, sadece bu iş
için bir cüzdan oluşturmanı öneririm (ana cüzdanını deploy key'i yapma).

```bash
export DEPLOYER_PRIVATE_KEY=0x...
```

## 5) BagFactory deploy (GERÇEK TX, GAS HARCAR)

```bash
npx tsx scripts/deploy-bag-factory.ts robinhood
```

Çıktıdaki `FACTORY_ADDRESS_ROBINHOOD=0x...` satırını `.env.local`'e yapıştır.

**Not:** Bu adımı çalıştırdığın cüzdan `BagFactory`'nin **kalıcı** owner'ı
olur — kontratta bunu sonradan değiştirecek bir fonksiyon yok. Mainnet'e
gerçek deploy öncesi bunun bir multisig olup olmayacağına karar ver.

## 6) BagExecutionRouter deploy + allowlist (GERÇEK TX'LER, GAS HARCAR)

Ayrı bir `planSigner` cüzdanı oluştur (private key'ini deploy key'inden
farklı bir yerde sakla — bu, execution plan'ları imzalayan sunucu-taraflı
key, admin key değil):

```bash
export PLAN_SIGNER_ADDRESS=0x...    # planSigner CÜZDANININ ADRESİ (private key değil)
export CANONICAL_TOKEN_ADDRESSES=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,<BTC>,<ETH>,<SOL>,<xStock adresleri>

npx tsx scripts/deploy-bag-execution-router.ts robinhood <5. adımdaki FACTORY_ADDRESS_ROBINHOOD>
```

Bu tek komut: kontratı deploy eder, Uniswap router'ı `setAllowedTarget` ile
allowlist'e ekler, verdiğin her token'ı `setAllowedToken` ile ekler.

Çıktıdaki iki satırı `.env.local`'e ekle:
```
BAG_EXECUTION_ROUTER_ADDRESS=0x...
BAG_ROUTER_PLAN_SIGNER_KEY=0x...   # <- planSigner'ın PRIVATE KEY'i, script bunu asla yazdırmaz, elle ekle
```

**Alternatif (daha basit, daha az kontrol):** Bu adımı atla, sadece
`LIFI_API_KEY` set et (ücretsiz — 200 req/dk). O zaman satın almalar
`BagExecutionRouter` yerine LI.FI üzerinden yürür; kodun geri kalanı
zaten bunu otomatik seçiyor.

## 7) Çalıştır

```bash
npm run dev
```

localhost'ta cüzdanla bağlan, Bag oluştur — bu artık **gerçekten**
Robinhood Chain'e `BagFactory.createBag()` gönderir (mock değil).

## 8) İlk satın almayı KÜÇÜK miktarla dene

`RobinhoodUniswapProvider`/quoter (benim yazdığım kısım) hiçbir zaman
canlı RPC'ye karşı test edilmedi — benim sandbox'ımda erişim yoktu. İlk
denemende:
- Küçük bir miktarla başla (birkaç dolarlık USDG).
- Sunucu loglarını izle — quote/fee-tier/calldata ile ilgili bir hata
  çıkarsa bana logu getir, birlikte düzeltiriz.
- Bir şey ters giderse ve LI.FI key'in de varsa, sistem zaten oraya
  düşebilir (provider seçimi otomatik) — ama madde 6'yı yaptıysan
  BagRouter öncelikli denenir.

---

## Hâlâ gerçek olmayan/eksik kalan şeyler

- Fork testleri (12 senaryo) — hiç çalıştırılmadı, RPC bende yok.
- Execution reconciliation, VERIFIED/ACCOUNTED state machine, Redeem
  signing UX — spec'te var, implementasyon yok.
- BagVault — sadece tasarım dokümanı (`docs/BAGVAULT_DESIGN.md`), kontrat yok.
