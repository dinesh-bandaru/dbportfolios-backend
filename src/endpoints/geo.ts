import { Context } from "hono";

/**
 * Country → { currency code, symbol, locale, typical timezone, major city }
 * Covers the ~50 most-common visitor countries. Falls back to USD/en-US/UTC.
 */
const COUNTRY_MAP: Record<string, {
    currency: string;
    symbol: string;
    locale: string;
    timezone: string;
    city: string;
}> = {
    IN: { currency: "INR",  symbol: "₹",   locale: "en-IN", timezone: "Asia/Kolkata",       city: "Mumbai"        },
    US: { currency: "USD",  symbol: "$",    locale: "en-US", timezone: "America/New_York",    city: "New York"      },
    GB: { currency: "GBP",  symbol: "£",    locale: "en-GB", timezone: "Europe/London",       city: "London"        },
    EU: { currency: "EUR",  symbol: "€",    locale: "de-DE", timezone: "Europe/Berlin",       city: "Berlin"        }, // fallback for EU block
    DE: { currency: "EUR",  symbol: "€",    locale: "de-DE", timezone: "Europe/Berlin",       city: "Berlin"        },
    FR: { currency: "EUR",  symbol: "€",    locale: "fr-FR", timezone: "Europe/Paris",        city: "Paris"         },
    IT: { currency: "EUR",  symbol: "€",    locale: "it-IT", timezone: "Europe/Rome",         city: "Rome"          },
    ES: { currency: "EUR",  symbol: "€",    locale: "es-ES", timezone: "Europe/Madrid",       city: "Madrid"        },
    NL: { currency: "EUR",  symbol: "€",    locale: "nl-NL", timezone: "Europe/Amsterdam",    city: "Amsterdam"     },
    BE: { currency: "EUR",  symbol: "€",    locale: "nl-BE", timezone: "Europe/Brussels",     city: "Brussels"      },
    AT: { currency: "EUR",  symbol: "€",    locale: "de-AT", timezone: "Europe/Vienna",       city: "Vienna"        },
    PT: { currency: "EUR",  symbol: "€",    locale: "pt-PT", timezone: "Europe/Lisbon",       city: "Lisbon"        },
    GR: { currency: "EUR",  symbol: "€",    locale: "el-GR", timezone: "Europe/Athens",       city: "Athens"        },
    FI: { currency: "EUR",  symbol: "€",    locale: "fi-FI", timezone: "Europe/Helsinki",     city: "Helsinki"      },
    IE: { currency: "EUR",  symbol: "€",    locale: "en-IE", timezone: "Europe/Dublin",       city: "Dublin"        },
    CA: { currency: "CAD",  symbol: "C$",   locale: "en-CA", timezone: "America/Toronto",     city: "Toronto"       },
    AU: { currency: "AUD",  symbol: "A$",   locale: "en-AU", timezone: "Australia/Sydney",    city: "Sydney"        },
    NZ: { currency: "NZD",  symbol: "NZ$",  locale: "en-NZ", timezone: "Pacific/Auckland",    city: "Auckland"      },
    SG: { currency: "SGD",  symbol: "S$",   locale: "en-SG", timezone: "Asia/Singapore",      city: "Singapore"     },
    JP: { currency: "JPY",  symbol: "¥",    locale: "ja-JP", timezone: "Asia/Tokyo",          city: "Tokyo"         },
    CN: { currency: "CNY",  symbol: "¥",    locale: "zh-CN", timezone: "Asia/Shanghai",       city: "Shanghai"      },
    HK: { currency: "HKD",  symbol: "HK$",  locale: "zh-HK", timezone: "Asia/Hong_Kong",      city: "Hong Kong"     },
    KR: { currency: "KRW",  symbol: "₩",    locale: "ko-KR", timezone: "Asia/Seoul",          city: "Seoul"         },
    TW: { currency: "TWD",  symbol: "NT$",  locale: "zh-TW", timezone: "Asia/Taipei",         city: "Taipei"        },
    MY: { currency: "MYR",  symbol: "RM",   locale: "ms-MY", timezone: "Asia/Kuala_Lumpur",   city: "Kuala Lumpur"  },
    TH: { currency: "THB",  symbol: "฿",    locale: "th-TH", timezone: "Asia/Bangkok",        city: "Bangkok"       },
    ID: { currency: "IDR",  symbol: "Rp",   locale: "id-ID", timezone: "Asia/Jakarta",        city: "Jakarta"       },
    PH: { currency: "PHP",  symbol: "₱",    locale: "en-PH", timezone: "Asia/Manila",         city: "Manila"        },
    VN: { currency: "VND",  symbol: "₫",    locale: "vi-VN", timezone: "Asia/Ho_Chi_Minh",    city: "Ho Chi Minh City" },
    PK: { currency: "PKR",  symbol: "₨",    locale: "ur-PK", timezone: "Asia/Karachi",        city: "Karachi"       },
    BD: { currency: "BDT",  symbol: "৳",    locale: "bn-BD", timezone: "Asia/Dhaka",          city: "Dhaka"         },
    LK: { currency: "LKR",  symbol: "₨",    locale: "si-LK", timezone: "Asia/Colombo",        city: "Colombo"       },
    AE: { currency: "AED",  symbol: "د.إ",  locale: "ar-AE", timezone: "Asia/Dubai",          city: "Dubai"         },
    SA: { currency: "SAR",  symbol: "﷼",    locale: "ar-SA", timezone: "Asia/Riyadh",         city: "Riyadh"        },
    QA: { currency: "QAR",  symbol: "﷼",    locale: "ar-QA", timezone: "Asia/Qatar",          city: "Doha"          },
    KW: { currency: "KWD",  symbol: "د.ك",  locale: "ar-KW", timezone: "Asia/Kuwait",         city: "Kuwait City"   },
    IL: { currency: "ILS",  symbol: "₪",    locale: "he-IL", timezone: "Asia/Jerusalem",      city: "Tel Aviv"      },
    TR: { currency: "TRY",  symbol: "₺",    locale: "tr-TR", timezone: "Europe/Istanbul",     city: "Istanbul"      },
    ZA: { currency: "ZAR",  symbol: "R",    locale: "en-ZA", timezone: "Africa/Johannesburg", city: "Johannesburg"  },
    NG: { currency: "NGN",  symbol: "₦",    locale: "en-NG", timezone: "Africa/Lagos",        city: "Lagos"         },
    KE: { currency: "KES",  symbol: "KSh",  locale: "en-KE", timezone: "Africa/Nairobi",      city: "Nairobi"       },
    EG: { currency: "EGP",  symbol: "£",    locale: "ar-EG", timezone: "Africa/Cairo",        city: "Cairo"         },
    BR: { currency: "BRL",  symbol: "R$",   locale: "pt-BR", timezone: "America/Sao_Paulo",   city: "São Paulo"     },
    MX: { currency: "MXN",  symbol: "$",    locale: "es-MX", timezone: "America/Mexico_City", city: "Mexico City"   },
    AR: { currency: "ARS",  symbol: "$",    locale: "es-AR", timezone: "America/Buenos_Aires",city: "Buenos Aires"  },
    CL: { currency: "CLP",  symbol: "$",    locale: "es-CL", timezone: "America/Santiago",    city: "Santiago"      },
    CO: { currency: "COP",  symbol: "$",    locale: "es-CO", timezone: "America/Bogota",      city: "Bogotá"        },
    SE: { currency: "SEK",  symbol: "kr",   locale: "sv-SE", timezone: "Europe/Stockholm",    city: "Stockholm"     },
    NO: { currency: "NOK",  symbol: "kr",   locale: "nb-NO", timezone: "Europe/Oslo",         city: "Oslo"          },
    DK: { currency: "DKK",  symbol: "kr",   locale: "da-DK", timezone: "Europe/Copenhagen",   city: "Copenhagen"    },
    CH: { currency: "CHF",  symbol: "CHF",  locale: "de-CH", timezone: "Europe/Zurich",       city: "Zurich"        },
    PL: { currency: "PLN",  symbol: "zł",   locale: "pl-PL", timezone: "Europe/Warsaw",       city: "Warsaw"        },
    CZ: { currency: "CZK",  symbol: "Kč",   locale: "cs-CZ", timezone: "Europe/Prague",       city: "Prague"        },
    RO: { currency: "RON",  symbol: "lei",  locale: "ro-RO", timezone: "Europe/Bucharest",    city: "Bucharest"     },
    HU: { currency: "HUF",  symbol: "Ft",   locale: "hu-HU", timezone: "Europe/Budapest",     city: "Budapest"      },
    RU: { currency: "RUB",  symbol: "₽",    locale: "ru-RU", timezone: "Europe/Moscow",       city: "Moscow"        },
    UA: { currency: "UAH",  symbol: "₴",    locale: "uk-UA", timezone: "Europe/Kyiv",         city: "Kyiv"          },
};

const DEFAULT_GEO = {
    country:  "US",
    currency: "USD",
    symbol:   "$",
    locale:   "en-US",
    timezone: "America/New_York",
    city:     "New York",
};

export async function geoHandler(c: Context) {
    // Cloudflare populates request.cf with geolocation data automatically
    const cf = (c.req.raw as any).cf as Record<string, string> | undefined;

    const country  = cf?.country  ?? "US";
    const timezone = cf?.timezone ?? "";
    const city     = cf?.city     ?? "";

    const info = COUNTRY_MAP[country] ?? DEFAULT_GEO;

    return c.json({
        country,
        currency: info.currency,
        symbol:   info.symbol,
        locale:   info.locale,
        timezone: timezone || info.timezone,
        city:     city     || info.city,
    });
}
