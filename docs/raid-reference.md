# Raid System & EnhancedAI Reference

## Raid Attributes (قابل تنظیم)

### سطح رید (Raid level)

| اتربیوت | مثال | توضیح |
|---------|------|-------|
| `.spawn(minR, maxR)` | `.spawn(150, 250)` | شعاع حلقه اسپوان مابها دور بازیکن (بلاک) |
| `.aggroRadius(n)` | `.aggroRadius(25)` | مابها خودکار به بازیکن/ویلجر/گلم توی این شعاع حمله میکنن |
| `.followRange(n)` | `.followRange(300)` | مسافت تعقیب + تشخیص بازیکن (بلاک) |
| `.defaultPresets("...")` | `.defaultPresets("farSight")` | preset پیشفرض EnhancedAI برای همه مابها |
| `.barColor("...")` | `.barColor("GREEN")` | رنگ Boss Bar (RED, GREEN, BLUE, PURPLE, YELLOW, WHITE, PINK) |
| `.barHold(ticks)` | `.barHold(200)` | مدت نمایش Boss Bar بعد از برد/باخت (20 تیک = 1 ثانیه) |

### سطح دور (Round level)

| اتربیوت | مثال | توضیح |
|---------|------|-------|
| `.breather(ticks)` | `.breather(200)` | مکث بعد از پاکسازی دور قبلی (200 = 10 ثانیه) |
| `.timeLimit(ticks)` | `.timeLimit(4800)` | مهلت دور — اگه تموم نشه force advance (4800 = 4 دقیقه) |

### سطح ماب (Mob level)

| اتربیوت | مثال | توضیح |
|---------|------|-------|
| `.mob({...})` | `.mob({type:"minecraft:zombie", presets:["mobile"]})` | تعریف ماب |
| `.count(n)` | `.count(5)` | تعداد این ماب توی این دور |
| `type` | `"minecraft:zombie"` | نوع ماب (namespace:name) |
| `presets` | `["mobile", "superMiner"]` | presetهای EnhancedAI (قابل ترکیب) |
| `equip` | `{mainhand:"...", head:"..."}` | تجهیزات (mainhand, offhand, head, chest, legs, feet) |
| `nbt` | `{IsBaby: false}` | NBT اختصاصی |
| `extraArgs` | `["attributes/max_health=40"]` | تغییر attribute |
| `noDefaults` | `true` | preset پیشفرض رید رو نادیده بگیر |

### Callback ها

| Callback | توضیح |
|----------|-------|
| `.onStart(fn)` | وقتی رید شروع میشه |
| `.onRoundStart(fn)` | وقتی هر دور شروع میشه |
| `.onRoundEnd(fn)` | وقتی هر دور تموم میشه |
| `.onWin(fn)` | فقط وقتی بازیکن برنده میشه (جایزه اینجاست) |
| `.onLose(fn)` | وقتی بازیکن میبازه (timeout دور آخر) |

### صداها

| متد | پیشفرض | توضیح |
|-----|--------|-------|
| `.roundStartSound(id, vol, pitch)` | `event.raid.horn` | صدای شروع هر دور |
| `.winSound(id, vol, pitch)` | `ui.toast.challenge_complete` | صدای برد |
| `.loseSound(id, vol, pitch)` | `entity.ravager.roar` | صدای باخت |

---

## قدرت‌های موجود EnhancedAI

### حرکت/جابجایی

| قدرت | توضیح | Tag |
|------|-------|-----|
| Climbing | بالا رفتن از نردبان و بلاکهای مشابه | `enhancedai:mobs/can_climb` |
| Parkour | پریدن از روی بلاکها | `enhancedai:mobs/can_parkour` |
| Sprint | دویدن + حرکت پیشرفته | `enhancedai:mobs/can_sprint` |
| Swimmers | سرعت شنا بر اساس attribute | `enhancedai:mobs/swimmers` |
| Jump | پریدن وقتی هدف بالاتره | `enhancedai:mobs/can_jump_in_place` |
| Riding | سوار شدن روی مابهای دیگه | `enhancedai:mobs/riding/` |

### مبارزه

| قدرت | توضیح |
|------|-------|
| superMiner | حفر مستقیم به سمت بازیکن |
| fisherAggro | قلاب ماهیگیری + کشیدن بازیکن |
| pearlThrower | پرتاب مروارید اند + تلپورت |
| webShooter | پرتاب تار عنکبوت + زهر |
| skirmisher | حمله از دور + strafe |
| Shielding | بلاک کردن با سپر |
| Melee attacking | حمله با سرعت attribute |
| Drowning targets | بلند کردن بازیکن + غرق کردن |
| Leaders | صدا زدن نیروهای کمکی |
| Item disruption | انداختن آیتم از دست بازیکن |
| Air steal | دزدیدن هوا از بازیکن |
| Flee target | فرار کردن |
| Break anger | عصبانیت وقتی بلاک شکسته میشه |

### ویژه

| قدرت | توضیح |
|------|-------|
| Open doors | باز کردن درها |
| Anti-Cheese | شکستن وسایل نقلیه |
| Panic | وحشت وقتی آتیش گرفته |
| Teleport anti-cheese | ضد تقلب تلپورت |
| Avoid explosions | فرار از انفجار |

---

## EnhancedAI Preset ها (KubeJS)

اینا از طریق KubeJS روی ماب اعمال میشن:

| Preset | رفتار | نیاز خاص |
|--------|-------|----------|
| `mobile` | حرکت سریعتر، بهتر | — |
| `farSight` | دید 200 بلاکی + تعقیب دور | — |
| `sharpTargeting` | تارگت دقیق، هوشمندتر | — |
| `superMiner` | حفر مستقیم به سمت بازیکن | `mobGriefing=true` |
| `fisherAggro` | قلاب ماهیگیری + کشیدن بازیکن | — |
| `pearlThrower` | پرتاب مروارید اند + تلپورت | — |
| `webShooter` | پرتاب تار عنکبوت + زهر | — |
| `skirmisher` | حمله از دور + strafe (اسکلت/کمان) | — |

**ترکیب:** میتونی چند preset رو با هم stack کنی:
```js
presets: ["mobile", "superMiner", "farSight"]  // ماینر سریع با دید دور
```

---

## EnhancedAI Entity Tag ها (Datapack)

اینا از طریق datapack کنترل میشن. فایلها توی `kubejs/data/enhancedai/tags/entity_type/mobs/`:

| Tag | قابلیت | فایل |
|-----|--------|------|
| `enhancedai:mobs/can_climb` | بالا رفتن از نردبان/دیوار | `can_climb.json` |
| `enhancedai:mobs/can_sprint` | دویدن سریع | `can_sprint.json` |
| `enhancedai:mobs/can_parkour` | پریدن از روی بلاکها | `can_parkour.json` (پیشفرض غیرفعال) |
| `enhancedai:mobs/can_equip_shield` | بلاک کردن با سپر | `can_equip_shield.json` |
| `enhancedai:mobs/can_jump_in_place` | پریدن وقتی هدف بالاتره | — |
| `enhancedai:mobs/can_open_doors` | باز کردن درها | — |
| `enhancedai:mobs/can_flee` | فرار کردن | — |
| `enhancedai:mobs/can_mine` | استخراج بلاک برای رسیدن به هدف | — |

**ساختار فایل:**
```json
{
  "replace": false,
  "values": ["minecraft:zombie", "minecraft:husk", "minecraft:drowned"]
}
```

---

## تفاوت Preset vs Tag

| | Preset (KubeJS) | Tag (Datapack) |
|---|---|---|
| **کنترل** | رفتار جنگی | قابلیت فیزیکی |
| **مثال** | ماینر، ماهیگیر، تارزن | climb، sprint، shield block |
| **اعمال** | از طریق `.mob({presets:[...]})` | از طریق فایل JSON توی data/ |
| **ترکیب** | ✅ چند preset با هم | ✅ چند tag با هم |
| **override** | preset هر ماب جداگانه | tag برای همه مابهای اون نوع |

---

## Attribute های قابل تنظیم (extraArgs)

| Attribute | مثال | توضیح |
|-----------|------|-------|
| `max_health` | `attributes/max_health=40` | جون ماب (پیشفرض زامبی: 20) |
| `movement_speed` | `attributes/movement_speed=0.35` | سرعت حرکت (پیشفرض: 0.23) |
| `follow_range` | `attributes/follow_range=200` | مسافت تعقیب (پیشفرض: 16) |
| `attack_damage` | `attributes/attack_damage=8` | قدرت حمله (پیشفرض: 3) |
| `armor` | `attributes/armor=10` | زره طبیعی |

---

## تیک به ثانیه/دقیقه

| تیک | ثانیه | دقیقه |
|-----|-------|-------|
| 20 | 1 | — |
| 100 | 5 | — |
| 200 | 10 | — |
| 1200 | 60 | 1 |
| 2400 | 120 | 2 |
| 4800 | 240 | 4 |
| 9600 | 480 | 8 |

---

## ریدهای زمانبندی شده فعلی

| روز | Raid ID | دورها | جایزه |
|-----|---------|-------|-------|
| 10 | day10_awakening | Shamblers→Horde→Crawlers→Swarm→Vanguard | 2 بلوک زمرد + 3 سیب طلایی |
| 20 | pillager_siege | Scouts→Assault→Warbeast | 3 بلوک زمرد |
| 30 | day30_onslaught | Diggers→Volley→Heavy→Twin Beasts | 2 ندرایت + 3 بلوک الماس |

---

## دستورات

```
/raid start <id>          — شروع رید روی خودت
/raid start <id> <player> — شروع رید روی بازیکن دیگه
/raid stop                — متوقف کردن ریدت
/raid stopall             — متوقف کردن همه ریدها
/raid list                — لیست ریدهای ثبت شده
/raid status              — وضعیت ریدهای فعال
```
نیاز به permission level 2+
