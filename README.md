# CF Audit Watcher

Cloudflare DNS / audit değişikliklerini izleyen ve alert gönderen lightweight Node.js servisidir.

---

## Özellikler

- Cloudflare API üzerinden değişiklik kontrolü
- Email alert (**Resend** üzerinden)
- Slack webhook alert
- PM2 ile daemon olarak çalışma
- Stateless yapı (env-based config)

---

## Gereksinimler

- Node.js 18+
- Cloudflare API erişimi
- Resend API key

---

## Kurulum

```bash
git clone
cd cloudflare-audit-watcher
npm install
```

---

### Konfigürasyon

```bash
cp .env.example .env
nano .env
```

---

### Çalıştırma

Direkt (development / test)

```bash
node index.js
```

PM2 (production önerilen)

```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

---

### Çalışma Mantığı

1. Cloudflare API'den audit / DNS değişiklikleri çekilir
2. Önceki state ile karşılaştırılır
3. Yeni değişiklik varsa:

* Email gönderilir ( **Resend API** )
* Slack alert gönderilir
